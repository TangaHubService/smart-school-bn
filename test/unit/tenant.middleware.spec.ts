import { enforceTenant } from '../../src/common/middleware/tenant.middleware';

function createMock() {
  const next = jest.fn();
  const req = {
    user: {
      sub: 'user-1',
      tenantId: 'tenant-a',
      email: 'admin@school.rw',
      roles: ['SCHOOL_ADMIN'],
      permissions: ['users.read'],
    },
    header: jest.fn(),
  } as any;

  return { req, next };
}

describe('enforceTenant middleware', () => {
  it('accepts matching tenant header', () => {
    const { req, next } = createMock();
    req.header.mockReturnValue('tenant-a');

    enforceTenant(req, {} as any, next);

    expect(req.tenantId).toBe('tenant-a');
    expect(next).toHaveBeenCalledWith();
  });

  it('blocks mismatched tenant header', () => {
    const { req, next } = createMock();
    req.header.mockReturnValue('tenant-b');

    enforceTenant(req, {} as any, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'TENANT_MISMATCH', statusCode: 403 }),
    );
  });
});
