#!/bin/bash
# Run this script to add missing columns that were added to schema but not migrated

echo "Adding missing columns to ResultSnapshot and TimetableSlot..."

psql "$DATABASE_URL" << 'EOF'
-- ResultSnapshot: Add verificationToken column
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ResultSnapshot' AND column_name = 'verificationToken') THEN
    ALTER TABLE "ResultSnapshot" ADD COLUMN "verificationToken" TEXT;
    ALTER TABLE "ResultSnapshot" ADD CONSTRAINT "ResultSnapshot_verificationToken_key" UNIQUE ("verificationToken");
  END IF;
END $$;

-- ResultSnapshot: Add generatedAt column
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ResultSnapshot' AND column_name = 'generatedAt') THEN
    ALTER TABLE "ResultSnapshot" ADD COLUMN "generatedAt" TIMESTAMP;
  END IF;
END $$;

-- TimetableSlot: Add subjectId column
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'TimetableSlot' AND column_name = 'subjectId') THEN
    ALTER TABLE "TimetableSlot" ADD COLUMN "subjectId" TEXT;
  END IF;
END $$;

-- TimetableSlot: Make courseId nullable
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'TimetableSlot' AND column_name = 'courseId' AND is_nullable = 'NO') THEN
    ALTER TABLE "TimetableSlot" ALTER COLUMN "courseId" DROP NOT NULL;
  END IF;
END $$;

SELECT 'Done! Columns added successfully.' as status;
EOF