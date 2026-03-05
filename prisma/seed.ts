import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { code: 'gs-rwanda' },
    update: {},
    create: {
      code: 'gs-rwanda',
      name: 'Green School Rwanda',
      domain: 'green-school-rwanda.local',
    },
  });

  const adminRole = await prisma.role.upsert({
    where: {
      tenantId_name: {
        tenantId: tenant.id,
        name: 'SCHOOL_ADMIN',
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'SCHOOL_ADMIN',
      description: 'Default school administrator role',
      isSystem: true,
      permissions: [
        'users.read',
        'users.manage',
        'roles.read',
        'roles.manage',
      ],
    },
  });

  const teacherRole = await prisma.role.upsert({
    where: {
      tenantId_name: {
        tenantId: tenant.id,
        name: 'TEACHER',
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'TEACHER',
      description: 'Teacher role',
      isSystem: true,
      permissions: ['students.read', 'attendance.manage'],
    },
  });

  const passwordHash = await bcrypt.hash('Admin@12345', 12);

  const adminUser = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: tenant.id,
        email: 'admin@school.rw',
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'admin@school.rw',
      passwordHash,
      firstName: 'System',
      lastName: 'Admin',
    },
  });

  await prisma.userRole.upsert({
    where: {
      tenantId_userId_roleId: {
        tenantId: tenant.id,
        userId: adminUser.id,
        roleId: adminRole.id,
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      userId: adminUser.id,
      roleId: adminRole.id,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.id,
      actorUserId: adminUser.id,
      event: 'SEED_COMPLETED',
      entity: 'Tenant',
      entityId: tenant.id,
      payload: {
        createdRoles: [adminRole.name, teacherRole.name],
      },
    },
  });
}

void main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
