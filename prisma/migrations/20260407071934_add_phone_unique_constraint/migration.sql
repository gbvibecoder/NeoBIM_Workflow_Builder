-- Add unique constraint to phoneNumber so it can serve as a login identifier
-- alongside email. (No SMS verification yet — phoneVerified stays false.)
-- Verified zero duplicates in production before applying.
CREATE UNIQUE INDEX "users_phoneNumber_key" ON "users"("phoneNumber");
