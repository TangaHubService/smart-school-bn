import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkTenants() {
  try {
    const tenants = await prisma.tenant.findMany({
      select: { id: true, code: true, name: true }
    });
    console.log('Current tenants:');
    tenants.forEach(tenant => {
      console.log(`- ${tenant.id}: ${tenant.code} - ${tenant.name}`);
    });

    // Also check users and their tenantIds
    const users = await prisma.user.findMany({
      select: { id: true, email: true, tenantId: true },
      take: 5
    });
    console.log('\nSample users and their tenantIds:');
    users.forEach(user => {
      console.log(`- ${user.email}: ${user.tenantId}`);
    });
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkTenants();