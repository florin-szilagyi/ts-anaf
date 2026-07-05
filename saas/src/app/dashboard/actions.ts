'use server';

import { auth, currentUser } from '@clerk/nextjs/server';
import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { anafGrants, apiKeys, companies, type ApiKeyMode } from '@/db/schema';
import { inngest } from '@/inngest/client';
import { getDetailsClient } from '@/lib/anaf/gateway';
import { normalizeCui } from '@/lib/anaf/partyMapping';
import { verifySpvRights } from '@/lib/anaf/spvCheck';
import { generateApiKey } from '@/lib/apiKeys';
import { isApiError } from '@/lib/errors';
import { createInvoice } from '@/lib/invoiceService';
import { getRateLimiters } from '@/lib/redis';
import { ensureUser } from '@/lib/users';
import { parseCreateInvoice, type CreateInvoiceInput } from '@/lib/validation/invoiceInput';

/**
 * Dashboard mutations. Every action funnels into the same lib/ services the
 * public API uses, so UI and API behavior cannot drift.
 */

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

async function requireUser(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error('unauthorized');
  const rl = await getRateLimiters().dashboard.limit(userId);
  if (!rl.success) throw new Error('Too many requests — slow down a little.');
  const user = await currentUser();
  await ensureUser(db, userId, user?.primaryEmailAddress?.emailAddress);
  return userId;
}

function toError(cause: unknown): { ok: false; error: string } {
  if (isApiError(cause)) return { ok: false, error: cause.message };
  return { ok: false, error: cause instanceof Error ? cause.message : 'Something went wrong' };
}

// ---------- companies ----------

export async function addCompany(cuiRaw: string): Promise<ActionResult<{ id: string; verified: boolean }>> {
  try {
    const userId = await requireUser();
    const cui = normalizeCui(cuiRaw);
    if (!/^\d{2,10}$/.test(cui)) {
      return { ok: false, error: 'CUI must be 2–10 digits (RO prefix optional)' };
    }

    const [grant] = await db
      .select({ id: anafGrants.id })
      .from(anafGrants)
      .where(and(eq(anafGrants.userId, userId), eq(anafGrants.status, 'active')))
      .limit(1);

    const lookup = await getDetailsClient().batchGetCompanyData([cui]);
    const data = lookup.success ? lookup.data?.[0] : undefined;
    if (!data) {
      return { ok: false, error: `No company found for CUI ${cui}` };
    }

    const [row] = await db
      .insert(companies)
      .values({
        userId,
        grantId: grant?.id ?? null,
        cif: cui,
        name: data.name,
        address: data.address || null,
        vatPayer: data.scpTva,
      })
      .onConflictDoNothing({ target: [companies.userId, companies.cif] })
      .returning({ id: companies.id });
    if (!row) {
      return { ok: false, error: 'Company already added' };
    }

    // SPV probe (only possible with a grant).
    let verified = false;
    if (grant) {
      const spv = await verifySpvRights(db, { grantId: grant.id, cif: cui });
      verified = spv.verified;
      if (verified) {
        await db
          .update(companies)
          .set({ spvVerifiedAt: sql`now()` })
          .where(eq(companies.id, row.id));
      }
    }

    revalidatePath('/dashboard/companies');
    return { ok: true, data: { id: row.id, verified } };
  } catch (cause) {
    return toError(cause);
  }
}

export async function reverifyCompany(
  companyId: string
): Promise<ActionResult<{ verified: boolean; reason?: string }>> {
  try {
    const userId = await requireUser();
    const [company] = await db
      .select()
      .from(companies)
      .where(and(eq(companies.id, companyId), eq(companies.userId, userId)))
      .limit(1);
    if (!company) return { ok: false, error: 'Company not found' };
    if (!company.grantId) return { ok: false, error: 'Connect ANAF first' };

    const spv = await verifySpvRights(db, { grantId: company.grantId, cif: company.cif });
    await db
      .update(companies)
      .set({ spvVerifiedAt: spv.verified ? sql`now()` : null })
      .where(eq(companies.id, companyId));
    revalidatePath('/dashboard/companies');
    return { ok: true, data: spv };
  } catch (cause) {
    return toError(cause);
  }
}

