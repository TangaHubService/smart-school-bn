jest.mock('../../src/modules/audit/audit.service', () => ({
  AuditService: jest.fn().mockImplementation(() => ({
    log: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { requirePermissions } from '../../src/common/middleware/require-permissions.middleware';

describe('RBAC attendance boundaries', () => {
  it('allows teacher to manage attendance with attendance.manage permission', () => {
    const next = jest.fn();
    const req = {
      user: {
        sub: 'teacher-user-1',
        tenantId: 'tenant-1',
        permissions: ['attendance.read', 'attendance.manage'],
        roles: ['TEACHER'],
      },
      requestId: 'req-1',
      ip: '127.0.0.1',
      header: jest.fn().mockReturnValue('jest-agent'),
      originalUrl: '/attendance/records/bulk',
      method: 'POST',
    } as any;

    requirePermissions(['attendance.manage'])(req, {} as any, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('denies parent for attendance management permission', () => {
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
      originalUrl: '/attendance/records/bulk',
      method: 'POST',
    } as any;

    requirePermissions(['attendance.manage'])(req, {} as any, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'AUTH_INSUFFICIENT_PERMISSIONS',
        statusCode: 403,
      }),
    );
  });
});
