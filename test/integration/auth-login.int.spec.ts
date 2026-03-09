jest.mock('../../src/db/prisma', () => {
  const prisma = {
    user: { findMany: jest.fn(), update: jest.fn() },
    student: { findMany: jest.fn() },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  return { prisma };
});

jest.mock('bcrypt', () => ({
  __esModule: true,
  default: {
    compare: jest.fn(),
  },
}));

import bcrypt from 'bcrypt';

import { validateBody } from '../../src/common/middleware/validate.middleware';
import { AuthController } from '../../src/modules/auth/auth.controller';
import { loginSchema } from '../../src/modules/auth/auth.schemas';
import { prisma } from '../../src/db/prisma';
import {
  applyError,
  createMockRequest,
  createMockResponse,
  runMiddleware,
} from './test-harness';

const mockedPrisma = prisma as any;
const mockedBcrypt = bcrypt as unknown as { compare: jest.Mock };
const authController = new AuthController();

describe('login integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.$transaction.mockResolvedValue([]);
    mockedPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });
    mockedPrisma.user.update.mockResolvedValue({ id: 'user-1' });
    mockedPrisma.auditLog.create.mockResolvedValue({ id: 1n });
    mockedPrisma.user.findMany.mockResolvedValue([]);
    mockedPrisma.student.findMany.mockResolvedValue([]);
  });

  it('returns tokens on valid staff credentials without tenant code', async () => {
    mockedPrisma.user.findMany.mockResolvedValue([
      {
        id: 'user-1',
        tenantId: 'tenant-1',
        email: 'admin@school.rw',
        passwordHash: 'hash',
        firstName: 'Admin',
        lastName: 'User',
        userRoles: [{ role: { name: 'SCHOOL_ADMIN', permissions: ['users.read'] } }],
      },
    ]);
    mockedBcrypt.compare.mockResolvedValue(true);

    const req = createMockRequest({
      body: {
        loginAs: 'staff',
        email: 'admin@school.rw',
        password: 'Admin@12345',
      },
    });
    const res = createMockResponse();

    await runMiddleware(validateBody(loginSchema), req, res);
    await authController.login(req as any, res as any);

    expect(res.statusCode).toBe(200);
    expect((res.payload as any).data.accessToken).toEqual(expect.any(String));
    expect((res.payload as any).data.refreshToken).toEqual(expect.any(String));
  });

  it('supports legacy staff payload without loginAs', async () => {
    mockedPrisma.user.findMany.mockResolvedValue([
      {
        id: 'user-1',
        tenantId: 'tenant-1',
        email: 'admin@school.rw',
        passwordHash: 'hash',
        firstName: 'Admin',
        lastName: 'User',
        userRoles: [{ role: { name: 'SCHOOL_ADMIN', permissions: ['users.read'] } }],
      },
    ]);
    mockedBcrypt.compare.mockResolvedValue(true);

    const req = createMockRequest({
      body: {
        email: 'admin@school.rw',
        password: 'Admin@12345',
      },
    });
    const res = createMockResponse();

    await runMiddleware(validateBody(loginSchema), req, res);
    await authController.login(req as any, res as any);

    expect(res.statusCode).toBe(200);
    expect((res.payload as any).data.accessToken).toEqual(expect.any(String));
  });

  it('returns auth error for wrong password', async () => {
    mockedPrisma.user.findMany.mockResolvedValue([
      {
        id: 'user-1',
        tenantId: 'tenant-1',
        email: 'admin@school.rw',
        passwordHash: 'hash',
        firstName: 'Admin',
        lastName: 'User',
        userRoles: [{ role: { name: 'SCHOOL_ADMIN', permissions: ['users.read'] } }],
      },
    ]);
    mockedBcrypt.compare.mockResolvedValue(false);

    const req = createMockRequest({
      body: {
        loginAs: 'staff',
        email: 'admin@school.rw',
        password: 'wrong-password',
      },
    });
    const res = createMockResponse();

    await runMiddleware(validateBody(loginSchema), req, res);

    try {
      await authController.login(req as any, res as any);
    } catch (error) {
      applyError(error, req, res);
    }

    expect(res.statusCode).toBe(401);
    expect((res.payload as any).error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('returns tokens on valid student id login', async () => {
    mockedPrisma.student.findMany.mockResolvedValue([
      {
        tenantId: 'tenant-1',
        user: {
          id: 'student-user-1',
          email: 'student@school.rw',
          firstName: 'Alice',
          lastName: 'Uwase',
          status: 'ACTIVE',
          deletedAt: null,
          userRoles: [{ role: { name: 'STUDENT', permissions: ['student.my_courses.read'] } }],
        },
      },
    ]);

    const req = createMockRequest({
      body: {
        loginAs: 'student',
        studentId: 'STU-001',
      },
    });
    const res = createMockResponse();

    await runMiddleware(validateBody(loginSchema), req, res);
    await authController.login(req as any, res as any);

    expect(res.statusCode).toBe(200);
    expect((res.payload as any).data.roles).toContain('STUDENT');
  });
});
