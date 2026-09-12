
-- CreateEnum
CREATE TYPE "Term" AS ENUM ('AUTUMN', 'SPRING', 'SUMMER');

-- CreateEnum
CREATE TYPE "ExamKind" AS ENUM ('FINAL', 'CLASS_TEST', 'RESIT');

-- CreateEnum
CREATE TYPE "SeatingMode" AS ENUM ('MIXED', 'BY_ID');

-- CreateEnum
CREATE TYPE "ExceptionKind" AS ENUM ('CANCELLED', 'TEACHER_CHANGE', 'ROOM_CHANGE', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "RequestKind" AS ENUM ('TEACHER_ABSENCE', 'STUDENT_ABSENCE', 'SECTION_SWAP');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FeeStatus" AS ENUM ('UNPAID', 'PAID', 'WAIVED');

-- AlterTable
ALTER TABLE "ExamSession" ADD COLUMN     "generatedBy" TEXT,
ADD COLUMN     "kind" "ExamKind" NOT NULL DEFAULT 'FINAL',
ADD COLUMN     "seatingMode" "SeatingMode" NOT NULL DEFAULT 'MIXED',
ADD COLUMN     "semesterId" TEXT;

-- AlterTable
ALTER TABLE "Semester" ADD COLUMN     "examEnd" TIMESTAMP(3),
ADD COLUMN     "examStart" TIMESTAMP(3),
ADD COLUMN     "teachingWeeks" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN     "term" "Term" NOT NULL DEFAULT 'AUTUMN';

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "sectionId" TEXT;

-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "isClassroom" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "Section" (
    "id" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimetableSlot" (
    "id" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "moduleOfferingId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "venueId" TEXT,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "weekFrom" INTEGER NOT NULL DEFAULT 1,
    "weekTo" INTEGER NOT NULL DEFAULT 12,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimetableSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlotException" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "kind" "ExceptionKind" NOT NULL,
    "teacherId" TEXT,
    "venueId" TEXT,
    "startTime" TEXT,
    "endTime" TEXT,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlotException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeRequest" (
    "id" TEXT NOT NULL,
    "kind" "RequestKind" NOT NULL,
    "requesterId" TEXT NOT NULL,
    "slotId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "targetSectionId" TEXT,
    "reason" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamInvigilator" (
    "id" TEXT NOT NULL,
    "examSessionId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ExamInvigilator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeInvoice" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NPR',
    "status" "FeeStatus" NOT NULL DEFAULT 'UNPAID',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "method" TEXT,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmitCard" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "cardNo" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT,

    CONSTRAINT "AdmitCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ExamSessionToSection" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ExamSessionToSection_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Section_intakeId_name_key" ON "Section"("intakeId", "name");

-- CreateIndex
CREATE INDEX "TimetableSlot_semesterId_sectionId_idx" ON "TimetableSlot"("semesterId", "sectionId");

-- CreateIndex
CREATE INDEX "TimetableSlot_teacherId_dayOfWeek_idx" ON "TimetableSlot"("teacherId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "TimetableSlot_venueId_dayOfWeek_idx" ON "TimetableSlot"("venueId", "dayOfWeek");

-- CreateIndex
CREATE UNIQUE INDEX "SlotException_slotId_date_key" ON "SlotException"("slotId", "date");

-- CreateIndex
CREATE INDEX "ChangeRequest_status_createdAt_idx" ON "ChangeRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ChangeRequest_requesterId_idx" ON "ChangeRequest"("requesterId");

-- CreateIndex
CREATE INDEX "ExamInvigilator_userId_idx" ON "ExamInvigilator"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamInvigilator_examSessionId_venueId_userId_key" ON "ExamInvigilator"("examSessionId", "venueId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeInvoice_studentId_semesterId_key" ON "FeeInvoice"("studentId", "semesterId");

-- CreateIndex
CREATE UNIQUE INDEX "AdmitCard_cardNo_key" ON "AdmitCard"("cardNo");

-- CreateIndex
CREATE UNIQUE INDEX "AdmitCard_studentId_semesterId_key" ON "AdmitCard"("studentId", "semesterId");

-- CreateIndex
CREATE INDEX "_ExamSessionToSection_B_index" ON "_ExamSessionToSection"("B");

-- CreateIndex
CREATE INDEX "ExamSession_date_idx" ON "ExamSession"("date");

-- CreateIndex
CREATE INDEX "Student_sectionId_idx" ON "Student"("sectionId");

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "Intake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSlot" ADD CONSTRAINT "TimetableSlot_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "Semester"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSlot" ADD CONSTRAINT "TimetableSlot_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSlot" ADD CONSTRAINT "TimetableSlot_moduleOfferingId_fkey" FOREIGN KEY ("moduleOfferingId") REFERENCES "ModuleOffering"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSlot" ADD CONSTRAINT "TimetableSlot_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSlot" ADD CONSTRAINT "TimetableSlot_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotException" ADD CONSTRAINT "SlotException_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "TimetableSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotException" ADD CONSTRAINT "SlotException_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotException" ADD CONSTRAINT "SlotException_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "TimetableSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_targetSectionId_fkey" FOREIGN KEY ("targetSectionId") REFERENCES "Section"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSession" ADD CONSTRAINT "ExamSession_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "Semester"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamInvigilator" ADD CONSTRAINT "ExamInvigilator_examSessionId_fkey" FOREIGN KEY ("examSessionId") REFERENCES "ExamSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamInvigilator" ADD CONSTRAINT "ExamInvigilator_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamInvigilator" ADD CONSTRAINT "ExamInvigilator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeInvoice" ADD CONSTRAINT "FeeInvoice_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeInvoice" ADD CONSTRAINT "FeeInvoice_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "Semester"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmitCard" ADD CONSTRAINT "AdmitCard_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmitCard" ADD CONSTRAINT "AdmitCard_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "Semester"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ExamSessionToSection" ADD CONSTRAINT "_ExamSessionToSection_A_fkey" FOREIGN KEY ("A") REFERENCES "ExamSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ExamSessionToSection" ADD CONSTRAINT "_ExamSessionToSection_B_fkey" FOREIGN KEY ("B") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

