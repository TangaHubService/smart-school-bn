-- Add verificationToken and generatedAt columns to ResultSnapshot
ALTER TABLE "ResultSnapshot" ADD COLUMN IF NOT EXISTS "verificationToken" TEXT;

ALTER TABLE "ResultSnapshot" ADD COLUMN IF NOT EXISTS "generatedAt" TIMESTAMP;

-- Add unique constraint if it doesn't exist (handle case where columns already exist but constraint was missing)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'ResultSnapshot_verificationToken_key'
    ) THEN
        ALTER TABLE "ResultSnapshot" ADD CONSTRAINT "ResultSnapshot_verificationToken_key" UNIQUE ("verificationToken");
    END IF;
END $$;