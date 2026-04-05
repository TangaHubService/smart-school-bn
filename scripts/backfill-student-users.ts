import { PrismaClient, UserStatus } from '@prisma/client';
import bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('--- Starting Backfill of Student User Accounts ---');

  const tenants = await prisma.tenant.findMany({
    where: { isActive: true },
  });

  for (const tenant of tenants) {
    console.log(`Processing Tenant: ${tenant.name} (${tenant.id})`);

    // 1. Find the STUDENT role for this tenant
    const studentRole = await prisma.role.findFirst({
      where: {
        tenantId: tenant.id,
        name: 'STUDENT',
      },
    });

    if (!studentRole) {
      console.warn(`  [WARN] No STUDENT role found for tenant ${tenant.id}. Skipping.`);
      continue;
    }

    // 2. Find all students without a userId
    const students = await prisma.student.findMany({
      where: {
        tenantId: tenant.id,
        userId: null,
        deletedAt: null,
      },
    });

    console.log(`  Found ${students.length} students without a User account.`);

    for (const student of students) {
      const studentCode = student.studentCode.trim().toUpperCase();
      const firstName = student.firstName;
      const lastName = student.lastName;
      
      // Use student's email or a placeholder
      const email = (student.email || `${studentCode}@smartschool.internal`).toLowerCase().trim();

      try {
        await prisma.$transaction(async (tx) => {
          // Check if a user with this email already exists in this tenant
          let user = await tx.user.findUnique({
            where: {
              tenantId_email: {
                tenantId: tenant.id,
                email,
              },
            },
          });

          const passwordHash = await bcrypt.hash(studentCode, 12);

          if (!user) {
            user = await tx.user.create({
              data: {
                tenantId: tenant.id,
                email,
                username: studentCode,
                firstName,
                lastName,
                passwordHash,
                status: UserStatus.ACTIVE,
              },
            });
          } else {
            // Update existing user with username if not set
            await tx.user.update({
              where: { id: user.id },
              data: {
                username: studentCode,
                firstName: firstName || user.firstName,
                lastName: lastName || user.lastName,
              },
            });
          }

          // Ensure role link
          await tx.userRole.upsert({
            where: {
              tenantId_userId_roleId: {
                tenantId: tenant.id,
                userId: user.id,
                roleId: studentRole.id,
              },
            },
            update: {},
            create: {
              tenantId: tenant.id,
              userId: user.id,
              roleId: studentRole.id,
            },
          });

          // Link student to user
          await tx.student.update({
            where: { id: student.id },
            data: { 
              userId: user.id,
              email: student.email || email // Update student record email if it was null
            },
          });
        });

        console.log(`    [OK] Linked student ${studentCode} to user account (${email})`);
      } catch (err: any) {
        console.error(`    [ERROR] Failed to process student ${studentCode}: ${err.message}`);
      }
    }
  }

  console.log('--- Backfill Complete ---');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
