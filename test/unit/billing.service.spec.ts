process.env.PAYPACK_CLIENT_ID = 'test-paypack-client';

const mockCashin = jest.fn();

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

jest.mock('../../src/common/services/paypack.service', () => ({
  PaypackService: {
    cashin: mockCashin,
  },
}));

jest.mock('../../src/modules/audit/audit.service', () => ({
  AuditService: jest.fn().mockImplementation(() => ({
    log: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { prisma } from '../../src/db/prisma';
import { BillingService } from '../../src/modules/billing/billing.service';

const mockedPrisma = prisma as unknown as {
  tenant: { findUnique: jest.Mock };
  subscriptionInvoice: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  subscriptionInvoicePayment: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  schoolSubscription: { upsert: jest.Mock };
  subscriptionPlan: { findFirst: jest.Mock };
  $transaction: jest.Mock;
};

const actor = { sub: 'admin-1', tenantId: 'tenant-1', email: 'a@b.c', roles: ['SCHOOL_ADMIN'], permissions: [] };
const context = { requestId: 'req-1', ipAddress: '127.0.0.1', userAgent: 'jest' };

function sampleInvoice(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-08-25T00:00:00.000Z');
  return {
    id: 'inv-1',
    tenantId: 'tenant-1',
    invoiceNumber: 'SSR-ANN-2026-ABCD1234',
    yearLabel: '2026',
    title: 'Smart School Rwanda Annual Access',
    description: 'Annual access',
    amountDue: 250000,
    currency: 'RWF',
    status: 'PENDING',
    periodStart: now,
    periodEnd: new Date(now.getTime() + 365 * 24 * 3600 * 1000),
    dueDate: new Date(now.getTime() + 30 * 24 * 3600 * 1000),
    issuedAt: now,
    paidAt: null,
    ...overrides,
  };
}

describe('BillingService (paypack mode)', () => {
  const service = new BillingService();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      code: 'ssr-10028',
      name: 'Kigali Excellence School',
      school: { displayName: 'Kigali Excellence School' },
    });
    mockedPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn(mockedPrisma)
    );
    mockedPrisma.subscriptionPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
  });

  it('reuses the currently open invoice instead of issuing another', async () => {
    const existing = sampleInvoice();
    mockedPrisma.subscriptionInvoice.findFirst.mockResolvedValue(existing);

    const result = await service.getOrCreateCurrentInvoice('tenant-1');

    expect(mockedPrisma.subscriptionInvoice.create).not.toHaveBeenCalled();
    expect(result.invoice.invoiceNumber).toBe('SSR-ANN-2026-ABCD1234');
    expect(result.schoolName).toBe('Kigali Excellence School');
  });

  it('issues a new annual invoice when no open invoice exists', async () => {
    mockedPrisma.subscriptionInvoice.findFirst.mockResolvedValue(null);
    mockedPrisma.subscriptionInvoice.create.mockImplementation(async ({ data }) =>
      sampleInvoice({
        id: 'inv-new',
        invoiceNumber: data.invoiceNumber,
        amountDue: data.amountDue,
      })
    );

    const result = await service.getOrCreateCurrentInvoice('tenant-1');

    expect(mockedPrisma.subscriptionInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          amountDue: 250000,
          currency: 'RWF',
          status: 'PENDING',
        }),
      })
    );
    expect(result.invoice.invoiceNumber).toMatch(/^SSR-ANN-\d{4}-[0-9A-F]{8}$/);
  });

  it('refuses to pay an already paid invoice', async () => {
    mockedPrisma.subscriptionInvoice.findFirst.mockResolvedValue(
      sampleInvoice({ status: 'PAID', paidAt: new Date() })
    );

    await expect(
      service.payInvoice('tenant-1', actor, { phoneNumber: '0788123456' }, context)
    ).rejects.toMatchObject({ statusCode: 409, code: 'INVOICE_ALREADY_PAID' });
  });

  it('initiates a paypack cashin and stores a pending payment', async () => {
    mockedPrisma.subscriptionInvoice.findFirst.mockResolvedValue(sampleInvoice());
    mockedPrisma.subscriptionInvoicePayment.findFirst.mockResolvedValue(null);
    mockCashin.mockResolvedValue({ ref: 'pp-ref-1', status: 'pending' });
    mockedPrisma.subscriptionInvoicePayment.create.mockResolvedValue({
      id: 'pay-1',
      providerRef: 'pp-ref-1',
    });

    const result = await service.payInvoice('tenant-1', actor, { phoneNumber: '0788123456' }, context);

    expect(mockCashin).toHaveBeenCalledWith(250000, '0788123456', expect.any(String));
    expect(mockedPrisma.subscriptionInvoicePayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
          provider: 'paypack',
          providerRef: 'pp-ref-1',
        }),
      })
    );
    expect(result.status).toBe('PENDING');
    expect(result.ref).toBe('pp-ref-1');
  });

  it('reuses a recent pending payment instead of double charging', async () => {
    mockedPrisma.subscriptionInvoice.findFirst.mockResolvedValue(sampleInvoice());
    mockedPrisma.subscriptionInvoicePayment.findFirst.mockResolvedValue({
      id: 'pay-pending',
      providerRef: 'pp-ref-pending',
      createdAt: new Date(),
    });

    const result = await service.payInvoice('tenant-1', actor, { phoneNumber: '0788123456' }, context);

    expect(mockCashin).not.toHaveBeenCalled();
    expect(result.status).toBe('PENDING');
    expect(result.ref).toBe('pp-ref-pending');
  });

  it('confirms a successful webhook by paying the invoice and activating the subscription', async () => {
    const invoice = sampleInvoice();
    mockedPrisma.subscriptionInvoicePayment.findUnique.mockResolvedValue({
      id: 'pay-1',
      tenantId: 'tenant-1',
      invoiceId: 'inv-1',
      status: 'PENDING',
      provider: 'paypack',
    });
    mockedPrisma.subscriptionInvoice.findUnique.mockResolvedValue(invoice);

    const result = await service.handlePaypackWebhook('pp-ref-1', 'successful', context);

    expect(mockedPrisma.subscriptionInvoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-1' },
        data: expect.objectContaining({ status: 'PAID' }),
      })
    );
    expect(mockedPrisma.schoolSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: 'ACTIVE' }),
      })
    );
    expect(result.handled).toBe(true);
    expect(result.paymentStatus).toBe('COMPLETED');
  });

  it('ignores webhooks for unknown references', async () => {
    mockedPrisma.subscriptionInvoicePayment.findUnique.mockResolvedValue(null);

    const result = await service.handlePaypackWebhook('unknown', 'successful', context);

    expect(result.handled).toBe(false);
  });

  it('cancels duplicate settlements when the invoice was already paid', async () => {
    mockedPrisma.subscriptionInvoicePayment.findUnique.mockResolvedValue({
      id: 'pay-dup',
      tenantId: 'tenant-1',
      invoiceId: 'inv-1',
      status: 'PENDING',
      provider: 'paypack',
    });
    mockedPrisma.subscriptionInvoice.findUnique.mockResolvedValue(
      sampleInvoice({ status: 'PAID', paidAt: new Date() })
    );

    const result = await service.handlePaypackWebhook('pp-ref-dup', 'successful', context);

    expect(mockedPrisma.subscriptionInvoicePayment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CANCELLED' } })
    );
    expect(result.paymentStatus).toBe('CANCELLED');
  });
});
