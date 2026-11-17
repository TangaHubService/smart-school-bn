-- Platform-wide AI settings managed by the super admin; one OpenAI key shared by all schools.
-- TenantAiSettings is left in place (no data is dropped) but is no longer used.
CREATE TABLE "PlatformAiSettings" (
    "id" TEXT NOT NULL DEFAULT 'platform',
    "openaiApiKeyEncrypted" TEXT,
    "keyLast4" TEXT,
    "model" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "dailyLimitPerStudent" INTEGER NOT NULL DEFAULT 100,
    "dailyLimitPerTeacher" INTEGER NOT NULL DEFAULT 50,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlatformAiSettings_pkey" PRIMARY KEY ("id")
);
