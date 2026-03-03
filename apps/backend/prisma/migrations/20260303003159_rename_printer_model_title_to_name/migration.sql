/*
  Warnings:

  - You are about to drop the column `title` on the `PrinterModel` table. All the data in the column will be lost.
  - Added the required column `name` to the `PrinterModel` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PrinterModel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_PrinterModel" ("createdAt", "id", "updatedAt") SELECT "createdAt", "id", "updatedAt" FROM "PrinterModel";
DROP TABLE "PrinterModel";
ALTER TABLE "new_PrinterModel" RENAME TO "PrinterModel";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
