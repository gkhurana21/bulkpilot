-- CreateTable
CREATE TABLE "BulkOperation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "adjustment" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rolledBackAt" DATETIME
);

-- CreateTable
CREATE TABLE "OperationItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "operationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "oldValue" TEXT NOT NULL,
    "newValue" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    CONSTRAINT "OperationItem_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "BulkOperation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BulkOperation_shop_createdAt_idx" ON "BulkOperation"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "OperationItem_operationId_idx" ON "OperationItem"("operationId");
