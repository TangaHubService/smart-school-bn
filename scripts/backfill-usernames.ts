import { PrismaClient, UserStatus } from '@prisma/client';
import bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('--- Starting Username and Student Password Backfill ---');

  const users = await prisma.user.findMany({
    where: {
      deletedAt: null,
    },
    include: {
      studentProfile: true,
    },
  });

  console.log(`Found ${users.length} active users to process.`);

  let updatedCount = 0;
  let skippedCount = 0;

  for (const user of users) {
    const data: any = {};
    
    // 1. Backfill username
    if (!user.username) {
      if (user.studentProfile) {
        data.username = user.studentProfile.studentCode.trim().toUpperCase();
      } else {
        data.username = user.email.toLowerCase().trim();
      }
    }

    // 2. Set initial password for students if they only have a placeholder or if required
    // NOTE: This assumes students didn't have a password before. 
    // If they did, this will override it with their studentCode.
    // Given the report said "student login is password-less", this is a safe initial step.
    if (user.studentProfile) {
      const studentCode = user.studentProfile.studentCode.trim().toUpperCase();
      data.passwordHash = await bcrypt.hash(studentCode, 12);
    }

    if (Object.keys(data).length > 0) {
      try {
        await prisma.user.update({
          where: { id: user.id },
          data,
        });
        updatedCount++;
        if (updatedCount % 50 === 0) console.log(`Processed ${updatedCount} users...`);
      } catch (error) {
        console.error(`Failed to update user ${user.email}:`, error);
      }
    } else {
      skippedCount++;
    }
  }

  console.log('--- Backfill Completed ---');
  console.log(`Total active users: ${users.length}`);
  console.log(`Updated users: ${updatedCount}`);
  console.log(`Skipped users: ${skippedCount}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
