import { AnafRateLimitError, ExecutionStatus, UploadStatusValue } from '@florinszilagyi/anaf-ts-sdk';
import { eq } from 'drizzle-orm';
import { NonRetriableError, RetryAfterError } from 'inngest';
import { db } from '@/db';
import { companies, invoices, type InvoiceStatus } from '@/db/schema';
import { getEfacturaClient } from '@/lib/anaf/gateway';
import { buildUblFromInput } from '@/lib/anaf/partyMapping';
import { transitionInvoice } from '@/lib/invoiceStatus';
import { putObject, storageKeys } from '@/lib/storage';
import type { CreateInvoiceInput } from '@/lib/validation/invoiceInput';
import { inngest } from '../client';

/**
 * Async invoice pipeline: build UBL → upload to ANAF → poll status with
 * backoff → download the signed ZIP. Every status write is a compare-and-set
 * so step replays are no-ops.
 */

// step.sleep durations between status polls (~26h total window).
const POLL_BACKOFF = ['10s', '30s', '1m', '2m', '5m', '10m', '30m', '1h', '2h', '4h', '6h', '12h'] as const;

export const invoiceCreate = inngest.createFunction(
  {
    id: 'invoice-create',
    retries: 3,
    concurrency: { key: 'event.data.invoiceId', limit: 1 },
  },
  { event: 'invoice/create.requested' },
  async ({ event, step }) => {
    const { invoiceId } = event.data;

    const loaded = await step.run('load', async () => {
      const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
      if (!invoice) throw new NonRetriableError(`invoice ${invoiceId} not found`);
      if (['validated', 'rejected', 'failed'].includes(invoice.status)) {
        return null; // already terminal — replayed event
      }
      const [company] = await db.select().from(companies).where(eq(companies.id, invoice.companyId)).limit(1);
      if (!company?.grantId) {
        await markFailed(invoiceId, invoice.status, 'GRANT_MISSING', 'Company has no ANAF connection');
        throw new NonRetriableError('company has no grant');
      }
      return {
        userId: invoice.userId,
        companyId: company.id,
        grantId: company.grantId,
        cif: company.cif,
        mode: invoice.mode,
        status: invoice.status,
        requestInput: invoice.requestInput as CreateInvoiceInput,
      };
    });
    if (!loaded) return { skipped: 'terminal' };

    // 1. Build UBL XML and persist it.
    const xml = await step.run('build-xml', async () => {
      try {
        const built = await buildUblFromInput(loaded.requestInput, loaded.cif);
        const key = storageKeys.invoiceXml(loaded.userId, invoiceId);
        await putObject(key, built.xml, 'application/xml');
        await transitionInvoice(db, invoiceId, 'queued', 'building', { xmlStorageKey: key });
        return built.xml;
      } catch (cause) {
        await markFailed(invoiceId, 'queued', 'BUILD_FAILED', message(cause));
        throw new NonRetriableError(`UBL build failed: ${message(cause)}`);
      }
    });

    // 2. Upload to ANAF.
    const uploadIndex = await step.run('upload', async () => {
      const client = await getEfacturaClient(db, { grantId: loaded.grantId, cif: loaded.cif, mode: loaded.mode });
      try {
        const res = await client.uploadDocument(xml, {});
        if (res.executionStatus !== ExecutionStatus.Success || !res.indexIncarcare) {
          await markFailed(invoiceId, 'building', 'ANAF_UPLOAD_REJECTED', (res.errors ?? []).join('; '));
          throw new NonRetriableError(`ANAF rejected upload: ${(res.errors ?? []).join('; ')}`);
        }
        await transitionInvoice(db, invoiceId, 'building', 'uploaded', { anafUploadIndex: res.indexIncarcare });
        return res.indexIncarcare;
      } catch (cause) {
        if (cause instanceof AnafRateLimitError) {
          throw new RetryAfterError('ANAF rate limited', '60s');
        }
        throw cause;
      }
    });

    // 3. Poll until terminal (bounded).
    let downloadId: string | null = null;
    for (let i = 0; i < POLL_BACKOFF.length; i++) {
      await step.sleep(`wait-${i}`, POLL_BACKOFF[i]);
      const poll = await step.run(`poll-${i}`, async () => {
        const client = await getEfacturaClient(db, { grantId: loaded.grantId, cif: loaded.cif, mode: loaded.mode });
        const status = await client.getUploadStatus(uploadIndex);
        if (status.stare === UploadStatusValue.Ok && status.idDescarcare) {
          return { state: 'ok' as const, downloadId: status.idDescarcare };
        }
        if (status.stare === UploadStatusValue.Failed) {
          // Download the error ZIP when ANAF provides one, then mark rejected.
          let errorZipKey: string | undefined;
          if (status.idDescarcare) {
            try {
              const zip = await client.downloadDocument(status.idDescarcare);
              errorZipKey = storageKeys.invoiceErrorZip(loaded.userId, invoiceId);
              await putObject(errorZipKey, zip, 'application/zip');
            } catch {
              // best effort — rejection reason still recorded below
            }
          }
          const from = i === 0 ? 'uploaded' : 'processing';
          await transitionInvoice(db, invoiceId, from, 'rejected', {
            anafDownloadId: status.idDescarcare,
            zipStorageKey: errorZipKey,
            error: { code: 'ANAF_REJECTED', errors: status.errors ?? [] },
            finalizedAt: new Date(),
          });
          return { state: 'rejected' as const };
        }
        // still processing
        if (i === 0) {
          await transitionInvoice(db, invoiceId, 'uploaded', 'processing');
        }
        return { state: 'processing' as const };
      });

      if (poll.state === 'ok') {
        downloadId = poll.downloadId;
        break;
      }
      if (poll.state === 'rejected') {
        return { status: 'rejected' };
      }
    }

    if (!downloadId) {
      await step.run('mark-timeout', async () => {
        await markFailed(
          invoiceId,
          'processing',
          'ANAF_TIMEOUT',
          'ANAF did not finish processing within the poll window'
        );
      });
      return { status: 'failed' };
    }

    // 4. Download the signed ZIP.
    await step.run('download', async () => {
      const client = await getEfacturaClient(db, { grantId: loaded.grantId, cif: loaded.cif, mode: loaded.mode });
      const zip = await client.downloadDocument(downloadId);
      const key = storageKeys.invoiceZip(loaded.userId, invoiceId);
      await putObject(key, zip, 'application/zip');
      const movedFromProcessing = await transitionInvoice(db, invoiceId, 'processing', 'validated', {
        anafDownloadId: downloadId,
        zipStorageKey: key,
        finalizedAt: new Date(),
      });
      if (!movedFromProcessing) {
        // fast validation can complete before the first poll marked 'processing'
        await transitionInvoice(db, invoiceId, 'uploaded', 'validated', {
          anafDownloadId: downloadId,
          zipStorageKey: key,
          finalizedAt: new Date(),
        });
      }
    });

    return { status: 'validated' };
  }
);

async function markFailed(invoiceId: string, from: InvoiceStatus, code: string, msg: string): Promise<void> {
  // try the expected source state first, then any non-terminal state
  const states: InvoiceStatus[] = [from, 'queued', 'building', 'uploaded', 'processing'];
  for (const s of states) {
    const moved = await transitionInvoice(db, invoiceId, s, 'failed', {
      error: { code, message: msg },
      finalizedAt: new Date(),
    }).catch(() => false);
    if (moved) return;
  }
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
