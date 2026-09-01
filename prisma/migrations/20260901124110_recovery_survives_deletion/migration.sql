-- DropForeignKey
ALTER TABLE "recoveries" DROP CONSTRAINT "recoveries_finderId_fkey";

-- DropForeignKey
ALTER TABLE "recoveries" DROP CONSTRAINT "recoveries_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "recoveries" DROP CONSTRAINT "recoveries_reportId_fkey";

-- DropIndex
DROP INDEX "reports_search_text_trgm_idx";

-- AlterTable
ALTER TABLE "recoveries" ALTER COLUMN "reportId" DROP NOT NULL,
ALTER COLUMN "ownerId" DROP NOT NULL,
ALTER COLUMN "finderId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "recoveries" ADD CONSTRAINT "recoveries_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recoveries" ADD CONSTRAINT "recoveries_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recoveries" ADD CONSTRAINT "recoveries_finderId_fkey" FOREIGN KEY ("finderId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
