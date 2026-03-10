jest.mock('../../src/db/prisma', () => {
  const prisma = {
    tenant: {
      findFirst: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  return { prisma };
});

import { prisma } from '../../src/db/prisma';
import { TenantsService } from '../../src/modules/tenants/tenants.service';

const mockedPrisma = prisma as any;

describe('TenantsService status management', () => {
  const tenantsService = new TenantsService();
  const actor = {
    sub: 'super-1',
    tenantId: 'platform-tenant',
    email: 'superadmin@smartschool.rw',
    roles: ['SUPER_ADMIN'],
    permissions: ['tenants.manage'],
  };
  const context = {
    requestId: 'req-1',
    ipAddress: '127.0.0.1',
    userAgent: 'jest',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.auditLog.create.mockResolvedValue({ id: 1n });
  });

  it('disables school and revokes refresh tokens and pending invites', async () => {
    mockedPrisma.tenant.findFirst.mockResolvedValue({
      id: 'tenant-1',
      code: 'gs-rwanda',
      name: 'Green School Rwanda',
      isActive: true,
    });

    const txTenantUpdate = jest.fn().mockResolvedValue({
      id: 'tenant-1',
      code: 'gs-rwanda',
      name: 'Green School Rwanda',
      isActive: false,
    });
    const txRefreshUpdateMany = jest.fn().mockResolvedValue({ count: 3 });
    const txInviteUpdateMany = jest.fn().mockResolvedValue({ count: 2 });

    mockedPrisma.$transaction.mockImplementation(async (callback: any) =>
      callback({
        tenant: { update: txTenantUpdate },
        refreshToken: { updateMany: txRefreshUpdateMany },
        invite: { updateMany: txInviteUpdateMany },
      }),
    );

    const result = await tenantsService.updateTenantStatus(
      'tenant-1',
      { isActive: false },
      actor,
      context,
    );

    expect(result).toEqual({
      id: 'tenant-1',
      code: 'gs-rwanda',
      name: 'Green School Rwanda',
      isActive: false,
    });
    expect(txRefreshUpdateMany).toHaveBeenCalled();
    expect(txInviteUpdateMany).toHaveBeenCalled();
    expect(mockedPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event: 'TENANT_DEACTIVATED',
          tenantId: 'tenant-1',
        }),
      }),
    );
  });

  it('enables school without revoking refresh tokens or invites', async () => {
    mockedPrisma.tenant.findFirst.mockResolvedValue({
      id: 'tenant-1',
      code: 'gs-rwanda',
      name: 'Green School Rwanda',
      isActive: false,
    });

    const txTenantUpdate = jest.fn().mockResolvedValue({
      id: 'tenant-1',
      code: 'gs-rwanda',
      name: 'Green School Rwanda',
      isActive: true,
    });
    const txRefreshUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    const txInviteUpdateMany = jest.fn().mockResolvedValue({ count: 0 });

    mockedPrisma.$transaction.mockImplementation(async (callback: any) =>
      callback({
        tenant: { update: txTenantUpdate },
        refreshToken: { updateMany: txRefreshUpdateMany },
        invite: { updateMany: txInviteUpdateMany },
      }),
    );

    const result = await tenantsService.updateTenantStatus(
      'tenant-1',
      { isActive: true },
      actor,
      context,
    );

    expect(result).toEqual({
      id: 'tenant-1',
      code: 'gs-rwanda',
      name: 'Green School Rwanda',
      isActive: true,
    });
    expect(txRefreshUpdateMany).not.toHaveBeenCalled();
    expect(txInviteUpdateMany).not.toHaveBeenCalled();
    expect(mockedPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event: 'TENANT_ACTIVATED',
          tenantId: 'tenant-1',
        }),
      }),
    );
  });

  it('returns current state when status is unchanged', async () => {
    mockedPrisma.tenant.findFirst.mockResolvedValue({
      id: 'tenant-1',
      code: 'gs-rwanda',
      name: 'Green School Rwanda',
      isActive: true,
    });

    const result = await tenantsService.updateTenantStatus(
      'tenant-1',
      { isActive: true },
      actor,
      context,
    );

    expect(result).toEqual({
      id: 'tenant-1',
      code: 'gs-rwanda',
      name: 'Green School Rwanda',
      isActive: true,
    });
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockedPrisma.auditLog.create).not.toHaveBeenCalled();
  });
});
