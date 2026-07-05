/**
 * Shared constants for the e2e harness. Both playwright.config.ts (webServer
 * env) and global-setup (postgres/seed/stub) import from here so every piece
 * agrees on ports, keys and seeded fixtures.
 */

export const E2E_PORT = 3100;
export const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

export const PG_PORT = 54329;
export const PG_DIR = '/tmp/fastbill-e2e-pg';
export const PG_SOCKET_DIR = '/tmp/fastbill-e2e-pg-sock';
export const PG_BIN_CANDIDATES = ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', ''];
/** When E2E_DATABASE_URL is provided we use it as-is; otherwise a scratch instance is initdb'd. */
export const MANAGES_PG = !process.env.E2E_DATABASE_URL;
export const DATABASE_URL = process.env.E2E_DATABASE_URL ?? `postgres://postgres@127.0.0.1:${PG_PORT}/fastbill_e2e`;

export const INNGEST_PORT = 58288;
export const INNGEST_EVENT_KEY = 'e2e-event-key';
export const INNGEST_BASE_URL = `http://127.0.0.1:${INNGEST_PORT}`;
export const INNGEST_EVENTS_FILE = '/tmp/fastbill-e2e-inngest-events.jsonl';

/** Deterministic 32-byte key — tests only, never a real deployment value. */
export const ENCRYPTION_KEY = Buffer.from('fastbill-e2e-encryption-key-32b!').toString('base64');

// Production-style dummy key: dev-instance keys (pk_test_) make clerkMiddleware
// bounce every first visit through a "dev browser" handshake redirect to the
// (nonexistent) instance domain, breaking offline e2e page loads.
export const DUMMY_CLERK_PK = 'pk_live_Y2xlcmsuZXhhbXBsZS5jb20k'; // clerk.example.com$

export const HAS_CLERK =
  Boolean(process.env.CLERK_SECRET_KEY) &&
  Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) &&
  Boolean(process.env.E2E_CLERK_USER_EMAIL) &&
  Boolean(process.env.E2E_CLERK_USER_PASSWORD);

/** Fixture ids/secrets seeded by global-setup. */
export const SEED = {
  mainUser: 'user_e2e_main',
  quotaUser: 'user_e2e_quota',
  quotaLimit: 3,
  verifiedCompanyId: 'a0000000-0000-4000-8000-000000000001',
  unverifiedCompanyId: 'a0000000-0000-4000-8000-000000000002',
  quotaCompanyId: 'a0000000-0000-4000-8000-000000000003',
  skTest: 'sk_test_e2e_main_0123456789abcdef0123456789abcdef',
  skLive: 'sk_live_e2e_main_0123456789abcdef0123456789abcdef',
  skRevoked: 'sk_test_e2e_revoked_0123456789abcdef012345678',
  skLiveQuota: 'sk_live_e2e_quota_0123456789abcdef012345678',
} as const;

/** Full env for the app under test (webServer) and for setup-time imports of src/lib modules. */
export function appServerEnv(): Record<string, string> {
  return {
    DATABASE_URL,
    FASTBILL_ENCRYPTION_KEY: ENCRYPTION_KEY,
    ANAF_CLIENT_ID: 'e2e-client-id',
    ANAF_CLIENT_SECRET: 'e2e-client-secret',
    ANAF_REDIRECT_URI: `${BASE_URL}/api/anaf/callback`,
    S3_ENDPOINT: 'http://127.0.0.1:59000',
    S3_REGION: 'auto',
    S3_ACCESS_KEY_ID: 'e2e',
    S3_SECRET_ACCESS_KEY: 'e2e',
    S3_BUCKET: 'fastbill-e2e',
    INNGEST_BASE_URL,
    INNGEST_EVENT_KEY,
    NEXT_PUBLIC_APP_URL: BASE_URL,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? DUMMY_CLERK_PK,
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY ?? 'sk_live_dummy',
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: '/sign-in',
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: '/sign-up',
    NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: '/dashboard',
    // No Upstash vars — the app falls back to its in-memory limiter.
  };
}
