CREATE TABLE "anaf_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"enc_refresh_token" text NOT NULL,
	"enc_access_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_obtained_at" timestamp with time zone NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_refresh_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"mode" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"grant_id" uuid,
	"cif" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"county" text,
	"vat_payer" boolean DEFAULT false NOT NULL,
	"spv_verified_at" timestamp with time zone,
	"archive_enabled" boolean DEFAULT true NOT NULL,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"direction" text NOT NULL,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"invoice_number" text,
	"issue_date" date,
	"due_date" date,
	"currency" text DEFAULT 'RON' NOT NULL,
	"total_amount" numeric(14, 2),
	"tax_amount" numeric(14, 2),
	"counterparty_cif" text,
	"counterparty_name" text,
	"anaf_upload_index" text,
	"anaf_download_id" text,
	"anaf_message_id" text,
	"xml_storage_key" text,
	"zip_storage_key" text,
	"pdf_storage_key" text,
	"request_input" jsonb,
	"error" jsonb,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"messages_found" integer DEFAULT 0 NOT NULL,
	"messages_new" integer DEFAULT 0 NOT NULL,
	"error" jsonb
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"mode" text NOT NULL,
	"invoices_created" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_counters_user_id_day_mode_pk" PRIMARY KEY("user_id","day","mode")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"daily_invoice_limit" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "anaf_grants" ADD CONSTRAINT "anaf_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_grant_id_anaf_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."anaf_grants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "anaf_grants_user_idx" ON "anaf_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_keys_user_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_user_cif_uq" ON "companies" USING btree ("user_id","cif");--> statement-breakpoint
CREATE INDEX "companies_grant_idx" ON "companies" USING btree ("grant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_company_idem_uq" ON "invoices" USING btree ("company_id","idempotency_key") WHERE "invoices"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_company_msg_uq" ON "invoices" USING btree ("company_id","anaf_message_id") WHERE "invoices"."anaf_message_id" is not null;--> statement-breakpoint
CREATE INDEX "invoices_company_dir_status_idx" ON "invoices" USING btree ("company_id","direction","status");--> statement-breakpoint
CREATE INDEX "invoices_company_issue_idx" ON "invoices" USING btree ("company_id","issue_date");--> statement-breakpoint
CREATE INDEX "invoices_user_created_idx" ON "invoices" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "invoices_counterparty_idx" ON "invoices" USING btree ("counterparty_cif");--> statement-breakpoint
CREATE INDEX "sync_runs_company_started_idx" ON "sync_runs" USING btree ("company_id","started_at");