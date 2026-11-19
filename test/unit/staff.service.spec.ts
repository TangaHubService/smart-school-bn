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
    user: {
      upsert: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    userRole: { upsert: jest.fn(), create: jest.fn() },
    refreshToken: { updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  return { prisma };
});

import { InviteStatus, UserStatus } from '@prisma/client';

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
      }
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
        }
      )
    ).rejects.toMatchObject({ code: 'INVITE_EXPIRED', statusCode: 400 });
  });

  it('deactivates member and revokes active refresh tokens', async () => {
    const member = {
      id: 'member-1',
      tenantId: 'tenant-1',
      email: 'teacher@school.rw',
      firstName: 'Jean',
      lastName: 'Teacher',
      phone: null,
      status: UserStatus.ACTIVE,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      userRoles: [{ role: { name: 'TEACHER' } }],
    };

    mockedPrisma.user.findFirst.mockResolvedValue(member);

    const txUserUpdate = jest.fn().mockResolvedValue({
      ...member,
      status: UserStatus.INACTIVE,
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    const txRefreshUpdateMany = jest.fn().mockResolvedValue({ count: 2 });

    mockedPrisma.$transaction.mockImplementation(async (callback: any) =>
      callback({
        user: { update: txUserUpdate },
        refreshToken: { updateMany: txRefreshUpdateMany },
      })
    );

    const result = await staffService.updateMember(
      'tenant-1',
      'member-1',
      { status: UserStatus.INACTIVE },
      {
        sub: 'admin-1',
        tenantId: 'tenant-1',
        email: 'admin@school.rw',
        roles: ['SCHOOL_ADMIN'],
        permissions: ['staff.invite'],
      },
      {
        requestId: 'req-1',
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      }
    );

    expect(result.status).toBe(UserStatus.INACTIVE);
    expect(txRefreshUpdateMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        userId: 'member-1',
        revokedAt: null,
      },
      data: {
        revokedAt: expect.any(Date),
      },
    });
  });

  it('activates member without revoking refresh tokens', async () => {
    const member = {
      id: 'member-1',
      tenantId: 'tenant-1',
      email: 'teacher@school.rw',
      firstName: 'Jean',
      lastName: 'Teacher',
      phone: null,
      status: UserStatus.INACTIVE,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      userRoles: [{ role: { name: 'TEACHER' } }],
    };

    mockedPrisma.user.findFirst.mockResolvedValue(member);

    const txUserUpdate = jest.fn().mockResolvedValue({
      ...member,
      status: UserStatus.ACTIVE,
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    const txRefreshUpdateMany = jest.fn().mockResolvedValue({ count: 0 });

    mockedPrisma.$transaction.mockImplementation(async (callback: any) =>
      callback({
        user: { update: txUserUpdate },
        refreshToken: { updateMany: txRefreshUpdateMany },
      })
    );

    const result = await staffService.updateMember(
      'tenant-1',
      'member-1',
      { status: UserStatus.ACTIVE },
      {
        sub: 'admin-1',
        tenantId: 'tenant-1',
        email: 'admin@school.rw',
        roles: ['SCHOOL_ADMIN'],
        permissions: ['staff.invite'],
      },
      {
        requestId: 'req-1',
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      }
    );

    expect(result.status).toBe(UserStatus.ACTIVE);
    expect(txRefreshUpdateMany).not.toHaveBeenCalled();
  });

  describe('school admins', () => {
    const actor = {
      sub: 'admin-1',
      tenantId: 'tenant-1',
      email: 'admin@school.rw',
      roles: ['SCHOOL_ADMIN'],
      permissions: ['staff.invite'],
    };
    const ctx = { requestId: 'req-1', ipAddress: '127.0.0.1', userAgent: 'jest' };

    function buildMember(roles: string[], status: UserStatus = UserStatus.ACTIVE) {
      return {
        id: 'member-2',
        tenantId: 'tenant-1',
        email: 'second@school.rw',
        firstName: 'Second',
        lastName: 'Admin',
        phone: null,
        status,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        userRoles: roles.map(name => ({ role: { name } })),
      };
    }

    it('lets a school admin make another staff member an admin', async () => {
      mockedPrisma.user.findFirst
        .mockResolvedValueOnce(buildMember(['TEACHER']))
        .mockResolvedValueOnce(buildMember(['SCHOOL_ADMIN', 'TEACHER']));
      mockedPrisma.role.findFirst.mockResolvedValue({ id: 'role-admin' });
      mockedPrisma.userRole.create.mockResolvedValue({ id: 'ur-2' });

      const result = await staffService.grantSchoolAdmin('tenant-1', 'member-2', actor, ctx);

      expect(mockedPrisma.userRole.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'tenant-1',
          userId: 'member-2',
          roleId: 'role-admin',
          assignedById: 'admin-1',
        },
      });
      expect(result.roles).toEqual(['SCHOOL_ADMIN', 'TEACHER']);
    });

    it('rejects making an existing admin an admin again', async () => {
      mockedPrisma.user.findFirst.mockResolvedValue(buildMember(['SCHOOL_ADMIN']));

      await expect(
        staffService.grantSchoolAdmin('tenant-1', 'member-2', actor, ctx)
      ).rejects.toMatchObject({ code: 'SCHOOL_ADMIN_ALREADY_ASSIGNED', statusCode: 409 });
    });

    it('rejects making a student an admin', async () => {
      mockedPrisma.user.findFirst.mockResolvedValue(buildMember(['STUDENT']));

      await expect(
        staffService.grantSchoolAdmin('tenant-1', 'member-2', actor, ctx)
      ).rejects.toMatchObject({ code: 'SCHOOL_ADMIN_GRANT_FORBIDDEN' });
    });

    it('removes admin role and revokes sessions when another admin remains', async () => {
      mockedPrisma.user.findFirst
        .mockResolvedValueOnce(buildMember(['SCHOOL_ADMIN', 'TEACHER']))
        .mockResolvedValueOnce(buildMember(['TEACHER']));
      mockedPrisma.user.count.mockResolvedValue(1);
      mockedPrisma.role.findFirst.mockResolvedValue({ id: 'role-admin' });
      const txDeleteMany = jest.fn().mockResolvedValue({ count: 1 });
      const txRefreshUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      mockedPrisma.$transaction.mockImplementation(async (callback: any) =>
        callback({
          userRole: { deleteMany: txDeleteMany },
          refreshToken: { updateMany: txRefreshUpdateMany },
        })
      );

      const result = await staffService.revokeSchoolAdmin('tenant-1', 'member-2', actor, ctx);

      expect(txDeleteMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', userId: 'member-2', roleId: 'role-admin' },
      });
      expect(txRefreshUpdateMany).toHaveBeenCalled();
      expect(result.roles).toEqual(['TEACHER']);
    });

    it('refuses to remove the last active admin', async () => {
      mockedPrisma.user.findFirst.mockResolvedValue(buildMember(['SCHOOL_ADMIN', 'TEACHER']));
      mockedPrisma.user.count.mockResolvedValue(0);

      await expect(
        staffService.revokeSchoolAdmin('tenant-1', 'member-2', actor, ctx)
      ).rejects.toMatchObject({ code: 'LAST_SCHOOL_ADMIN', statusCode: 400 });
    });

    it('refuses to deactivate the last active admin', async () => {
      mockedPrisma.user.findFirst.mockResolvedValue(buildMember(['SCHOOL_ADMIN']));
      mockedPrisma.user.count.mockResolvedValue(0);

      await expect(
        staffService.updateMember(
          'tenant-1',
          'member-2',
          { status: UserStatus.INACTIVE },
          actor,
          ctx
        )
      ).rejects.toMatchObject({ code: 'LAST_SCHOOL_ADMIN' });
    });

    it('refuses to delete the last active admin', async () => {
      mockedPrisma.user.findFirst.mockResolvedValue(buildMember(['SCHOOL_ADMIN']));
      mockedPrisma.user.count.mockResolvedValue(0);

      await expect(
        staffService.deleteMember('tenant-1', 'member-2', actor, ctx)
      ).rejects.toMatchObject({ code: 'LAST_SCHOOL_ADMIN' });
    });
  });
});
