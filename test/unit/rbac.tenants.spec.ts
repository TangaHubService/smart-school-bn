import { requirePermissions } from '../../src/common/middleware/require-permissions.middleware';

describe('RBAC tenants permission', () => {
  it('allows user with tenants.create permission', () => {
    const next = jest.fn();
    const req = {
      user: {
        sub: 'u1',
        tenantId: 'platform',
        permissions: ['tenants.create', 'tenants.read'],
      },
      requestId: 'req-1',
      ip: '127.0.0.1',
      header: jest.fn().mockReturnValue('jest-agent'),
      originalUrl: '/tenants',
      method: 'POST',
    } as any;

    requirePermissions(['tenants.create'])(req, {} as any, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('denies user without tenants.create permission', () => {
    const next = jest.fn();
    const req = {
      user: {
        sub: 'u1',
        tenantId: 'platform',
        permissions: ['users.read'],
      },
      requestId: 'req-1',
      ip: '127.0.0.1',
      header: jest.fn().mockReturnValue('jest-agent'),
      originalUrl: '/tenants',
      method: 'POST',
    } as any;

    requirePermissions(['tenants.create'])(req, {} as any, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'AUTH_INSUFFICIENT_PERMISSIONS',
        statusCode: 403,
      }),
    );
  });
});
