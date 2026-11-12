-- Per-school AI assistant settings (OpenAI key added by the school admin).
CREATE TABLE "TenantAiSettings" (
    "tenantId" TEXT NOT NULL,
    "openaiApiKeyEncrypted" TEXT,
    "keyLast4" TEXT,
    "model" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "dailyLimitPerStudent" INTEGER NOT NULL DEFAULT 100,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenantAiSettings_pkey" PRIMARY KEY ("tenantId")
);
ALTER TABLE "TenantAiSettings" ADD CONSTRAINT "TenantAiSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
