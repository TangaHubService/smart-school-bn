jest.mock('../../src/db/prisma', () => {
  const prisma = {
    tenant: { findUnique: jest.fn() },
    subscriptionInvoice: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    subscriptionInvoicePayment: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    schoolSubscription: { upsert: jest.fn() },
    subscriptionPlan: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };
  return { prisma };
});

jest.mock('../../src/modules/audit/audit.service', () => ({
  AuditService: jest.fn().mockImplementation(() => ({
    log: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { prisma } from '../../src/db/prisma';
import {
  requireActiveSubscription,
  resetSubscriptionGateCache,
} from '../../src/common/middleware/subscription-gate.middleware';

const mockedPrisma = prisma as unknown as {
  tenant: { findUnique: jest.Mock };
};

type NextFn = (err?: unknown) => void;

function run(req: Record<string, unknown>): Promise<{ next: jest.Mock }> {
  const next = jest.fn();
  return requireActiveSubscription(
    req as never,
    {} as never,
    next as NextFn
  ).then(() => ({ next }));
}

function baseUser(overrides: Record<string, unknown> = {}) {
  return {
    sub: 'user-1',
    tenantId: 'tenant-1',
    email: 'admin@school.rw',
    roles: ['SCHOOL_ADMIN'],
    permissions: [],
    ...overrides,
  };
}

function paidInvoiceWindow() {
  const now = new Date();
  return [
    {
      periodStart: new Date(now.getTime() - 24 * 3600 * 1000),
      periodEnd: new Date(now.getTime() + 300 * 24 * 3600 * 1000),
    },
  ];
}

describe('requireActiveSubscription gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSubscriptionGateCache();
  });

  it.each([['SUPER_ADMIN'], ['GOV_AUDITOR']])('allows platform actor role %s without a DB hit', async role => {
    const { next } = await run({ user: baseUser({ roles: [role] }), tenantId: 'tenant-1' });

    expect(next).toHaveBeenCalledWith();
    expect(mockedPrisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('allows tenants on the academy catalog (billed separately)', async () => {
    mockedPrisma.tenant.findUnique.mockResolvedValue({
      code: 'academy',
      isActive: true,
      isAcademyCatalog: true,
      schoolSubscription: null,
      subscriptionInvoices: [],
    });

    const { next } = await run({ user: baseUser(), tenantId: 'tenant-1' });

    expect(next).toHaveBeenCalledWith();
  });

  it('allows a school with a paid invoice covering today', async () => {
    mockedPrisma.tenant.findUnique.mockResolvedValue({
      code: 'ssr-10028',
      isActive: true,
      isAcademyCatalog: false,
      schoolSubscription: { status: 'TRIALING', currentPeriodStart: null, currentPeriodEnd: null },
      subscriptionInvoices: paidInvoiceWindow(),
    });

    const { next } = await run({ user: baseUser(), tenantId: 'tenant-1' });

    expect(next).toHaveBeenCalledWith();
  });

  it('allows a school whose SchoolSubscription period is ACTIVE and current', async () => {
    const now = new Date();
    mockedPrisma.tenant.findUnique.mockResolvedValue({
      code: 'ssr-10028',
      isActive: true,
      isAcademyCatalog: false,
      schoolSubscription: {
        status: 'ACTIVE',
        currentPeriodStart: new Date(now.getTime() - 10 * 24 * 3600 * 1000),
        currentPeriodEnd: new Date(now.getTime() + 355 * 24 * 3600 * 1000),
      },
      subscriptionInvoices: [],
    });

    const { next } = await run({ user: baseUser(), tenantId: 'tenant-1' });

    expect(next).toHaveBeenCalledWith();
  });

  it('blocks an unpaid school with HTTP 402 SUBSCRIPTION_REQUIRED', async () => {
    mockedPrisma.tenant.findUnique.mockResolvedValue({
      code: 'ssr-unpaid',
      isActive: true,
      isAcademyCatalog: false,
      schoolSubscription: { status: 'TRIALING', currentPeriodStart: null, currentPeriodEnd: null },
      subscriptionInvoices: [],
    });

    const { next } = await run({
      user: baseUser(),
      tenantId: 'tenant-1',
      originalUrl: '/students',
      ip: '127.0.0.1',
      header: () => 'jest',
      requestId: 'req-1',
    });

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0] as { statusCode: number; code: string };
    expect(error.statusCode).toBe(402);
    expect(error.code).toBe('SUBSCRIPTION_REQUIRED');
  });

  it('caches the unpaid decision to avoid repeated DB hits', async () => {
    mockedPrisma.tenant.findUnique.mockResolvedValue({
      code: 'ssr-unpaid',
      isActive: true,
      isAcademyCatalog: false,
      schoolSubscription: null,
      subscriptionInvoices: [],
    });
    const req = {
      user: baseUser(),
      tenantId: 'tenant-1',
      originalUrl: '/students',
      ip: '127.0.0.1',
      header: () => undefined,
      requestId: 'req-1',
    };

    await run(req);
    await run(req);

    expect(mockedPrisma.tenant.findUnique).toHaveBeenCalledTimes(1);
  });
});
