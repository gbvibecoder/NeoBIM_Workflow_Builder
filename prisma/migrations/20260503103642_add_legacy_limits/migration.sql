-- AlterTable
ALTER TABLE "users" ADD COLUMN     "legacy_limits" JSONB,
ADD COLUMN     "legacy_limits_set_at" TIMESTAMP(3);
