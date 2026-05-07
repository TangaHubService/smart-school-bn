import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const platformTenant = await prisma.tenant.upsert({
    where: { code: 'platform' },
    update: { name: 'Smart School Platform' },
    create: {
      code: 'platform',
      name: 'Smart School Platform',
      domain: 'platform.smartschool.local',
    },
  });

  const superAdminRole = await prisma.role.findFirst({
    where: { tenantId: platformTenant.id, name: 'SUPER_ADMIN' },
  });

  if (!superAdminRole) {
    console.error('SUPER_ADMIN role not found. Run full seed first.');
    process.exit(1);
  }

  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || 'Admin@123';
  const superAdminPasswordHash = await bcrypt.hash(superAdminPassword, 12);
  const superAdminFirstName = process.env.SUPER_ADMIN_FIRST_NAME || 'Admin';
  const superAdminLastName = process.env.SUPER_ADMIN_LAST_NAME || 'SuperUser';

  const envSuperAdminEmails = process.env.SUPER_ADMIN_EMAILS;
  const superAdminEmails = envSuperAdminEmails
    ? envSuperAdminEmails.split(',').map(e => e.trim())
    : ['niyonkurubertin50@gmail.com', 'admin2@smartschool.rw', 'admin3@smartschool.rw'];

  for (const email of superAdminEmails) {
    const user = await prisma.user.upsert({
      where: {
        tenantId_email: {
          tenantId: platformTenant.id,
          email,
        },
      },
      update: {
        passwordHash: superAdminPasswordHash,
        firstName: superAdminFirstName,
        lastName: superAdminLastName,
      },
      create: {
        tenantId: platformTenant.id,
        email,
        passwordHash: superAdminPasswordHash,
        firstName: superAdminFirstName,
        lastName: superAdminLastName,
      },
    });

    await prisma.userRole.upsert({
      where: {
        tenantId_userId_roleId: {
          tenantId: platformTenant.id,
          userId: user.id,
          roleId: superAdminRole.id,
        },
      },
      update: {},
      create: {
        tenantId: platformTenant.id,
        userId: user.id,
        roleId: superAdminRole.id,
      },
    });

    console.log(`Super admin created/updated: ${email}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());