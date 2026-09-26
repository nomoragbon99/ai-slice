-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "attempt_errors" JSONB NOT NULL DEFAULT '[]';
