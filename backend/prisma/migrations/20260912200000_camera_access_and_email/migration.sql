-- Camera access requests to IT support, and the outbox of every message the system sends.
CREATE TYPE "CameraRequestStatus" AS ENUM ('PENDING', 'SENT', 'APPROVED', 'DENIED');
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

CREATE TABLE "CameraAccessRequest" (
  "id"             TEXT NOT NULL,
  "reference"      TEXT NOT NULL,
  "venueId"        TEXT NOT NULL,
  "examSessionId"  TEXT,
  "slotId"         TEXT,
  "date"           TIMESTAMP(3) NOT NULL,
  "startTime"      TEXT NOT NULL,
  "endTime"        TEXT NOT NULL,
  "reason"         TEXT NOT NULL,
  "status"         "CameraRequestStatus" NOT NULL DEFAULT 'PENDING',
  "requestedById"  TEXT NOT NULL,
  "itSupportEmail" TEXT NOT NULL,
  "notifiedAt"     TIMESTAMP(3),
  "decidedAt"      TIMESTAMP(3),
  "decisionNote"   TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CameraAccessRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CameraAccessRequest_window_check" CHECK ("endTime" > "startTime")
);
CREATE UNIQUE INDEX "CameraAccessRequest_reference_key" ON "CameraAccessRequest"("reference");
CREATE INDEX "CameraAccessRequest_status_date_idx" ON "CameraAccessRequest"("status", "date");

ALTER TABLE "CameraAccessRequest" ADD CONSTRAINT "CameraAccessRequest_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CameraAccessRequest" ADD CONSTRAINT "CameraAccessRequest_examSessionId_fkey" FOREIGN KEY ("examSessionId") REFERENCES "ExamSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CameraAccessRequest" ADD CONSTRAINT "CameraAccessRequest_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "TimetableSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CameraAccessRequest" ADD CONSTRAINT "CameraAccessRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "EmailMessage" (
  "id"          TEXT NOT NULL,
  "to"          TEXT NOT NULL,
  "subject"     TEXT NOT NULL,
  "body"        TEXT NOT NULL,
  "status"      "EmailStatus" NOT NULL DEFAULT 'QUEUED',
  "error"       TEXT,
  "sentAt"      TIMESTAMP(3),
  "relatedType" TEXT,
  "relatedId"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmailMessage_status_createdAt_idx" ON "EmailMessage"("status", "createdAt");
