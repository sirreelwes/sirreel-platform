ALTER TABLE "email_threads" ADD COLUMN IF NOT EXISTS "ai_summary" TEXT;
ALTER TABLE "email_threads" ADD COLUMN IF NOT EXISTS "ai_summary_at" TIMESTAMP(3);
