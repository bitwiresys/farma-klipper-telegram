/*
  Warnings:

  - You are about to drop the column `createdAt` on the `NotificationLog` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Printer" ADD COLUMN "currentFilename" TEXT;
ALTER TABLE "Printer" ADD COLUMN "currentPrintSessionId" TEXT;
ALTER TABLE "Printer" ADD COLUMN "currentStartTimeSec" INTEGER;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_NotificationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "printerId" TEXT NOT NULL,
    "printSessionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationLog_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_NotificationLog" ("eventType", "id", "printSessionId", "printerId") SELECT "eventType", "id", "printSessionId", "printerId" FROM "NotificationLog";
DROP TABLE "NotificationLog";
ALTER TABLE "new_NotificationLog" RENAME TO "NotificationLog";
CREATE UNIQUE INDEX "NotificationLog_printerId_printSessionId_eventType_key" ON "NotificationLog"("printerId", "printSessionId", "eventType");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "telegramId" TEXT NOT NULL,
    "chatId" TEXT,
    "isAllowed" BOOLEAN NOT NULL DEFAULT false,
    "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyFirstLayer" BOOLEAN NOT NULL DEFAULT true,
    "notifyComplete" BOOLEAN NOT NULL DEFAULT true,
    "notifyError" BOOLEAN NOT NULL DEFAULT true,
    "muteFirstLayerDone" BOOLEAN NOT NULL DEFAULT false,
    "mutePrintComplete" BOOLEAN NOT NULL DEFAULT false,
    "mutePrintError" BOOLEAN NOT NULL DEFAULT false,
    "firstName" TEXT,
    "lastName" TEXT,
    "username" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("chatId", "createdAt", "firstName", "id", "isAllowed", "lastName", "muteFirstLayerDone", "mutePrintComplete", "mutePrintError", "telegramId", "updatedAt", "username") SELECT "chatId", "createdAt", "firstName", "id", "isAllowed", "lastName", "muteFirstLayerDone", "mutePrintComplete", "mutePrintError", "telegramId", "updatedAt", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
