import { parseDetalii, type MessageDetails } from '@florinszilagyi/anaf-ts-sdk';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { NonRetriableError } from 'inngest';
import { db } from '@/db';
import { anafGrants, companies, invoices, syncRuns } from '@/db/schema';
import { getEfacturaClient } from '@/lib/anaf/gateway';
import { extractInvoiceMetadata, pickInvoiceXml } from '@/lib/anaf/ublMetadata';
import { putObject, storageKeys } from '@/lib/storage';
import { inngest } from '../client';

/**
 * Daily archive sync. A cron fan-out emits one `archive/company.sync` event
 * per eligible company; the worker pages through ANAF messages for the window
 * since the last successful sync, downloads each new document ZIP into object
 * storage and upserts invoice metadata rows.
 *
 * ANAF keeps messages ~60 days, so the window is capped at 60 days back and
 * overlaps the previous run by 1 day; the (companyId, anafMessageId) unique
 * index makes re-ingestion idempotent. The dashboard's "Refresh archive"
 * button fires the same per-company event on demand.
 */

const MAX_WINDOW_MS = 60 * 24 * 60 * 60 * 1000; // ANAF retention: 60 days
const OVERLAP_MS = 24 * 60 * 60 * 1000;
const DOWNLOAD_BATCH = 10;

export const archiveCron = inngest.createFunction(
  { id: 'archive-cron', retries: 2 },
  { cron: '0 3 * * *' }, // daily 03:00 UTC
  async ({ step }) => {
    const eligible = await step.run('select-companies', async () => {
      const rows = await db
        .select({ id: companies.id })
        .from(companies)
        .innerJoin(anafGrants, eq(companies.grantId, anafGrants.id))
        .where(and(eq(companies.archiveEnabled, true), eq(anafGrants.status, 'active'), isNotNull(companies.grantId)));
      return rows.map((r) => r.id);
    });

    if (eligible.length > 0) {
      await step.sendEvent(
        'fan-out',
        eligible.map((companyId) => ({ name: 'archive/company.sync' as const, data: { companyId } }))
      );
    }
    return { companies: eligible.length };
  }
);

export const archiveCompanySync = inngest.createFunction(
  {
    id: 'archive-company-sync',
    retries: 2,
    // One sync per company at a time; be gentle with ANAF overall.
    concurrency: { key: 'event.data.companyId', limit: 1 },
    throttle: { limit: 10, period: '1m' },
  },
  { event: 'archive/company.sync' },
  async ({ event, step }) => {
    const { companyId } = event.data;

    const ctx = await step.run('load', async () => {
      const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
      if (!company) throw new NonRetriableError(`company ${companyId} not found`);
      if (!company.grantId) throw new NonRetriableError(`company ${companyId} has no grant`);
      const now = Date.now();
      const windowStart = Math.max(
        now - MAX_WINDOW_MS,
        company.lastSyncAt ? company.lastSyncAt.getTime() - OVERLAP_MS : 0
      );
      const [run] = await db
        .insert(syncRuns)
        .values({
          companyId,
          windowStart: new Date(windowStart),
          windowEnd: new Date(now),
          status: 'running',
        })
        .returning({ id: syncRuns.id });
      return {
        runId: run.id,
        userId: company.userId,
        grantId: company.grantId,
        cif: company.cif,
        windowStart,
        windowEnd: now,
      };
    });

    let found = 0;
    let ingested = 0;

    try {
      // Page through the window; each page is its own retryable step.
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages) {
        const res = await step.run(`page-${page}`, async () => {
          const client = await getEfacturaClient(db, { grantId: ctx.grantId, cif: ctx.cif, mode: 'live' });
          const out = await client.getMessagesPaginated({
            startTime: ctx.windowStart,
            endTime: ctx.windowEnd,
            pagina: page,
          });
          if (out.eroare && !/nu exista mesaje/i.test(out.eroare)) {
            throw new Error(`ANAF message listing error: ${out.eroare}`);
          }
          return {
            totalPages: out.numar_total_pagini ?? 1,
            messages: (out.mesaje ?? []).map((m) => normalizeMessage(m)),
          };
        });
        totalPages = res.totalPages;
        found += res.messages.length;

        // Ingest in small batches — download ZIP + parse + upsert inside the step.
        for (let i = 0; i < res.messages.length; i += DOWNLOAD_BATCH) {
          const batch = res.messages.slice(i, i + DOWNLOAD_BATCH);
          const batchNew = await step.run(`ingest-${page}-${i / DOWNLOAD_BATCH}`, async () =>
            ingestBatch(batch, { ...ctx, companyId })
          );
          ingested += batchNew;
        }
        page += 1;
      }

      await step.run('finish', async () => {
        await db
          .update(syncRuns)
          .set({ status: 'ok', finishedAt: sql`now()`, messagesFound: found, messagesNew: ingested })
          .where(eq(syncRuns.id, ctx.runId));
        await db
          .update(companies)
          .set({ lastSyncAt: new Date(ctx.windowEnd) })
          .where(eq(companies.id, companyId));
      });
      return { found, ingested };
    } catch (cause) {
      await step.run('finish-error', async () => {
        await db
          .update(syncRuns)
          .set({
            status: 'error',
            finishedAt: sql`now()`,
            messagesFound: found,
            messagesNew: ingested,
            error: { message: cause instanceof Error ? cause.message : String(cause) },
          })
          .where(eq(syncRuns.id, ctx.runId));
      });
      throw cause;
    }
  }
);

