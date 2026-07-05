import { isNotNull } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Mirror of Clerk users — created lazily on first dashboard visit. */
export const users = pgTable('users', {
  id: text('id').primaryKey(), // Clerk user id
  email: text('email'),
  /** "10 live invoices/day by default" — per-account adjustable. */
  dailyInvoiceLimit: integer('daily_invoice_limit').notNull().default(10),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const grantStatuses = ['active', 'expired', 'revoked'] as const;
export type GrantStatus = (typeof grantStatuses)[number];

/**
 * One row per successful ANAF certificate OAuth. The grant belongs to the SPV
 * person (certificate holder), not a company — it serves every CIF the person
 * has SPV rights over. Tokens are AES-256-GCM encrypted at rest.
 */
export const anafGrants = pgTable(
  'anaf_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    encRefreshToken: text('enc_refresh_token').notNull(),
    encAccessToken: text('enc_access_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenObtainedAt: timestamp('refresh_token_obtained_at', { withTimezone: true }).notNull(),
    /** Bumped on every rotation — observability + optimistic checks. */
    tokenVersion: integer('token_version').notNull().default(0),
    status: text('status', { enum: grantStatuses }).notNull().default('active'),
    lastRefreshAt: timestamp('last_refresh_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('anaf_grants_user_idx').on(t.userId)]
);

export const companies = pgTable(
  'companies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    grantId: uuid('grant_id').references(() => anafGrants.id, { onDelete: 'set null' }),
    /** Normalized: digits only (leading RO stripped). */
    cif: text('cif').notNull(),
    name: text('name').notNull(),
    address: text('address'),
    county: text('county'),
    vatPayer: boolean('vat_payer').notNull().default(false),
    /** Null until an SPV-rights probe for this CIF succeeded via the grant. */
    spvVerifiedAt: timestamp('spv_verified_at', { withTimezone: true }),
    archiveEnabled: boolean('archive_enabled').notNull().default(true),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('companies_user_cif_uq').on(t.userId, t.cif), index('companies_grant_idx').on(t.grantId)]
);

export const apiKeyModes = ['test', 'live'] as const;
export type ApiKeyMode = (typeof apiKeyModes)[number];

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Display-only prefix, e.g. "sk_live_a1b2c3d4". Never enough to reconstruct the key. */
    prefix: text('prefix').notNull(),
    /** sha256 hex of the full secret — the only stored form. */
    keyHash: text('key_hash').notNull().unique(),
    mode: text('mode', { enum: apiKeyModes }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('api_keys_user_idx').on(t.userId)]
);

export const invoiceDirections = ['outbound', 'inbound'] as const;
export type InvoiceDirection = (typeof invoiceDirections)[number];

export const invoiceStatuses = [
  'queued',
  'building',
  'uploaded',
  'processing',
  'validated',
  'rejected',
  'failed',
  'received',
] as const;
export type InvoiceStatus = (typeof invoiceStatuses)[number];

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    direction: text('direction', { enum: invoiceDirections }).notNull(),
    mode: text('mode', { enum: apiKeyModes }).notNull(),
    status: text('status', { enum: invoiceStatuses }).notNull(),
    invoiceNumber: text('invoice_number'),
    issueDate: date('issue_date'),
    dueDate: date('due_date'),
    currency: text('currency').notNull().default('RON'),
    totalAmount: numeric('total_amount', { precision: 14, scale: 2 }),
    taxAmount: numeric('tax_amount', { precision: 14, scale: 2 }),
    counterpartyCif: text('counterparty_cif'),
    counterpartyName: text('counterparty_name'),
    /** ANAF indexIncarcare — upload id used for status polling. */
    anafUploadIndex: text('anaf_upload_index'),
    /** ANAF idDescarcare — id of the signed/error ZIP. */
    anafDownloadId: text('anaf_download_id'),
    /** ANAF messages-API id (inbound archive rows and error reconciliation). */
    anafMessageId: text('anaf_message_id'),
    xmlStorageKey: text('xml_storage_key'),
    zipStorageKey: text('zip_storage_key'),
    pdfStorageKey: text('pdf_storage_key'),
    /** Original public-API payload (replay/debug). */
    requestInput: jsonb('request_input'),
    error: jsonb('error'),
    idempotencyKey: text('idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('invoices_company_idem_uq').on(t.companyId, t.idempotencyKey).where(isNotNull(t.idempotencyKey)),
    uniqueIndex('invoices_company_msg_uq').on(t.companyId, t.anafMessageId).where(isNotNull(t.anafMessageId)),
    index('invoices_company_dir_status_idx').on(t.companyId, t.direction, t.status),
    index('invoices_company_issue_idx').on(t.companyId, t.issueDate),
    index('invoices_user_created_idx').on(t.userId, t.createdAt),
    index('invoices_counterparty_idx').on(t.counterpartyCif),
  ]
);

export const syncRunStatuses = ['running', 'ok', 'error'] as const;

export const syncRuns = pgTable(
  'sync_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: text('status', { enum: syncRunStatuses }).notNull().default('running'),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
    messagesFound: integer('messages_found').notNull().default(0),
    messagesNew: integer('messages_new').notNull().default(0),
    error: jsonb('error'),
  },
  (t) => [index('sync_runs_company_started_idx').on(t.companyId, t.startedAt)]
);

/** Atomic per-day invoice counters — quota is enforced in a single upsert. */
export const usageCounters = pgTable(
  'usage_counters',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    mode: text('mode', { enum: apiKeyModes }).notNull(),
    invoicesCreated: integer('invoices_created').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day, t.mode] })]
);
