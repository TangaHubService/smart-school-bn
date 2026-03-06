jest.mock('../../src/modules/audit/audit.service', () => ({
  AuditService: jest.fn().mockImplementation(() => ({
    log: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { requirePermissions } from '../../src/common/middleware/require-permissions.middleware';

describe('RBAC parent boundaries', () => {
  it('allows parent to read own children endpoint permission', () => {
    const next = jest.fn();
    const req = {
      user: {
        sub: 'parent-user-1',
        tenantId: 'tenant-1',
        permissions: ['parents.my_children.read'],
        roles: ['PARENT'],
      },
      requestId: 'req-1',
      ip: '127.0.0.1',
      header: jest.fn().mockReturnValue('jest-agent'),
      originalUrl: '/parents/me/students',
      method: 'GET',
    } as any;

    requirePermissions(['parents.my_children.read'])(req, {} as any, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('denies parent for admin-only parent management permission', () => {
    const next = jest.fn();
    const req = {
      user: {
        sub: 'parent-user-1',
        tenantId: 'tenant-1',
        permissions: ['parents.my_children.read'],
        roles: ['PARENT'],
      },
      requestId: 'req-2',
      ip: '127.0.0.1',
      header: jest.fn().mockReturnValue('jest-agent'),
      originalUrl: '/parents',
      method: 'POST',
    } as any;

    requirePermissions(['parents.manage'])(req, {} as any, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'AUTH_INSUFFICIENT_PERMISSIONS',
        statusCode: 403,
      }),
    );
  });
});
