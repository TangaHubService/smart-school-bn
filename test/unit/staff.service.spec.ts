jest.mock('../../src/db/prisma', () => {
  const prisma = {
    role: { findFirst: jest.fn() },
    invite: {
      updateMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    user: { upsert: jest.fn() },
    userRole: { upsert: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  return { prisma };
});

import { InviteStatus } from '@prisma/client';

import { prisma } from '../../src/db/prisma';
import { StaffService } from '../../src/modules/staff/staff.service';

const mockedPrisma = prisma as any;

describe('StaffService', () => {
  const staffService = new StaffService();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.auditLog.create.mockResolvedValue({ id: 1n });
  });

  it('accepts invite and assigns role', async () => {
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

    mockedPrisma.$transaction.mockImplementation(async (callback: any) => {
      const tx = {
        user: {
          upsert: jest.fn().mockResolvedValue({
            id: 'user-1',
            email: 'teacher@school.rw',
          }),
        },
        userRole: {
          upsert: jest.fn().mockResolvedValue({ id: 'ur-1' }),
        },
        invite: {
          update: jest.fn().mockResolvedValue({ id: 'invite-1' }),
        },
      };

      return callback(tx);
    });

    const result = await staffService.acceptInvite(
      {
        token: 'x'.repeat(64),
        firstName: 'Jean',
        lastName: 'Teacher',
        password: 'StrongPass123!',
      },
      {
        requestId: 'req-1',
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      },
    );

    expect(result.accepted).toBe(true);
    expect(result.role).toBe('TEACHER');
    expect(mockedPrisma.auditLog.create).toHaveBeenCalled();
  });

  it('rejects expired invite', async () => {
    mockedPrisma.invite.findUnique.mockResolvedValue({
      id: 'invite-1',
      tenantId: 'tenant-1',
      email: 'teacher@school.rw',
      roleId: 'role-1',
      invitedByUserId: 'admin-1',
      status: InviteStatus.PENDING,
      expiresAt: new Date(Date.now() - 1000),
      tenant: { code: 'tenant-code' },
      role: { name: 'TEACHER' },
    });
    mockedPrisma.invite.update.mockResolvedValue({ id: 'invite-1' });

    await expect(
      staffService.acceptInvite(
        {
          token: 'x'.repeat(64),
          firstName: 'Jean',
          lastName: 'Teacher',
          password: 'StrongPass123!',
        },
        {
          requestId: 'req-1',
          ipAddress: '127.0.0.1',
          userAgent: 'jest',
        },
      ),
    ).rejects.toMatchObject({ code: 'INVITE_EXPIRED', statusCode: 400 });
  });
});
