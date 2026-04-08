const mockEnsureTrialSubscription = jest.fn();
const mockResolveAcademyCatalogTenantId = jest.fn();

jest.mock('../../src/db/prisma', () => {
  const prisma = {
    tenant: { findFirst: jest.fn() },
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    role: { upsert: jest.fn() },
    refreshToken: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  return { prisma };
});

jest.mock('../../src/modules/public-academy/academy-catalog', () => ({
  resolveAcademyCatalogTenantId: mockResolveAcademyCatalogTenantId,
}));

jest.mock('../../src/modules/public-academy/academy-subscription.service', () => ({
  AcademySubscriptionService: jest.fn().mockImplementation(() => ({
    ensureTrialSubscription: mockEnsureTrialSubscription,
  })),
}));

jest.mock('bcrypt', () => ({
  __esModule: true,
  default: {
    hash: jest.fn(),
    compare: jest.fn(),
  },
}));

import bcrypt from 'bcrypt';

import { prisma } from '../../src/db/prisma';
import { AuthService } from '../../src/modules/auth/auth.service';

const mockedPrisma = prisma as unknown as {
  tenant: { findFirst: jest.Mock };
  user: { findUnique: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
  role: { upsert: jest.Mock };
  refreshToken: { create: jest.Mock };
  auditLog: { create: jest.Mock };
  $transaction: jest.Mock;
};

const mockedBcrypt = bcrypt as unknown as {
  hash: jest.Mock;
};

describe('AuthService register', () => {
  const authService = new AuthService();

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveAcademyCatalogTenantId.mockResolvedValue('academy-tenant');
    mockedPrisma.tenant.findFirst.mockResolvedValue({ id: 'academy-tenant', isActive: true });
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    mockedPrisma.user.findFirst.mockResolvedValue(null);
    mockedPrisma.role.upsert.mockResolvedValue({ id: 'role-public-learner' });
    mockedPrisma.user.update.mockResolvedValue({ id: 'user-1' });
    mockedPrisma.refreshToken.create.mockResolvedValue({ id: 'refresh-1' });
    mockedPrisma.auditLog.create.mockResolvedValue({ id: 1n });
    mockedBcrypt.hash.mockResolvedValue('hashed-password');
    mockEnsureTrialSubscription.mockResolvedValue({ id: 'sub-1' });
  });

  it('creates a learner account and provisions a capped academy trial subscription', async () => {
    const txUserCreate = jest.fn().mockResolvedValue({
      id: 'user-1',
      tenantId: 'academy-tenant',
      email: 'learner@example.com',
      firstName: 'Lina',
      lastName: 'Mukamana',
    });
    const txStudentCreate = jest.fn().mockResolvedValue({ id: 'student-1' });
    const txUserRoleCreate = jest.fn().mockResolvedValue({ id: 'ur-1' });
    const txFindUniqueOrThrow = jest.fn().mockResolvedValue({
      id: 'user-1',
      tenantId: 'academy-tenant',
      email: 'learner@example.com',
      firstName: 'Lina',
      lastName: 'Mukamana',
      userRoles: [
        {
          role: {
            name: 'PUBLIC_LEARNER',
            permissions: ['students.my_courses.read', 'assignments.submit', 'assessments.submit'],
          },
        },
      ],
    });

    mockedPrisma.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return arg({
          user: {
            create: txUserCreate,
            findUniqueOrThrow: txFindUniqueOrThrow,
          },
          student: {
            create: txStudentCreate,
          },
          userRole: {
            create: txUserRoleCreate,
          },
        });
      }

      return Promise.resolve(arg);
    });

    const result = await authService.register(
      {
        firstName: 'Lina',
        lastName: 'Mukamana',
        email: 'learner@example.com',
        username: 'lina_m',
        password: 'Secure@123',
        confirmPassword: 'Secure@123',
      },
      {
        requestId: 'req-1',
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      },
    );

    expect(txUserCreate).toHaveBeenCalled();
    expect(txStudentCreate).toHaveBeenCalled();
    expect(txUserRoleCreate).toHaveBeenCalled();
    expect(mockEnsureTrialSubscription).toHaveBeenCalledWith(
      'user-1',
      'academy-tenant',
      expect.objectContaining({
        user: expect.any(Object),
        student: expect.any(Object),
        userRole: expect.any(Object),
      }),
    );
    expect(result.roles).toContain('PUBLIC_LEARNER');
  });
});
