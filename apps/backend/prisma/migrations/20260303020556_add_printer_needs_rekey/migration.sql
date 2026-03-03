-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Printer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKeyEncrypted" TEXT NOT NULL,
    "needsRekey" BOOLEAN NOT NULL DEFAULT false,
    "bedX" REAL NOT NULL,
    "bedY" REAL NOT NULL,
    "bedZ" REAL NOT NULL,
    "nozzleDiameter" REAL NOT NULL,
    "modelId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Printer_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "PrinterModel" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Printer" ("apiKeyEncrypted", "baseUrl", "bedX", "bedY", "bedZ", "createdAt", "displayName", "id", "modelId", "nozzleDiameter", "updatedAt") SELECT "apiKeyEncrypted", "baseUrl", "bedX", "bedY", "bedZ", "createdAt", "displayName", "id", "modelId", "nozzleDiameter", "updatedAt" FROM "Printer";
DROP TABLE "Printer";
ALTER TABLE "new_Printer" RENAME TO "Printer";
CREATE UNIQUE INDEX "Printer_baseUrl_key" ON "Printer"("baseUrl");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
