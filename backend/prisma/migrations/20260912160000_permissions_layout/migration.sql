-- AlterTable
ALTER TABLE "ChangeRequest" ADD COLUMN     "reasonCheck" JSONB;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "permissions" JSONB;

-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "layout" JSONB;

