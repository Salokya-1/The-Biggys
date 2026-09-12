-- When a teacher cannot be timetabled: part-time hours, industry days, standing commitments.
CREATE TABLE "TeacherUnavailability" (
  "id"        TEXT NOT NULL,
  "teacherId" TEXT NOT NULL,
  "dayOfWeek" INTEGER NOT NULL,
  "startTime" TEXT NOT NULL,
  "endTime"   TEXT NOT NULL,
  "reason"    TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeacherUnavailability_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TeacherUnavailability_window_check" CHECK ("endTime" > "startTime"),
  CONSTRAINT "TeacherUnavailability_day_check" CHECK ("dayOfWeek" BETWEEN 1 AND 7)
);
CREATE INDEX "TeacherUnavailability_teacherId_dayOfWeek_idx" ON "TeacherUnavailability"("teacherId", "dayOfWeek");
ALTER TABLE "TeacherUnavailability" ADD CONSTRAINT "TeacherUnavailability_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
