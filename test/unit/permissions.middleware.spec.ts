jest.mock('../../src/modules/audit/audit.service', () => ({
  AuditService: jest.fn().mockImplementation(() => ({
    log: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { requirePermissions } from '../../src/common/middleware/require-permissions.middleware';

describe('requirePermissions middleware', () => {
  it('allows SUPER_ADMIN even without required permissions', () => {
    const next = jest.fn();
    const req = {
      user: {
        roles: ['SUPER_ADMIN'],
        permissions: [],
      },
    } as any;

    requirePermissions(['roles.read'])(req, {} as any, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('allows user with required permissions', () => {
    const next = jest.fn();
    const req = {
      user: {
        permissions: ['users.read', 'roles.read'],
      },
    } as any;

    requirePermissions(['users.read'])(req, {} as any, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('blocks user without required permissions', () => {
    const next = jest.fn();
    const req = {
      user: {
        permissions: ['users.read'],
      },
    } as any;

    requirePermissions(['roles.read'])(req, {} as any, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'AUTH_INSUFFICIENT_PERMISSIONS',
        statusCode: 403,
      }),
    );
  });
});
