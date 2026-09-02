-- Login moves from phone to email.
--
-- `phone` becomes optional rather than being dropped: it is still the
-- identifier when an SMS driver is configured, and existing accounts keep it.
-- Postgres allows many NULLs under a UNIQUE index, so both columns can be
-- unique-and-optional at once.

CREATE TYPE "OtpChannel" AS ENUM ('EMAIL', 'SMS');

-- users -------------------------------------------------------------------
ALTER TABLE "users" ADD COLUMN "email" TEXT;
ALTER TABLE "users" ALTER COLUMN "phone" DROP NOT NULL;
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- otp_challenges ----------------------------------------------------------
-- Renamed, not recreated: in-flight codes keep working across the deploy.
ALTER TABLE "otp_challenges" RENAME COLUMN "phone" TO "identifier";
ALTER TABLE "otp_challenges"
  ADD COLUMN "channel" "OtpChannel" NOT NULL DEFAULT 'EMAIL';

-- Everything already in the table was delivered by SMS.
UPDATE "otp_challenges" SET "channel" = 'SMS';

DROP INDEX IF EXISTS "otp_challenges_phone_createdAt_idx";
CREATE INDEX "otp_challenges_identifier_createdAt_idx"
  ON "otp_challenges"("identifier", "createdAt");
