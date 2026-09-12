-- Lecture / tutorial / workshop, each pinned to its year's own days.
CREATE TYPE "ClassKind" AS ENUM ('LECTURE', 'TUTORIAL', 'WORKSHOP');

ALTER TABLE "TimetableSlot" ADD COLUMN "kind" "ClassKind" NOT NULL DEFAULT 'LECTURE';

-- Every module is staffed by two teachers; sections are shared between them.
ALTER TABLE "ModuleOffering" ADD COLUMN "coLecturerId" TEXT;
ALTER TABLE "ModuleOffering" ADD CONSTRAINT "ModuleOffering_coLecturerId_fkey"
  FOREIGN KEY ("coLecturerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "TimetableSlot_kind_idx" ON "TimetableSlot"("kind");
