import jwt from 'jsonwebtoken';

import { AuthService } from '../../src/modules/auth/auth.service';

jest.mock('../../src/db/prisma', () => {
  const prisma = {
    user: { findMany: jest.fn(), update: jest.fn() },
    student: { findMany: jest.fn() },
    refreshToken: { create: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
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
import { prisma } from '../../src/db/prisma';

const mockedPrisma = prisma as unknown as {
  user: { findMany: jest.Mock; update: jest.Mock };
  student: { findMany: jest.Mock };
  refreshToken: {
    create: jest.Mock;
    findUnique: jest.Mock;
    updateMany: jest.Mock;
  };
  auditLog: { create: jest.Mock };
  $transaction: jest.Mock;
};

const mockedBcrypt = bcrypt as unknown as {
  compare: jest.Mock;
};

describe('AuthService', () => {
  const authService = new AuthService();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.$transaction.mockResolvedValue([]);
    mockedPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });
    mockedPrisma.user.update.mockResolvedValue({ id: 'user-1' });
    mockedPrisma.auditLog.create.mockResolvedValue({ id: 1n });
    mockedPrisma.user.findMany.mockResolvedValue([]);
    mockedPrisma.student.findMany.mockResolvedValue([]);
  });

  it('logs in staff with identifier (email) and returns access/refresh tokens', async () => {
    mockedPrisma.user.findMany.mockResolvedValue([
      {
        id: 'user-1',
        tenantId: 'tenant-1',
        email: 'admin@school.rw',
        passwordHash: 'hash',
        firstName: 'Admin',
        lastName: 'User',
        userRoles: [
          {
            role: {
              name: 'SCHOOL_ADMIN',
              permissions: ['roles.read', 'users.read'],
            },
          },
        ],
      },
    ]);
    mockedBcrypt.compare.mockResolvedValue(true);

    const result = await authService.login(
      {
        identifier: 'admin@school.rw',
        password: 'Admin@12345',
      },
      {
        requestId: 'req-1',
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      },
    );

    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(result.roles).toContain('SCHOOL_ADMIN');

    const decoded = jwt.verify(
      result.accessToken,
      process.env.JWT_ACCESS_SECRET!,
    ) as jwt.JwtPayload;
    expect(decoded.sub).toBe('user-1');
    expect(decoded.tenantId).toBe('tenant-1');
  });

  it('logs in student with identifier (username)', async () => {
    mockedPrisma.user.findMany.mockResolvedValue([
      {
        id: 'student-user-1',
        tenantId: 'tenant-1',
        email: 'student@school.rw',
        username: 'alice_uwase',
        passwordHash: 'hash',
        firstName: 'Alice',
        lastName: 'Uwase',
        userRoles: [
          {
            role: {
              name: 'STUDENT',
              permissions: ['students.my_courses.read'],
            },
          },
        ],
      },
    ]);
    mockedBcrypt.compare.mockResolvedValue(true);

    const result = await authService.login(
      {
        identifier: 'alice_uwase',
        password: 'Student@123',
      },
      {
        requestId: 'req-1',
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      },
    );

    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(result.roles).toContain('STUDENT');

    const decoded = jwt.verify(
      result.accessToken,
      process.env.JWT_ACCESS_SECRET!,
    ) as jwt.JwtPayload;
    expect(decoded.sub).toBe('student-user-1');
    expect(decoded.tenantId).toBe('tenant-1');
  });

  it('rejects invalid refresh token', async () => {
    mockedPrisma.refreshToken.findUnique.mockResolvedValue(null);

    await expect(
      authService.refresh(
        { refreshToken: 'invalid-refresh-token-value' },
        {
          requestId: 'req-1',
          ipAddress: '127.0.0.1',
          userAgent: 'jest',
        },
      ),
    ).rejects.toMatchObject({
      code: 'AUTH_INVALID_REFRESH_TOKEN',
      statusCode: 401,
    });
  });
});
