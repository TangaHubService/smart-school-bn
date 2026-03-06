import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const SCHOOL_ADMIN_PERMISSIONS = [
  'school.setup.manage',
  'academic_year.manage',
  'term.manage',
  'grade_level.manage',
  'class_room.manage',
  'subject.manage',
  'staff.invite',
  'users.read',
  'roles.read',
];

const SUPER_ADMIN_PERMISSIONS = [
  'tenants.create',
  'tenants.read',
  'tenants.manage',
  'users.read',
  'roles.read',
];

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

  const superAdminRole = await prisma.role.upsert({
    where: {
      tenantId_name: {
        tenantId: platformTenant.id,
        name: 'SUPER_ADMIN',
      },
    },
    update: {
      permissions: SUPER_ADMIN_PERMISSIONS,
    },
    create: {
      tenantId: platformTenant.id,
      name: 'SUPER_ADMIN',
      description: 'Platform super administrator role',
      isSystem: true,
      permissions: SUPER_ADMIN_PERMISSIONS,
    },
  });

  const superAdminPasswordHash = await bcrypt.hash('SuperAdmin@12345', 12);

  const superAdminUser = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: platformTenant.id,
        email: 'superadmin@smartschool.rw',
      },
    },
    update: {},
    create: {
      tenantId: platformTenant.id,
      email: 'superadmin@smartschool.rw',
      passwordHash: superAdminPasswordHash,
      firstName: 'Platform',
      lastName: 'Admin',
    },
  });

  await prisma.userRole.upsert({
    where: {
      tenantId_userId_roleId: {
        tenantId: platformTenant.id,
        userId: superAdminUser.id,
        roleId: superAdminRole.id,
      },
    },
    update: {},
    create: {
      tenantId: platformTenant.id,
      userId: superAdminUser.id,
      roleId: superAdminRole.id,
    },
  });

  const schoolTenant = await prisma.tenant.upsert({
    where: { code: 'gs-rwanda' },
    update: {
      name: 'Green School Rwanda',
    },
    create: {
      code: 'gs-rwanda',
      name: 'Green School Rwanda',
      domain: 'green-school-rwanda.local',
    },
  });

  await prisma.school.upsert({
    where: { tenantId: schoolTenant.id },
    update: {
      displayName: 'Green School Rwanda',
      city: 'Kigali',
      district: 'Gasabo',
      country: 'Rwanda',
    },
    create: {
      tenantId: schoolTenant.id,
      displayName: 'Green School Rwanda',
      city: 'Kigali',
      district: 'Gasabo',
      country: 'Rwanda',
    },
  });

  const schoolAdminRole = await prisma.role.upsert({
    where: {
      tenantId_name: {
        tenantId: schoolTenant.id,
        name: 'SCHOOL_ADMIN',
      },
    },
    update: {
      permissions: SCHOOL_ADMIN_PERMISSIONS,
    },
    create: {
      tenantId: schoolTenant.id,
      name: 'SCHOOL_ADMIN',
      description: 'Default school administrator role',
      isSystem: true,
      permissions: SCHOOL_ADMIN_PERMISSIONS,
    },
  });

  const teacherRole = await prisma.role.upsert({
    where: {
      tenantId_name: {
        tenantId: schoolTenant.id,
        name: 'TEACHER',
      },
    },
    update: {
      permissions: ['students.read', 'attendance.manage'],
    },
    create: {
      tenantId: schoolTenant.id,
      name: 'TEACHER',
      description: 'Teacher role',
      isSystem: true,
      permissions: ['students.read', 'attendance.manage'],
    },
  });

  const schoolAdminHash = await bcrypt.hash('Admin@12345', 12);

  const schoolAdminUser = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: schoolTenant.id,
        email: 'admin@school.rw',
      },
    },
    update: {},
    create: {
      tenantId: schoolTenant.id,
      email: 'admin@school.rw',
      passwordHash: schoolAdminHash,
      firstName: 'System',
      lastName: 'Admin',
    },
  });

  await prisma.userRole.upsert({
    where: {
      tenantId_userId_roleId: {
        tenantId: schoolTenant.id,
        userId: schoolAdminUser.id,
        roleId: schoolAdminRole.id,
      },
    },
    update: {},
    create: {
      tenantId: schoolTenant.id,
      userId: schoolAdminUser.id,
      roleId: schoolAdminRole.id,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: schoolTenant.id,
      actorUserId: schoolAdminUser.id,
      event: 'SEED_COMPLETED',
      entity: 'Tenant',
      entityId: schoolTenant.id,
      payload: {
        createdRoles: [schoolAdminRole.name, teacherRole.name],
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
