-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "rate_limit_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'extracting',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "batch_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "file_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "extracted_json" JSONB,
    "merchant" TEXT,
    "receipt_date" DATE,
    "total_minor" INTEGER,
    "currency" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" TEXT NOT NULL,
    "batch_id" UUID NOT NULL,
    "receipt_id" UUID,
    "dedupe_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL,
    "last_error" TEXT,
    "run_after" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "summaries" (
    "batch_id" UUID NOT NULL,
    "summary_json" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "model_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "summaries_pkey" PRIMARY KEY ("batch_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "rate_limit_attempts_key_at_idx" ON "rate_limit_attempts"("key", "at");

-- CreateIndex
CREATE INDEX "batches_user_id_created_at_idx" ON "batches"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_storage_key_key" ON "receipts"("storage_key");

-- CreateIndex
CREATE INDEX "receipts_batch_id_idx" ON "receipts"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_dedupe_key_key" ON "jobs"("dedupe_key");

-- CreateIndex
CREATE INDEX "jobs_kind_status_run_after_idx" ON "jobs"("kind", "status", "run_after");

-- CreateIndex
CREATE INDEX "jobs_receipt_id_idx" ON "jobs"("receipt_id");

-- CreateIndex
CREATE INDEX "jobs_batch_id_idx" ON "jobs"("batch_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────── Hand-written constraints Prisma cannot express (referenced as "CHECK ..." in schema.prisma) ─────────
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase_trimmed" CHECK ("email" = lower(btrim("email"))),
  ADD CONSTRAINT "users_name_length" CHECK (char_length("name") BETWEEN 1 AND 80);

ALTER TABLE "batches"
  ADD CONSTRAINT "batches_status_valid" CHECK ("status" IN ('extracting', 'summarising', 'done'));

ALTER TABLE "receipts"
  ADD CONSTRAINT "receipts_status_valid" CHECK ("status" IN ('pending', 'extracted', 'failed')),
  ADD CONSTRAINT "receipts_size_positive" CHECK ("size_bytes" > 0),
  ADD CONSTRAINT "receipts_total_non_negative" CHECK ("total_minor" IS NULL OR "total_minor" >= 0),
  ADD CONSTRAINT "receipts_currency_iso" CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$'),
  -- An amount without its currency (or the reverse) is invalid.
  ADD CONSTRAINT "receipts_amount_has_currency" CHECK (("total_minor" IS NULL) = ("currency" IS NULL)),
  -- An extracted receipt always has its amount; a pending or failed one never does.
  ADD CONSTRAINT "receipts_extracted_has_amount" CHECK (("status" = 'extracted') = ("total_minor" IS NOT NULL));

ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_kind_valid" CHECK ("kind" IN ('extract', 'summarise')),
  ADD CONSTRAINT "jobs_status_valid" CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed')),
  ADD CONSTRAINT "jobs_extract_has_receipt" CHECK (("kind" = 'extract') = ("receipt_id" IS NOT NULL)),
  ADD CONSTRAINT "jobs_attempts_bounded" CHECK ("attempts" >= 0 AND "attempts" <= "max_attempts"),
  ADD CONSTRAINT "jobs_max_attempts_positive" CHECK ("max_attempts" >= 1),
  -- A running job always has a lease; any other status never does.
  ADD CONSTRAINT "jobs_running_has_lease" CHECK (("status" = 'running') = ("locked_until" IS NOT NULL));

ALTER TABLE "summaries"
  ADD CONSTRAINT "summaries_source_valid" CHECK ("source" IN ('model', 'fallback')),
  ADD CONSTRAINT "summaries_model_id_matches_source" CHECK (("source" = 'model') = ("model_id" IS NOT NULL));
