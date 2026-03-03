/*
  Warnings:

  - You are about to drop the column `allowedNozzleDiameters` on the `Preset` table. All the data in the column will be lost.
  - You are about to drop the column `minBedX` on the `Preset` table. All the data in the column will be lost.
  - You are about to drop the column `minBedY` on the `Preset` table. All the data in the column will be lost.
  - You are about to drop the column `checksum` on the `PresetDeployment` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `PresetDeployment` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `PresetDeployment` table. All the data in the column will be lost.
  - Added the required column `checksumSha256` to the `PresetDeployment` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "PresetCompatibilityRules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "presetId" TEXT NOT NULL,
    "minBedX" REAL NOT NULL,
    "minBedY" REAL NOT NULL,
    "allowedNozzleDiameters" JSONB NOT NULL,
    CONSTRAINT "PresetCompatibilityRules_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "Preset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Preset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "plasticType" TEXT NOT NULL,
    "colorHex" TEXT NOT NULL,
    "description" TEXT,
    "gcodePath" TEXT NOT NULL,
    "thumbnailPath" TEXT,
    "gcodeMeta" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Preset" ("colorHex", "createdAt", "description", "gcodeMeta", "gcodePath", "id", "plasticType", "thumbnailPath", "title", "updatedAt") SELECT "colorHex", "createdAt", "description", "gcodeMeta", "gcodePath", "id", "plasticType", "thumbnailPath", "title", "updatedAt" FROM "Preset";
DROP TABLE "Preset";
ALTER TABLE "new_Preset" RENAME TO "Preset";
CREATE TABLE "new_PresetDeployment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "presetId" TEXT NOT NULL,
    "printerId" TEXT NOT NULL,
    "remoteFilename" TEXT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PresetDeployment_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "Preset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PresetDeployment_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PresetDeployment" ("id", "presetId", "printerId", "remoteFilename") SELECT "id", "presetId", "printerId", "remoteFilename" FROM "PresetDeployment";
DROP TABLE "PresetDeployment";
ALTER TABLE "new_PresetDeployment" RENAME TO "PresetDeployment";
CREATE UNIQUE INDEX "PresetDeployment_presetId_printerId_key" ON "PresetDeployment"("presetId", "printerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PresetCompatibilityRules_presetId_key" ON "PresetCompatibilityRules"("presetId");
