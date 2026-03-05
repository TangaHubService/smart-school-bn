import jwt from 'jsonwebtoken';

jest.mock('../../src/db/prisma', () => {
  const prisma = {
    user: { findFirst: jest.fn() },
    tenant: { findUnique: jest.fn() },
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

import { authenticate } from '../../src/common/middleware/authenticate.middleware';
import { enforceTenant } from '../../src/common/middleware/tenant.middleware';
import { UsersController } from '../../src/modules/users/users.controller';
import { prisma } from '../../src/db/prisma';
import {
  applyError,
  createMockRequest,
  createMockResponse,
  runMiddleware,
} from './test-harness';

const mockedPrisma = prisma as any;
const usersController = new UsersController();

describe('tenant scoping integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('blocks mismatched x-tenant-id', async () => {
    const token = jwt.sign(
      {
        sub: 'user-1',
        tenantId: 'tenant-a',
        email: 'admin@school.rw',
        roles: ['SCHOOL_ADMIN'],
        permissions: ['users.read'],
      },
      process.env.JWT_ACCESS_SECRET!,
      { expiresIn: '15m' },
    );

    const req = createMockRequest({
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': 'tenant-b',
      },
    });
    const res = createMockResponse();

    await runMiddleware(authenticate, req, res);

    try {
      await runMiddleware(enforceTenant, req, res);
    } catch (error) {
      applyError(error, req, res);
    }

    expect(res.statusCode).toBe(403);
    expect((res.payload as any).error.code).toBe('TENANT_MISMATCH');
  });

  it('returns user profile for matching tenant context', async () => {
    mockedPrisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      email: 'admin@school.rw',
      firstName: 'Admin',
      lastName: 'User',
      tenant: {
        id: 'tenant-a',
        code: 'gs-rwanda',
        name: 'Green School Rwanda',
      },
      userRoles: [{ role: { name: 'SCHOOL_ADMIN', permissions: ['users.read'] } }],
    });

    const token = jwt.sign(
      {
        sub: 'user-1',
        tenantId: 'tenant-a',
        email: 'admin@school.rw',
        roles: ['SCHOOL_ADMIN'],
        permissions: ['users.read'],
      },
      process.env.JWT_ACCESS_SECRET!,
      { expiresIn: '15m' },
    );

    const req = createMockRequest({
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': 'tenant-a',
      },
    });
    const res = createMockResponse();

    await runMiddleware(authenticate, req, res);
    await runMiddleware(enforceTenant, req, res);
    await usersController.getMe(req as any, res as any);

    expect(res.statusCode).toBe(200);
    expect((res.payload as any).data.tenant.id).toBe('tenant-a');
    expect((res.payload as any).error).toBeNull();
  });
});
