import postgres from 'postgres';
import { appServerEnv, DATABASE_URL, SEED } from './env';

/**
 * Seed deterministic fixtures. Raw SQL via postgres.js — importing the app's
 * db module would drag the lazy env proxy along; instead we set the same env
 * the server gets and reuse only the pure helpers (crypto, apiKeys).
 */
export async function seed(): Promise<void> {
  // src/lib/crypto reads FASTBILL_ENCRYPTION_KEY through the env proxy — set it first.
  Object.assign(process.env, appServerEnv());
  const { encryptSecret } = await import('../../src/lib/crypto');
  const { hashApiKey, displayPrefix } = await import('../../src/lib/apiKeys');

  const sql = postgres(DATABASE_URL, { max: 1, prepare: false });
  try {
    // Idempotent: wipe fixture users (cascades to grants/companies/keys/invoices).
    await sql`delete from users where id in (${SEED.mainUser}, ${SEED.quotaUser})`;

    await sql`insert into users (id, email, daily_invoice_limit) values
      (${SEED.mainUser}, 'main@e2e.local', 10),
      (${SEED.quotaUser}, 'quota@e2e.local', ${SEED.quotaLimit})`;

    const encAccess = encryptSecret('e2e-access-token');
    const encRefresh = encryptSecret('e2e-refresh-token');

    const [mainGrant] = await sql`insert into anaf_grants
        (user_id, enc_refresh_token, enc_access_token, access_token_expires_at, refresh_token_obtained_at)
      values (${SEED.mainUser}, ${encRefresh}, ${encAccess}, now() + interval '80 days', now())
      returning id`;
    const [quotaGrant] = await sql`insert into anaf_grants
        (user_id, enc_refresh_token, enc_access_token, access_token_expires_at, refresh_token_obtained_at)
      values (${SEED.quotaUser}, ${encRefresh}, ${encAccess}, now() + interval '80 days', now())
      returning id`;

    await sql`insert into companies (id, user_id, grant_id, cif, name, vat_payer, spv_verified_at) values
      (${SEED.verifiedCompanyId}, ${SEED.mainUser}, ${mainGrant.id}, '11111111', 'E2E Verified SRL', true, now()),
      (${SEED.unverifiedCompanyId}, ${SEED.mainUser}, ${mainGrant.id}, '22222222', 'E2E Unverified SRL', true, null),
      (${SEED.quotaCompanyId}, ${SEED.quotaUser}, ${quotaGrant.id}, '33333333', 'E2E Quota SRL', true, now())`;

    const keys: Array<{ user: string; secret: string; name: string; revoked: boolean }> = [
      { user: SEED.mainUser, secret: SEED.skTest, name: 'e2e test key', revoked: false },
      { user: SEED.mainUser, secret: SEED.skLive, name: 'e2e live key', revoked: false },
      { user: SEED.mainUser, secret: SEED.skRevoked, name: 'e2e revoked key', revoked: true },
      { user: SEED.quotaUser, secret: SEED.skLiveQuota, name: 'e2e quota key', revoked: false },
    ];
    for (const k of keys) {
      const mode = k.secret.startsWith('sk_live_') ? 'live' : 'test';
      await sql`insert into api_keys (user_id, name, prefix, key_hash, mode, revoked_at)
        values (${k.user}, ${k.name}, ${displayPrefix(k.secret)}, ${hashApiKey(k.secret)}, ${mode},
                ${k.revoked ? sql`now()` : null})`;
    }
  } finally {
    await sql.end();
  }
}
