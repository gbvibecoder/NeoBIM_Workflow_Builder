-- Convert phoneVerified from BOOLEAN to TIMESTAMP(3) to match production schema.
-- Production code expects to be able to set phoneVerified = null on phone change
-- (see src/app/api/user/profile/route.ts:159), which requires a nullable timestamp.
-- Safe because 0 users currently have a non-null phoneNumber, so no rows are
-- "verified" — all rows have phoneVerified = false which deterministically maps
-- to NULL in the new schema.
-- AlterTable
ALTER TABLE "users" DROP COLUMN "phoneVerified",
ADD COLUMN     "phoneVerified" TIMESTAMP(3);
