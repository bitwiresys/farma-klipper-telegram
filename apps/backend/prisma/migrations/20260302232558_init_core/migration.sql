-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "telegramId" TEXT NOT NULL,
    "chatId" TEXT,
    "isAllowed" BOOLEAN NOT NULL DEFAULT false,
    "muteFirstLayerDone" BOOLEAN NOT NULL DEFAULT false,
    "mutePrintComplete" BOOLEAN NOT NULL DEFAULT false,
    "mutePrintError" BOOLEAN NOT NULL DEFAULT false,
    "firstName" TEXT,
    "lastName" TEXT,
    "username" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PrinterModel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Printer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKeyEncrypted" TEXT NOT NULL,
    "bedX" REAL NOT NULL,
    "bedY" REAL NOT NULL,
    "bedZ" REAL NOT NULL,
    "nozzleDiameter" REAL NOT NULL,
    "modelId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Printer_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "PrinterModel" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Preset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "plasticType" TEXT NOT NULL,
    "colorHex" TEXT NOT NULL,
    "description" TEXT,
    "gcodePath" TEXT NOT NULL,
    "thumbnailPath" TEXT,
    "gcodeMeta" JSONB,
    "allowedNozzleDiameters" JSONB NOT NULL,
    "minBedX" REAL NOT NULL,
    "minBedY" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PresetAllowedModel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "presetId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    CONSTRAINT "PresetAllowedModel_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "Preset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PresetAllowedModel_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "PrinterModel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PresetDeployment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "presetId" TEXT NOT NULL,
    "printerId" TEXT NOT NULL,
    "remoteFilename" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PresetDeployment_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "Preset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PresetDeployment_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PrintHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "printerId" TEXT NOT NULL,
    "printSessionId" TEXT,
    "filename" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "printDurationSec" INTEGER,
    "totalDurationSec" INTEGER,
    "filamentUsedMm" REAL,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PrintHistory_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "printerId" TEXT NOT NULL,
    "printSessionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationLog_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "Printer_baseUrl_key" ON "Printer"("baseUrl");

-- CreateIndex
CREATE UNIQUE INDEX "PresetAllowedModel_presetId_modelId_key" ON "PresetAllowedModel"("presetId", "modelId");

-- CreateIndex
CREATE UNIQUE INDEX "PresetDeployment_presetId_printerId_key" ON "PresetDeployment"("presetId", "printerId");

-- CreateIndex
CREATE INDEX "PrintHistory_printerId_idx" ON "PrintHistory"("printerId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationLog_printerId_printSessionId_eventType_key" ON "NotificationLog"("printerId", "printSessionId", "eventType");
