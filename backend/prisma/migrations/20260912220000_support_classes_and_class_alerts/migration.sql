-- Extra help for the students of a module who are at risk, and the "nobody turned up" alert.
CREATE TYPE "ClassAlertKind" AS ENUM ('TEACHER_ABSENT', 'NO_TEACHER_ASSIGNED', 'ROOM_PROBLEM');
CREATE TYPE "ClassAlertStatus" AS ENUM ('OPEN', 'COVER_ASSIGNED', 'RESOLVED', 'DISMISSED');

CREATE TABLE "SupportClass" (
  "id"               TEXT NOT NULL,
  "moduleOfferingId" TEXT NOT NULL,
  "teacherId"        TEXT NOT NULL,
  "venueId"          TEXT,
  "date"             TIMESTAMP(3) NOT NULL,
  "startTime"        TEXT NOT NULL,
  "endTime"          TEXT NOT NULL,
  "reason"           TEXT NOT NULL,
  "createdById"      TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportClass_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupportClass_window_check" CHECK ("endTime" > "startTime")
);
CREATE INDEX "SupportClass_moduleOfferingId_date_idx" ON "SupportClass"("moduleOfferingId", "date");
ALTER TABLE "SupportClass" ADD CONSTRAINT "SupportClass_moduleOfferingId_fkey" FOREIGN KEY ("moduleOfferingId") REFERENCES "ModuleOffering"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportClass" ADD CONSTRAINT "SupportClass_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportClass" ADD CONSTRAINT "SupportClass_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "_SupportClassStudents" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL,
  CONSTRAINT "_SupportClassStudents_AB_pkey" PRIMARY KEY ("A", "B")
);
CREATE INDEX "_SupportClassStudents_B_index" ON "_SupportClassStudents"("B");
ALTER TABLE "_SupportClassStudents" ADD CONSTRAINT "_SupportClassStudents_A_fkey" FOREIGN KEY ("A") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_SupportClassStudents" ADD CONSTRAINT "_SupportClassStudents_B_fkey" FOREIGN KEY ("B") REFERENCES "SupportClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ClassAlert" (
  "id"             TEXT NOT NULL,
  "slotId"         TEXT NOT NULL,
  "date"           TIMESTAMP(3) NOT NULL,
  "kind"           "ClassAlertKind" NOT NULL DEFAULT 'TEACHER_ABSENT',
  "note"           TEXT,
  "status"         "ClassAlertStatus" NOT NULL DEFAULT 'OPEN',
  "raisedById"     TEXT NOT NULL,
  "coverId"        TEXT,
  "resolvedAt"     TIMESTAMP(3),
  "resolutionNote" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClassAlert_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClassAlert_status_date_idx" ON "ClassAlert"("status", "date");
ALTER TABLE "ClassAlert" ADD CONSTRAINT "ClassAlert_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "TimetableSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClassAlert" ADD CONSTRAINT "ClassAlert_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClassAlert" ADD CONSTRAINT "ClassAlert_coverId_fkey" FOREIGN KEY ("coverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
