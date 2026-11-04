-- A cancelled (VOID) invoice must not stop a corrected invoice being issued for
-- the same period. Partial index, so it is not declared in schema.prisma.
DROP INDEX "SubscriptionInvoice_tenantId_yearLabel_periodStart_key";

CREATE UNIQUE INDEX "SubscriptionInvoice_tenantId_yearLabel_periodStart_active_key"
  ON "SubscriptionInvoice"("tenantId", "yearLabel", "periodStart")
  WHERE "status" <> 'VOID';
