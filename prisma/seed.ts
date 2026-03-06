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
  'students.read',
  'students.manage',
  'attendance.read',
  'attendance.manage',
  'parents.manage',
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

function schoolDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

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
      timezone: 'Africa/Kigali',
      setupCompletedAt: new Date('2026-03-06T08:00:00.000Z'),
    },
    create: {
      tenantId: schoolTenant.id,
      displayName: 'Green School Rwanda',
      city: 'Kigali',
      district: 'Gasabo',
      country: 'Rwanda',
      timezone: 'Africa/Kigali',
      setupCompletedAt: new Date('2026-03-06T08:00:00.000Z'),
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
      permissions: ['students.read', 'attendance.read', 'attendance.manage'],
    },
    create: {
      tenantId: schoolTenant.id,
      name: 'TEACHER',
      description: 'Teacher role',
      isSystem: true,
      permissions: ['students.read', 'attendance.read', 'attendance.manage'],
    },
  });

  const parentRole = await prisma.role.upsert({
    where: {
      tenantId_name: {
        tenantId: schoolTenant.id,
        name: 'PARENT',
      },
    },
    update: {
      permissions: ['parents.my_children.read'],
    },
    create: {
      tenantId: schoolTenant.id,
      name: 'PARENT',
      description: 'Parent portal role',
      isSystem: true,
      permissions: ['parents.my_children.read'],
    },
  });

  const schoolAdminHash = await bcrypt.hash('Admin@12345', 12);
  const teacherHash = await bcrypt.hash('Teacher@12345', 12);
  const parentHash = await bcrypt.hash('Parent@12345', 12);

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

  const teacherUser = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: schoolTenant.id,
        email: 'teacher@school.rw',
      },
    },
    update: {},
    create: {
      tenantId: schoolTenant.id,
      email: 'teacher@school.rw',
      passwordHash: teacherHash,
      firstName: 'Daily',
      lastName: 'Teacher',
    },
  });

  const parentUser = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: schoolTenant.id,
        email: 'parent@school.rw',
      },
    },
    update: {},
    create: {
      tenantId: schoolTenant.id,
      email: 'parent@school.rw',
      passwordHash: parentHash,
      firstName: 'Family',
      lastName: 'Guardian',
    },
  });

  for (const [userId, roleId] of [
    [schoolAdminUser.id, schoolAdminRole.id],
    [teacherUser.id, teacherRole.id],
    [parentUser.id, parentRole.id],
  ] as const) {
    await prisma.userRole.upsert({
      where: {
        tenantId_userId_roleId: {
          tenantId: schoolTenant.id,
          userId,
          roleId,
        },
      },
      update: {},
      create: {
        tenantId: schoolTenant.id,
        userId,
        roleId,
      },
    });
  }

  const academicYear = await prisma.academicYear.upsert({
    where: {
      tenantId_name: {
        tenantId: schoolTenant.id,
        name: '2026 Academic Year',
      },
    },
    update: {
      startDate: schoolDate('2026-01-01'),
      endDate: schoolDate('2026-12-31'),
      isCurrent: true,
      isActive: true,
    },
    create: {
      tenantId: schoolTenant.id,
      name: '2026 Academic Year',
      startDate: schoolDate('2026-01-01'),
      endDate: schoolDate('2026-12-31'),
      isCurrent: true,
      isActive: true,
    },
  });

  await prisma.term.upsert({
    where: {
      tenantId_academicYearId_sequence: {
        tenantId: schoolTenant.id,
        academicYearId: academicYear.id,
        sequence: 1,
      },
    },
    update: {
      name: 'Term 1',
      startDate: schoolDate('2026-01-08'),
      endDate: schoolDate('2026-04-12'),
      isActive: true,
    },
    create: {
      tenantId: schoolTenant.id,
      academicYearId: academicYear.id,
      name: 'Term 1',
      sequence: 1,
      startDate: schoolDate('2026-01-08'),
      endDate: schoolDate('2026-04-12'),
      isActive: true,
    },
  });

  const gradeLevel = await prisma.gradeLevel.upsert({
    where: {
      tenantId_code: {
        tenantId: schoolTenant.id,
        code: 'G1',
      },
    },
    update: {
      name: 'Grade 1',
      rank: 1,
      isActive: true,
    },
    create: {
      tenantId: schoolTenant.id,
      code: 'G1',
      name: 'Grade 1',
      rank: 1,
      isActive: true,
    },
  });

  const classRoom = await prisma.classRoom.upsert({
    where: {
      tenantId_code: {
        tenantId: schoolTenant.id,
        code: 'G1-A',
      },
    },
    update: {
      gradeLevelId: gradeLevel.id,
      name: 'Grade 1 A',
      capacity: 35,
      isActive: true,
    },
    create: {
      tenantId: schoolTenant.id,
      gradeLevelId: gradeLevel.id,
      code: 'G1-A',
      name: 'Grade 1 A',
      capacity: 35,
      isActive: true,
    },
  });

  await prisma.subject.upsert({
    where: {
      tenantId_code: {
        tenantId: schoolTenant.id,
        code: 'MATH',
      },
    },
    update: {
      name: 'Mathematics',
      isCore: true,
      isActive: true,
    },
    create: {
      tenantId: schoolTenant.id,
      code: 'MATH',
      name: 'Mathematics',
      description: 'Core mathematics subject',
      isCore: true,
      isActive: true,
    },
  });

  const parentProfile = await prisma.parent.upsert({
    where: {
      tenantId_email: {
        tenantId: schoolTenant.id,
        email: 'parent@school.rw',
      },
    },
    update: {
      userId: parentUser.id,
      parentCode: 'PAR-001',
      firstName: 'Family',
      lastName: 'Guardian',
      phone: '+250788000001',
      isActive: true,
    },
    create: {
      tenantId: schoolTenant.id,
      userId: parentUser.id,
      parentCode: 'PAR-001',
      firstName: 'Family',
      lastName: 'Guardian',
      email: 'parent@school.rw',
      phone: '+250788000001',
      isActive: true,
    },
  });

  const studentOne = await prisma.student.upsert({
    where: {
      tenantId_studentCode: {
        tenantId: schoolTenant.id,
        studentCode: 'STU-001',
      },
    },
    update: {
      firstName: 'Alice',
      lastName: 'Uwase',
      gender: 'FEMALE',
      isActive: true,
      deletedAt: null,
    },
    create: {
      tenantId: schoolTenant.id,
      studentCode: 'STU-001',
      firstName: 'Alice',
      lastName: 'Uwase',
      gender: 'FEMALE',
      dateOfBirth: schoolDate('2016-05-20'),
      isActive: true,
    },
  });

  const studentTwo = await prisma.student.upsert({
    where: {
      tenantId_studentCode: {
        tenantId: schoolTenant.id,
        studentCode: 'STU-002',
      },
    },
    update: {
      firstName: 'Eric',
      lastName: 'Ndayisaba',
      gender: 'MALE',
      isActive: true,
      deletedAt: null,
    },
    create: {
      tenantId: schoolTenant.id,
      studentCode: 'STU-002',
      firstName: 'Eric',
      lastName: 'Ndayisaba',
      gender: 'MALE',
      dateOfBirth: schoolDate('2016-08-11'),
      isActive: true,
    },
  });

  await prisma.studentEnrollment.upsert({
    where: {
      tenantId_studentId_academicYearId: {
        tenantId: schoolTenant.id,
        studentId: studentOne.id,
        academicYearId: academicYear.id,
      },
    },
    update: {
      classRoomId: classRoom.id,
      isActive: true,
      endedAt: null,
    },
    create: {
      tenantId: schoolTenant.id,
      studentId: studentOne.id,
      academicYearId: academicYear.id,
      classRoomId: classRoom.id,
      enrolledAt: schoolDate('2026-01-08'),
      isActive: true,
    },
  });

  await prisma.studentEnrollment.upsert({
    where: {
      tenantId_studentId_academicYearId: {
        tenantId: schoolTenant.id,
        studentId: studentTwo.id,
        academicYearId: academicYear.id,
      },
    },
    update: {
      classRoomId: classRoom.id,
      isActive: true,
      endedAt: null,
    },
    create: {
      tenantId: schoolTenant.id,
      studentId: studentTwo.id,
      academicYearId: academicYear.id,
      classRoomId: classRoom.id,
      enrolledAt: schoolDate('2026-01-08'),
      isActive: true,
    },
  });

  await prisma.parentStudent.upsert({
    where: {
      tenantId_parentId_studentId: {
        tenantId: schoolTenant.id,
        parentId: parentProfile.id,
        studentId: studentOne.id,
      },
    },
    update: {
      relationship: 'GUARDIAN',
      isPrimary: true,
      deletedAt: null,
    },
    create: {
      tenantId: schoolTenant.id,
      parentId: parentProfile.id,
      studentId: studentOne.id,
      relationship: 'GUARDIAN',
      isPrimary: true,
    },
  });

  await prisma.parentStudent.upsert({
    where: {
      tenantId_parentId_studentId: {
        tenantId: schoolTenant.id,
        parentId: parentProfile.id,
        studentId: studentTwo.id,
      },
    },
    update: {
      relationship: 'GUARDIAN',
      isPrimary: false,
      deletedAt: null,
    },
    create: {
      tenantId: schoolTenant.id,
      parentId: parentProfile.id,
      studentId: studentTwo.id,
      relationship: 'GUARDIAN',
      isPrimary: false,
    },
  });

  const todaySession = await prisma.attendanceSession.upsert({
    where: {
      tenantId_classRoomId_sessionDate: {
        tenantId: schoolTenant.id,
        classRoomId: classRoom.id,
        sessionDate: schoolDate('2026-03-06'),
      },
    },
    update: {
      academicYearId: academicYear.id,
      editedByUserId: teacherUser.id,
      status: 'OPEN',
    },
    create: {
      tenantId: schoolTenant.id,
      classRoomId: classRoom.id,
      academicYearId: academicYear.id,
      sessionDate: schoolDate('2026-03-06'),
      status: 'OPEN',
      createdByUserId: teacherUser.id,
      editedByUserId: teacherUser.id,
    },
  });

  const yesterdaySession = await prisma.attendanceSession.upsert({
    where: {
      tenantId_classRoomId_sessionDate: {
        tenantId: schoolTenant.id,
        classRoomId: classRoom.id,
        sessionDate: schoolDate('2026-03-05'),
      },
    },
    update: {
      academicYearId: academicYear.id,
      editedByUserId: teacherUser.id,
      status: 'OPEN',
    },
    create: {
      tenantId: schoolTenant.id,
      classRoomId: classRoom.id,
      academicYearId: academicYear.id,
      sessionDate: schoolDate('2026-03-05'),
      status: 'OPEN',
      createdByUserId: teacherUser.id,
      editedByUserId: teacherUser.id,
    },
  });

  for (const [sessionId, attendanceDate, studentId, status, remarks] of [
    [todaySession.id, schoolDate('2026-03-06'), studentOne.id, 'PRESENT', null],
    [todaySession.id, schoolDate('2026-03-06'), studentTwo.id, 'ABSENT', 'Family trip'],
    [yesterdaySession.id, schoolDate('2026-03-05'), studentOne.id, 'LATE', 'Traffic delay'],
    [yesterdaySession.id, schoolDate('2026-03-05'), studentTwo.id, 'EXCUSED', 'Clinic visit'],
  ] as const) {
    await prisma.attendanceRecord.upsert({
      where: {
        tenantId_classRoomId_attendanceDate_studentId: {
          tenantId: schoolTenant.id,
          classRoomId: classRoom.id,
          attendanceDate,
          studentId,
        },
      },
      update: {
        sessionId,
        status,
        remarks,
        editedByUserId: teacherUser.id,
      },
      create: {
        tenantId: schoolTenant.id,
        sessionId,
        classRoomId: classRoom.id,
        studentId,
        attendanceDate,
        status,
        remarks,
        markedByUserId: teacherUser.id,
        editedByUserId: teacherUser.id,
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      tenantId: schoolTenant.id,
      actorUserId: schoolAdminUser.id,
      event: 'SEED_COMPLETED',
      entity: 'Tenant',
      entityId: schoolTenant.id,
      payload: {
        createdRoles: [schoolAdminRole.name, teacherRole.name, parentRole.name],
        sampleLogins: {
          superAdmin: 'superadmin@smartschool.rw / SuperAdmin@12345',
          schoolAdmin: 'admin@school.rw / Admin@12345',
          teacher: 'teacher@school.rw / Teacher@12345',
          parent: 'parent@school.rw / Parent@12345',
        },
        sampleSchoolCode: 'gs-rwanda',
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