export async function toggleArchive(companyId: string, enabled: boolean): Promise<ActionResult> {
  try {
    const userId = await requireUser();
    await db
      .update(companies)
      .set({ archiveEnabled: enabled })
      .where(and(eq(companies.id, companyId), eq(companies.userId, userId)));
    revalidatePath('/dashboard/companies');
    return { ok: true };
  } catch (cause) {
    return toError(cause);
  }
}

export async function removeCompany(companyId: string): Promise<ActionResult> {
  try {
    const userId = await requireUser();
    await db.delete(companies).where(and(eq(companies.id, companyId), eq(companies.userId, userId)));
    revalidatePath('/dashboard/companies');
    return { ok: true };
  } catch (cause) {
    return toError(cause);
  }
}

export async function syncNow(companyId: string): Promise<ActionResult> {
  try {
    const userId = await requireUser();
    const [company] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.id, companyId), eq(companies.userId, userId)))
      .limit(1);
    if (!company) return { ok: false, error: 'Company not found' };
    await inngest.send({ name: 'archive/company.sync', data: { companyId, manual: true } });
    revalidatePath('/dashboard/archive');
    return { ok: true };
  } catch (cause) {
    return toError(cause);
  }
}

// ---------- API keys ----------

export async function createKey(
  name: string,
  mode: ApiKeyMode
): Promise<ActionResult<{ secret: string; prefix: string }>> {
  try {
    const userId = await requireUser();
    if (!name.trim()) return { ok: false, error: 'Give the key a name' };
    if (mode !== 'test' && mode !== 'live') return { ok: false, error: 'Invalid mode' };
    const generated = generateApiKey(mode);
    await db.insert(apiKeys).values({
      userId,
      name: name.trim().slice(0, 64),
      prefix: generated.prefix,
      keyHash: generated.hash,
      mode,
    });
    revalidatePath('/dashboard/api-keys');
    // The full secret leaves the server exactly once — here.
    return { ok: true, data: { secret: generated.secret, prefix: generated.prefix } };
  } catch (cause) {
    return toError(cause);
  }
}

export async function revokeKey(keyId: string): Promise<ActionResult> {
  try {
    const userId = await requireUser();
    await db
      .update(apiKeys)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)));
    revalidatePath('/dashboard/api-keys');
    return { ok: true };
  } catch (cause) {
    return toError(cause);
  }
}

/** Rotate = mint a replacement with the same name/mode, then revoke the old key. */
export async function rotateKey(keyId: string): Promise<ActionResult<{ secret: string; prefix: string }>> {
  try {
    const userId = await requireUser();
    const [old] = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
      .limit(1);
    if (!old) return { ok: false, error: 'Key not found' };
    const generated = generateApiKey(old.mode);
    await db.transaction(async (tx) => {
      await tx.insert(apiKeys).values({
        userId,
        name: old.name,
        prefix: generated.prefix,
        keyHash: generated.hash,
        mode: old.mode,
      });
      await tx
        .update(apiKeys)
        .set({ revokedAt: sql`now()` })
        .where(eq(apiKeys.id, keyId));
    });
    revalidatePath('/dashboard/api-keys');
    return { ok: true, data: { secret: generated.secret, prefix: generated.prefix } };
  } catch (cause) {
    return toError(cause);
  }
}

// ---------- invoices ----------

export async function createInvoiceAction(
  mode: ApiKeyMode,
  input: CreateInvoiceInput
): Promise<ActionResult<{ id: string }>> {
  try {
    const userId = await requireUser();
    const parsed = parseCreateInvoice(input);
    const result = await createInvoice(db, { userId, mode, input: parsed });
    revalidatePath('/dashboard/invoices');
    return { ok: true, data: { id: result.id } };
  } catch (cause) {
    return toError(cause);
  }
}

// ---------- lookup helper for forms ----------

export async function lookupCompany(
  cuiRaw: string
): Promise<ActionResult<{ name: string; address: string; vatPayer: boolean }>> {
  try {
    await requireUser();
    const cui = normalizeCui(cuiRaw);
    if (!/^\d{2,10}$/.test(cui)) return { ok: false, error: 'Invalid CUI' };
    const lookup = await getDetailsClient().batchGetCompanyData([cui]);
    const data = lookup.success ? lookup.data?.[0] : undefined;
    if (!data) return { ok: false, error: 'Company not found' };
    return { ok: true, data: { name: data.name, address: data.address ?? '', vatPayer: data.scpTva } };
  } catch (cause) {
    return toError(cause);
  }
}