interface NormalizedMessage {
  messageId: string;
  tip: string;
  uploadIndex?: string;
  cifEmitent?: string;
  cifBeneficiar?: string;
  createdAt: string;
}

function normalizeMessage(m: MessageDetails): NormalizedMessage {
  // The SDK parses detalii into id_incarcare/cif_* when possible; fall back to parseDetalii.
  const parsed = m.id_incarcare ? m : { ...m, ...parseDetalii(m.detalii) };
  return {
    messageId: m.id,
    tip: m.tip,
    uploadIndex: parsed.id_incarcare,
    cifEmitent: parsed.cif_emitent,
    cifBeneficiar: parsed.cif_beneficiar,
    createdAt: m.data_creare,
  };
}

async function ingestBatch(
  batch: NormalizedMessage[],
  ctx: { companyId: string; userId: string; grantId: string; cif: string }
): Promise<number> {
  let newCount = 0;
  for (const msg of batch) {
    const isError = /ERORI/i.test(msg.tip);

    if (isError) {
      // Attach ANAF validation errors to the matching outbound invoice, if any.
      if (msg.uploadIndex) {
        await db
          .update(invoices)
          .set({ error: { code: 'ANAF_ERROR_MESSAGE', anafMessageId: msg.messageId }, updatedAt: sql`now()` })
          .where(and(eq(invoices.companyId, ctx.companyId), eq(invoices.anafUploadIndex, msg.uploadIndex)));
      }
      continue;
    }

    const isInbound = /PRIMITA/i.test(msg.tip);

    // Outbound messages that match an invoice we created: just link the message id.
    if (!isInbound && msg.uploadIndex) {
      const linked = await db
        .update(invoices)
        .set({ anafMessageId: msg.messageId, updatedAt: sql`now()` })
        .where(
          and(
            eq(invoices.companyId, ctx.companyId),
            eq(invoices.anafUploadIndex, msg.uploadIndex),
            sql`${invoices.anafMessageId} is null`
          )
        )
        .returning({ id: invoices.id });
      if (linked.length > 0) continue;
    }

    // Skip if this message was already archived.
    const existing = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.companyId, ctx.companyId), eq(invoices.anafMessageId, msg.messageId)))
      .limit(1);
    if (existing.length > 0) continue;

    // Download the document ZIP and archive it.
    const client = await getEfacturaClient(db, { grantId: ctx.grantId, cif: ctx.cif, mode: 'live' });
    const zip = await client.downloadDocument(msg.messageId);
    const zipKey = storageKeys.archiveZip(ctx.userId, ctx.companyId, msg.messageId);
    await putObject(zipKey, zip, 'application/zip');

    // Extract the invoice XML for metadata (best effort — archive row exists regardless).
    let meta: ReturnType<typeof extractInvoiceMetadata> | null = null;
    let xmlKey: string | undefined;
    try {
      const xml = pickInvoiceXml(zip);
      if (xml) {
        xmlKey = storageKeys.archiveXml(ctx.userId, ctx.companyId, msg.messageId);
        await putObject(xmlKey, xml, 'application/xml');
        meta = extractInvoiceMetadata(xml.toString('utf8'));
      }
    } catch {
      // keep the ZIP-only archive row
    }

    const counterpartyCif = isInbound ? msg.cifEmitent : msg.cifBeneficiar;
    await db
      .insert(invoices)
      .values({
        companyId: ctx.companyId,
        userId: ctx.userId,
        direction: isInbound ? 'inbound' : 'outbound',
        mode: 'live',
        status: 'received',
        invoiceNumber: meta?.invoiceNumber,
        issueDate: meta?.issueDate,
        dueDate: meta?.dueDate,
        currency: meta?.currency ?? 'RON',
        totalAmount: meta?.totalAmount,
        taxAmount: meta?.taxAmount,
        counterpartyCif: counterpartyCif ?? (isInbound ? meta?.supplierCif : meta?.customerCif),
        counterpartyName: isInbound ? meta?.supplierName : meta?.customerName,
        anafMessageId: msg.messageId,
        anafUploadIndex: msg.uploadIndex,
        zipStorageKey: zipKey,
        xmlStorageKey: xmlKey,
      })
      .onConflictDoNothing();
    newCount += 1;
  }
  return newCount;
}
