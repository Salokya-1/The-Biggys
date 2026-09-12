-- DropIndex
DROP INDEX "Module_code_key";

-- CreateIndex
CREATE INDEX "Module_code_idx" ON "Module"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Module_programmeId_code_key" ON "Module"("programmeId", "code");

