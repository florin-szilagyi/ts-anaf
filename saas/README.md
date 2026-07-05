# fastbill (`saas/`)

Free e-Factura SaaS built on `@florinszilagyi/anaf-ts-sdk`: dashboard UI, public REST API with
test/live API keys, async invoice pipeline, and a permanent archive with weekly ANAF sync.

## Stack

Next.js (App Router) on Vercel · Clerk (accounts) · Drizzle + Postgres via `postgres.js`
(provider-agnostic: Neon, Supabase, RDS, docker) · S3-compatible storage via `@aws-sdk/client-s3`
(R2, Supabase Storage, MinIO) · Inngest (async jobs) · Upstash Redis (rate limiting, with an
in-memory dev fallback).

## Architecture in one paragraph

The ANAF OAuth grant belongs to the certificate holder, not a company — so one grant serves every
CIF the user has SPV rights over (`anaf_grants` → many `companies`). Tokens are AES-256-GCM
encrypted at rest; refresh-token rotation (ANAF rotates on every refresh) is serialized per grant
with `SELECT … FOR UPDATE` in `src/lib/anaf/grantTokens.ts`, and `src/lib/anaf/gateway.ts` is the
only place SDK clients are built (static token shim — the SDK can never refresh on its own).
Invoice creation is async: `POST /api/v1/invoices` inserts a `queued` row and returns 202; the
`invoice-create` Inngest function builds CIUS-RO UBL, uploads to ANAF, polls with backoff and
stores the signed ZIP. Weekly archive sync (`archive-cron` → `archive/company.sync` fan-out) pages
`getMessagesPaginated`, downloads new document ZIPs to object storage and upserts metadata rows,
deduped on `(company_id, anaf_message_id)`.

## Local development

```bash
cp .env.example .env            # fill in values (see below)
pnpm install                    # from repo root
pnpm run build:sdk              # SDK dist consumed by the app
pnpm --filter @florinszilagyi/fastbill run db:migrate
npx inngest-cli@latest dev &    # local Inngest, discovers /api/inngest
pnpm run dev:saas
```

- Postgres: any instance (`docker run -p 5432:5432 -e POSTGRES_PASSWORD=pass postgres:16`).
- S3: MinIO works (`S3_ENDPOINT=http://localhost:9000`).
- Upstash vars empty ⇒ in-memory rate limiter (single process; dev only).
- `FASTBILL_ENCRYPTION_KEY`: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

## Deployment (Vercel)

- Root directory = repo root; build command
  `pnpm --filter @florinszilagyi/anaf-ts-sdk build && pnpm --filter @florinszilagyi/fastbill build`;
  output `saas/.next`.
- Env vars from `.env.example` plus `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
  `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` (Inngest Vercel integration sets these).
- Run `drizzle-kit migrate` from CI, not the build.
- The ANAF OAuth app must have `https://<domain>/api/anaf/callback` registered as redirect URI
  (register early — ANAF changes are slow/manual).

## Tests

```bash
pnpm --filter @florinszilagyi/fastbill run verify   # lint + typecheck + vitest
```

Unit coverage: token crypto (round-trip/tamper), API key hashing, invoice status machine,
request validation, pagination cursors, ZIP/UBL metadata extraction, rate limiter fallback.
Quota atomicity and the `FOR UPDATE` rotation path need a real Postgres — exercise them against a
local instance before touching that code.
