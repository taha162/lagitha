/*
  Warnings:

  - You are about to drop the column `backKey` on the `identity_verifications` table. All the data in the column will be lost.
  - You are about to drop the column `frontKey` on the `identity_verifications` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "identity_verifications" DROP COLUMN "backKey",
DROP COLUMN "frontKey",
ADD COLUMN     "backImage" BYTEA,
ADD COLUMN     "frontImage" BYTEA;
