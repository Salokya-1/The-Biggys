-- Rooms have a purpose, and a lecture combines every group of the cohort into one booking.
CREATE TYPE "RoomType" AS ENUM ('HALL', 'LECTURE_THEATRE', 'TUTORIAL_ROOM', 'SEMINAR_ROOM', 'LAB');

ALTER TABLE "Venue" ADD COLUMN "roomType" "RoomType" NOT NULL DEFAULT 'TUTORIAL_ROOM';

-- Implicit many-to-many between TimetableSlot and Section (Prisma relation "SlotGroups").
CREATE TABLE "_SlotGroups" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL,
  CONSTRAINT "_SlotGroups_AB_pkey" PRIMARY KEY ("A", "B")
);
CREATE INDEX "_SlotGroups_B_index" ON "_SlotGroups"("B");
ALTER TABLE "_SlotGroups" ADD CONSTRAINT "_SlotGroups_A_fkey" FOREIGN KEY ("A") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_SlotGroups" ADD CONSTRAINT "_SlotGroups_B_fkey" FOREIGN KEY ("B") REFERENCES "TimetableSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
