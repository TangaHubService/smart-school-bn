jest.mock('../../src/db/prisma', () => {
  const prisma = {
    invite: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      upsert: jest.fn(),
    },
    userRole: {
      upsert: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  return { prisma };
});

import { InviteStatus } from '@prisma/client';

import { prisma } from '../../src/db/prisma';
import { validateBody } from '../../src/common/middleware/validate.middleware';
import { AuthController } from '../../src/modules/auth/auth.controller';
import { acceptInviteSchema } from '../../src/modules/staff/staff.schemas';
import {
  createMockRequest,
  createMockResponse,
  runMiddleware,
} from './test-harness';

const mockedPrisma = prisma as any;
const authController = new AuthController();

describe('auth accept invite integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.auditLog.create.mockResolvedValue({ id: 1n });
  });

  it('accepts a staff invite without bearer authentication', async () => {
    mockedPrisma.invite.findUnique.mockResolvedValue({
      id: 'invite-1',
      tenantId: 'tenant-1',
      email: 'teacher@school.rw',
      roleId: 'role-1',
      invitedByUserId: 'admin-1',
      status: InviteStatus.PENDING,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      tenant: { code: 'tenant-code' },
      role: { name: 'TEACHER' },
    });

    mockedPrisma.$transaction.mockImplementation(async (callback: any) =>
      callback({
        user: {
          upsert: jest.fn().mockResolvedValue({
            id: 'user-1',
            email: 'teacher@school.rw',
            phone: '07830218111',
          }),
        },
        userRole: {
          upsert: jest.fn().mockResolvedValue({ id: 'user-role-1' }),
        },
        invite: {
          update: jest.fn().mockResolvedValue({ id: 'invite-1' }),
        },
      }),
    );

    const req = createMockRequest({
      body: {
        token: 'x'.repeat(96),
        firstName: 'Bertin',
        lastName: 'Niyonkuru',
        phone: '07830218111',
        password: 'Test@123',
      },
      headers: {},
    });
    const res = createMockResponse();

    await runMiddleware(validateBody(acceptInviteSchema), req, res);
    await authController.acceptInvite(req as any, res as any);

    expect(res.statusCode).toBe(200);
    expect((res.payload as any).data.accepted).toBe(true);
    expect((res.payload as any).data.email).toBe('teacher@school.rw');
  });
});
