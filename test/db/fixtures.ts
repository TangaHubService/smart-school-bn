import { randomUUID } from 'crypto';

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import { buildDefaultTenantRoles } from '../../src/constants/permissions';
import { prisma } from '../../src/db/prisma';

const ROLE_DEFINITIONS = new Map(buildDefaultTenantRoles().map(role => [role.name, role]));

export type RoleName = 'SCHOOL_ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';

export interface TestUser {
  id: string;
  tenantId: string;
  email: string;
  username: string | null;
  role: RoleName;
}

/** Empties every application table (the database is the disposable `_test` one). */
export async function resetDatabase(): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (!tables.length) return;
  const list = tables.map(t => `"public"."${t.tablename.replace(/"/g, '')}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

function uniqueSuffix() {
  return randomUUID().slice(0, 8);
}

/**
 * A minimal, fully paid school: tenant, school profile, the default roles, one
 * academic year, one grade with two classes, and a PAID invoice covering today
 * so the subscription gate lets requests through.
 */
export async function createSchool(label: string) {
  const suffix = uniqueSuffix();
  const tenant = await prisma.tenant.create({
    data: { code: `${label.toLowerCase()}-${suffix}`, name: `${label} School ${suffix}` },
  });
  await prisma.school.create({
    data: { tenantId: tenant.id, displayName: `${label} School` },
  });

  const now = Date.now();
  await prisma.subscriptionInvoice.create({
    data: {
      tenantId: tenant.id,
      invoiceNumber: `TEST-${suffix}`,
      yearLabel: '2026',
      title: 'Test subscription',
      description: 'Paid test subscription',
      amountDue: 0,
      status: 'PAID',
      periodStart: new Date(now - 30 * 86_400_000),
      periodEnd: new Date(now + 300 * 86_400_000),
      dueDate: new Date(now - 30 * 86_400_000),
    },
  });

  const roles = new Map<RoleName, string>();
  for (const name of ['SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'PARENT'] as RoleName[]) {
    const definition = ROLE_DEFINITIONS.get(name)!;
    const role = await prisma.role.create({
      data: {
        tenantId: tenant.id,
        name,
        description: definition.description,
        isSystem: true,
        permissions: definition.permissions,
      },
    });
    roles.set(name, role.id);
  }

  const academicYear = await prisma.academicYear.create({
    data: {
      tenantId: tenant.id,
      name: '2026',
      startDate: new Date(now - 60 * 86_400_000),
      endDate: new Date(now + 300 * 86_400_000),
    },
  });
  const gradeLevel = await prisma.gradeLevel.create({
    data: { tenantId: tenant.id, code: 'P1', name: 'Primary 1', rank: 1 },
  });
  const classA = await prisma.classRoom.create({
    data: { tenantId: tenant.id, gradeLevelId: gradeLevel.id, code: 'P1A', name: 'P1 A' },
  });
  const classB = await prisma.classRoom.create({
    data: { tenantId: tenant.id, gradeLevelId: gradeLevel.id, code: 'P1B', name: 'P1 B' },
  });

  async function createUser(
    role: RoleName,
    options: { username?: string | null; email?: string; password: string }
  ): Promise<TestUser> {
    const email = options.email ?? `${role.toLowerCase()}-${uniqueSuffix()}@example.test`;
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email,
        username: options.username ?? null,
        firstName: role,
        lastName: label,
        passwordHash: await bcrypt.hash(options.password, 8),
        userRoles: { create: { tenantId: tenant.id, roleId: roles.get(role)! } },
      },
    });
    return { id: user.id, tenantId: tenant.id, email, username: user.username, role };
  }

  /** Student provisioned the way the app does it: username and starter password = code. */
  async function createStudent(studentCode: string, classRoomId: string) {
    const user = await createUser('STUDENT', { username: studentCode, password: studentCode });
    const student = await prisma.student.create({
      data: {
        tenantId: tenant.id,
        studentCode,
        firstName: 'Learner',
        lastName: studentCode,
        userId: user.id,
      },
    });
    await prisma.studentEnrollment.create({
      data: {
        tenantId: tenant.id,
        studentId: student.id,
        academicYearId: academicYear.id,
        classRoomId,
      },
    });
    return { user, student };
  }

  async function createParentOf(studentId: string) {
    const user = await createUser('PARENT', { password: 'Parent-pass-123' });
    const parent = await prisma.parent.create({
      data: {
        tenantId: tenant.id,
        firstName: 'Parent',
        lastName: label,
        email: user.email,
        userId: user.id,
      },
    });
    await prisma.parentStudent.create({
      data: { tenantId: tenant.id, parentId: parent.id, studentId },
    });
    return { user, parent };
  }

  /** A published PDF lesson in `classRoomId`, with its file asset. */
  async function createLessonFile(classRoomId: string, teacher: TestUser) {
    const course = await prisma.course.create({
      data: {
        tenantId: tenant.id,
        academicYearId: academicYear.id,
        classRoomId,
        teacherUserId: teacher.id,
        title: `Course ${uniqueSuffix()}`,
      },
    });
    const asset = await prisma.fileAsset.create({
      data: {
        tenantId: tenant.id,
        uploadedByUserId: teacher.id,
        publicId: `test/${uniqueSuffix()}`,
        secureUrl: 'https://example.test/lesson.pdf',
        originalName: 'lesson.pdf',
        mimeType: 'application/pdf',
        resourceType: 'RAW',
      },
    });
    await prisma.lesson.create({
      data: {
        tenantId: tenant.id,
        courseId: course.id,
        title: 'Lesson with a PDF',
        contentType: 'PDF',
        sequence: 1,
        isPublished: true,
        fileAssetId: asset.id,
        createdByUserId: teacher.id,
      },
    });
    return asset;
  }

  return {
    tenant,
    academicYear,
    classA,
    classB,
    createUser,
    createStudent,
    createParentOf,
    createLessonFile,
  };
}

/** An access token exactly like the ones /auth issues (same secret and claims). */
export function accessTokenFor(user: TestUser): string {
  const permissions = ROLE_DEFINITIONS.get(user.role)!.permissions;
  return jwt.sign(
    {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      roles: [user.role],
      permissions,
      sessionId: randomUUID(),
    },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: '15m' }
  );
}
