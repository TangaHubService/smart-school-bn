const mockResolveAcademyCatalogTenantId = jest.fn();
const mockCashin = jest.fn();

jest.mock('../../src/db/prisma', () => {
  const prisma = {
    user: { findFirst: jest.fn() },
    academySubscription: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    academySubscriptionPayment: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    program: { findFirst: jest.fn() },
    programEnrollment: {
      count: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  return { prisma };
});

jest.mock('../../src/modules/public-academy/academy-catalog', () => ({
  resolveAcademyCatalogTenantId: mockResolveAcademyCatalogTenantId,
}));

jest.mock('../../src/common/services/paypack.service', () => ({
  PaypackService: {
    cashin: mockCashin,
  },
}));

import { AcademyPlanCode, AcademySubscriptionStatus, PaymentStatus } from '@prisma/client';

import { prisma } from '../../src/db/prisma';
import { AcademySubscriptionService } from '../../src/modules/public-academy/academy-subscription.service';

const mockedPrisma = prisma as unknown as {
  user: { findFirst: jest.Mock };
  academySubscription: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  academySubscriptionPayment: {
    create: jest.Mock;
    update: jest.Mock;
    findFirst: jest.Mock;
    findUnique: jest.Mock;
  };
  program: { findFirst: jest.Mock };
  programEnrollment: {
    count: jest.Mock;
    findUnique: jest.Mock;
    upsert: jest.Mock;
    findMany: jest.Mock;
    updateMany: jest.Mock;
  };
  $transaction: jest.Mock;
};

describe('AcademySubscriptionService', () => {
  const service = new AcademySubscriptionService();

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveAcademyCatalogTenantId.mockResolvedValue('academy-tenant');
    mockedPrisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      tenantId: 'academy-tenant',
      userRoles: [{ role: { name: 'PUBLIC_LEARNER' } }],
      studentProfile: { id: 'student-1' },
    });
    mockedPrisma.programEnrollment.findMany.mockResolvedValue([]);
    mockedPrisma.academySubscriptionPayment.findFirst.mockResolvedValue(null);
  });

  it('creates a capped trial subscription when no academy subscription exists yet', async () => {
    mockedPrisma.academySubscription.findUnique.mockResolvedValue(null);
    mockedPrisma.academySubscription.create.mockResolvedValue({
      id: 'sub-1',
      tenantId: 'academy-tenant',
      userId: 'user-1',
      planCode: AcademyPlanCode.TRIAL,
      status: AcademySubscriptionStatus.TRIAL,
      isTrial: true,
      courseLimit: 3,
      expiresAt: new Date('2026-04-09T00:00:00.000Z'),
      createdAt: new Date('2026-04-08T00:00:00.000Z'),
      updatedAt: new Date('2026-04-08T00:00:00.000Z'),
    });

    const result = await service.ensureTrialSubscription('user-1', 'academy-tenant');

    expect(mockedPrisma.academySubscription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          planCode: AcademyPlanCode.TRIAL,
          status: AcademySubscriptionStatus.TRIAL,
          courseLimit: 3,
          isTrial: true,
        }),
      }),
    );
    expect(result.courseLimit).toBe(3);
  });

  it('blocks selecting a fourth academy course under the same subscription', async () => {
    mockedPrisma.academySubscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      tenantId: 'academy-tenant',
      userId: 'user-1',
      planCode: AcademyPlanCode.MONTHLY,
      status: AcademySubscriptionStatus.ACTIVE,
      isTrial: false,
      courseLimit: 3,
      expiresAt: new Date('2026-05-08T00:00:00.000Z'),
      createdAt: new Date('2026-04-08T00:00:00.000Z'),
      updatedAt: new Date('2026-04-08T00:00:00.000Z'),
    });
    mockedPrisma.program.findFirst.mockResolvedValue({
      id: 'program-4',
      tenantId: 'academy-tenant',
      title: 'Program 4',
      courseId: 'course-4',
      isActive: true,
      listedInPublicCatalog: true,
    });
    mockedPrisma.programEnrollment.count.mockResolvedValue(3);
    mockedPrisma.programEnrollment.findUnique.mockResolvedValue(null);

    await expect(service.selectProgram('user-1', 'academy-tenant', 'program-4')).rejects.toMatchObject({
      code: 'ACADEMY_SELECTION_LIMIT_REACHED',
      statusCode: 409,
    });
  });

  it('creates a fixed-price plan checkout payment based on the selected plan', async () => {
    mockedPrisma.academySubscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      tenantId: 'academy-tenant',
      userId: 'user-1',
      planCode: AcademyPlanCode.TRIAL,
      status: AcademySubscriptionStatus.TRIAL,
      isTrial: true,
      courseLimit: 3,
      expiresAt: new Date('2026-04-09T00:00:00.000Z'),
      createdAt: new Date('2026-04-08T00:00:00.000Z'),
      updatedAt: new Date('2026-04-08T00:00:00.000Z'),
    });
    mockedPrisma.academySubscriptionPayment.create.mockResolvedValue({ id: 'pay-1' });
    mockedPrisma.academySubscriptionPayment.update.mockResolvedValue({ id: 'pay-1', paypackRef: 'trx-1' });
    mockCashin.mockResolvedValue({
      ref: 'trx-1',
      status: 'pending',
      amount: 100,
      kind: 'cashin',
      createdAt: '2026-04-08T12:00:00.000Z',
    });

    const result = await service.startPlanCheckout('user-1', 'academy-tenant', {
      planId: 'test',
      phoneNumber: '0780000000',
    });

    expect(mockedPrisma.academySubscriptionPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          planCode: AcademyPlanCode.TEST,
          amount: 100,
          durationDays: 1,
          status: PaymentStatus.PENDING,
        }),
      }),
    );
    expect(result.paypackRef).toBe('trx-1');
  });
});
