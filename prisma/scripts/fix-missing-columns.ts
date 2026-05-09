import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Adding missing columns to database...\n');

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ResultSnapshot" ADD COLUMN IF NOT EXISTS "verificationToken" TEXT;
    `);
    console.log('✓ Added verificationToken column to ResultSnapshot');
  } catch {
    console.log('- verificationToken column already exists or error (may be ok)');
  }

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ResultSnapshot" ADD COLUMN IF NOT EXISTS "generatedAt" TIMESTAMP;
    `);
    console.log('✓ Added generatedAt column to ResultSnapshot');
  } catch {
    console.log('- generatedAt column already exists or error (may be ok)');
  }

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "TimetableSlot" ADD COLUMN IF NOT EXISTS "subjectId" TEXT;
    `);
    console.log('✓ Added subjectId column to TimetableSlot');
  } catch {
    console.log('- subjectId column already exists or error (may be ok)');
  }

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "TimetableSlot" ALTER COLUMN "courseId" DROP NOT NULL;
    `);
    console.log('✓ Made courseId nullable in TimetableSlot');
  } catch {
    console.log('- courseId already nullable or error (may be ok)');
  }

  console.log('\nDone!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());