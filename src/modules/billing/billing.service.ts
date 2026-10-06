import { Prisma } from '@prisma/client';
import crypto from 'crypto';

import { AppError } from '../../common/errors/app-error';
import { JwtUser, RequestAuditContext } from '../../common/types/auth.types';
import { buildPagination } from '../../common/utils/pagination';
import { AUDIT_EVENT } from '../../constants/audit-events';
import { env } from '../../config/env';
import { prisma } from '../../db/prisma';
import { PaypackService } from '../../common/services/paypack.service';
import { resetSubscriptionGateCache } from '../../common/middleware/subscription-gate.middleware';
import { AuditService } from '../audit/audit.service';
import {
  CreateManualInvoiceInput,
  ListInvoicesQueryInput,
  PaySubscriptionInvoiceInput,
  RecordManualPaymentInput,
} from './billing.schemas';

const PAYMENT_REUSE_WINDOW_MS = 15 * 60 * 1000;
const SUBSCRIPTION_DAYS = 365;

type InvoiceStatus = 'PENDING' | 'PAID' | 'VOID';

export interface MappedInvoice {
  id: string;
  invoiceNumber: string;
  yearLabel: string;
  title: string;
  description: string;
  amountDue: number;
  currency: string;
  status: InvoiceStatus;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  issuedAt: string;
  paidAt: string | null;
}

function mapInvoice(invoice: {
  id: string;
  invoiceNumber: string;
  yearLabel: string;
  title: string;
  description: string;
  amountDue: number;
  currency: string;
  status: InvoiceStatus;
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  issuedAt: Date;
  paidAt: Date | null;
  paymentMethod?: string | null;
  paymentDate?: Date | null;
  reference?: string | null;
  notes?: string | null;
}): MappedInvoice & {
  paymentMethod: string | null;
  paymentDate: string | null;
  reference: string | null;
  notes: string | null;
} {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    yearLabel: invoice.yearLabel,
    title: invoice.title,
    description: invoice.description,
    amountDue: invoice.amountDue,
    currency: invoice.currency,
    status: invoice.status,
    periodStart: invoice.periodStart.toISOString(),
    periodEnd: invoice.periodEnd.toISOString(),
    dueDate: invoice.dueDate.toISOString(),
    issuedAt: invoice.issuedAt.toISOString(),
    paidAt: invoice.paidAt?.toISOString() ?? null,
    paymentMethod: invoice.paymentMethod ?? null,
    paymentDate: invoice.paymentDate?.toISOString() ?? null,
    reference: invoice.reference ?? null,
    notes: invoice.notes ?? null,
  };
}

export class BillingService {
  private readonly auditService = new AuditService();

  private isBillingTableMissing(e: unknown): boolean {
    return (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2021' &&
      (e.meta?.modelName === 'SubscriptionInvoice' ||
        e.meta?.modelName === 'SubscriptionInvoicePayment')
    );
  }

  /** Mock payments only for demos/tests; production must use a real provider. */
  private isMockBillingEnabled(): boolean {
    return (
      env.BILLING_ALLOW_MOCK || (!env.PAYPACK_CLIENT_ID && env.NODE_ENV !== 'production')
    );
  }

  private async loadBillableTenant(tenantId: string) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        code: true,
        name: true,
        school: { select: { displayName: true } },
      },
    });

    if (!tenant) throw new AppError(404, 'TENANT_NOT_FOUND', 'School not found');
    if (tenant.code === 'platform') {
      throw new AppError(
        400,
        'BILLING_NOT_APPLICABLE',
        'The platform tenant is not billed for school subscriptions'
      );
    }
    return tenant;
  }

  private buildInvoiceWindow(now: Date) {
    const periodStart = new Date(now);
    const periodEnd = new Date(now);
    periodEnd.setUTCDate(periodEnd.getUTCDate() + SUBSCRIPTION_DAYS);
    const dueDate = new Date(now);
    dueDate.setUTCDate(dueDate.getUTCDate() + 30);
    return { periodStart, periodEnd, dueDate };
  }

  /**
   * Returns the tenant's current annual invoice, lazily issuing the next one
   * when no open (pending or paid, not expired) invoice exists.
   */
  async getOrCreateCurrentInvoice(tenantId: string): Promise<{
    invoice: MappedInvoice;
    schoolName: string;
    tenantCode: string;
  }> {
    const tenant = await this.loadBillableTenant(tenantId);
    const now = new Date();

    const existing = await prisma.subscriptionInvoice.findFirst({
      where: { tenantId, status: { not: 'VOID' }, periodEnd: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      return {
        invoice: mapInvoice(existing),
        schoolName: tenant.school?.displayName ?? tenant.name,
        tenantCode: tenant.code,
      };
    }

    const { periodStart, periodEnd, dueDate } = this.buildInvoiceWindow(now);
    const yearLabel = String(now.getUTCFullYear());
    const invoiceNumber = `SSR-ANN-${yearLabel}-${crypto
      .randomBytes(4)
      .toString('hex')
      .toUpperCase()}`;

    const created = await prisma.subscriptionInvoice.create({
      data: {
        tenantId,
        invoiceNumber,
        yearLabel,
        title: 'Smart School Rwanda Annual Access',
        description:
          'Includes student records, attendance, academic results, communication, school reports, staff management, and administration tools.',
        amountDue: env.BILLING_ANNUAL_AMOUNT_RWF,
        currency: 'RWF',
        status: 'PENDING',
        periodStart,
        periodEnd,
        dueDate,
      },
    });

    await this.auditService.log({
      tenantId,
      event: AUDIT_EVENT.SUBSCRIPTION_INVOICE_ISSUED,
      entity: 'SubscriptionInvoice',
      entityId: created.id,
      payload: { invoiceNumber, amountDue: created.amountDue },
    });

    return {
      invoice: mapInvoice(created),
      schoolName: tenant.school?.displayName ?? tenant.name,
      tenantCode: tenant.code,
    };
  }

  async getMyInvoice(tenantId: string) {
    try {
      const { invoice, schoolName, tenantCode } =
        await this.getOrCreateCurrentInvoice(tenantId);

      const payments = await prisma.subscriptionInvoicePayment.findMany({
        where: { invoiceId: invoice.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          amount: true,
          currency: true,
          status: true,
          provider: true,
          providerRef: true,
          createdAt: true,
          completedAt: true,
        },
      });

      return {
        invoice,
        schoolName,
        tenantCode,
        payments: payments.map(p => ({
          ...p,
          createdAt: p.createdAt.toISOString(),
          completedAt: p.completedAt?.toISOString() ?? null,
        })),
      };
    } catch (e) {
      if (this.isBillingTableMissing(e)) {
        throw new AppError(
          503,
          'SCHEMA_NOT_READY',
          'Billing tables are missing. Run database migrations (20260825000000_add_school_subscription_invoices).'
        );
      }
      throw e;
    }
  }

  async payInvoice(
    tenantId: string,
    actor: JwtUser,
    input: PaySubscriptionInvoiceInput,
    context: RequestAuditContext
  ) {
    const { invoice } = await this.getOrCreateCurrentInvoice(tenantId);

    if (invoice.status === 'PAID') {
      throw new AppError(409, 'INVOICE_ALREADY_PAID', 'This invoice has already been paid');
    }
    if (invoice.status === 'VOID') {
      throw new AppError(409, 'INVOICE_VOID', 'This invoice is void and cannot be paid');
    }

    if (this.isMockBillingEnabled()) {
      const completed = await prisma.$transaction(async tx => {
        const payment = await tx.subscriptionInvoicePayment.create({
          data: {
            tenantId,
            invoiceId: invoice.id,
            amount: invoice.amountDue,
            currency: invoice.currency,
            status: 'COMPLETED',
            provider: 'mock',
            providerRef: `MOCK-${crypto.randomBytes(8).toString('hex').toUpperCase()}`,
            phoneNumber: input.phoneNumber,
            completedAt: new Date(),
          },
        });
        const updated = await tx.subscriptionInvoice.update({
          where: { id: invoice.id, status: 'PENDING' },
          data: { status: 'PAID', paidAt: new Date() },
        });
        await this.syncSchoolSubscription(tx, tenantId, updated.periodStart, updated.periodEnd);
        return { payment, invoice: updated };
      });

      resetSubscriptionGateCache(tenantId);

      await this.auditService.log({
        tenantId,
        actorUserId: actor.sub,
        event: AUDIT_EVENT.SUBSCRIPTION_PAYMENT_CONFIRMED,
        entity: 'SubscriptionInvoicePayment',
        entityId: completed.payment.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        payload: {
          invoiceNumber: invoice.invoiceNumber,
          provider: 'mock',
          amount: invoice.amountDue,
        },
      });

      return {
        status: 'PAID' as const,
        provider: 'mock',
        ref: completed.payment.providerRef,
        message: 'Payment confirmed (mock mode). Subscription active.',
      };
    }

    const recentPending = await prisma.subscriptionInvoicePayment.findFirst({
      where: {
        invoiceId: invoice.id,
        status: 'PENDING',
        provider: 'paypack',
        createdAt: { gt: new Date(Date.now() - PAYMENT_REUSE_WINDOW_MS) },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recentPending) {
      return {
        status: 'PENDING' as const,
        provider: 'paypack',
        ref: recentPending.providerRef,
        message: 'A payment was already initiated. Confirm on your phone.',
      };
    }

    let cashin;
    try {
      cashin = await PaypackService.cashin(
        invoice.amountDue,
        input.phoneNumber,
        crypto.randomBytes(16).toString('hex')
      );
    } catch (error) {
      throw new AppError(
        502,
        'PAYMENT_PROVIDER_ERROR',
        error instanceof Error ? error.message : 'Mobile Money provider request failed'
      );
    }

    const payment = await prisma.subscriptionInvoicePayment.create({
      data: {
        tenantId,
        invoiceId: invoice.id,
        amount: invoice.amountDue,
        currency: invoice.currency,
        status: 'PENDING',
        provider: 'paypack',
        providerRef: cashin.ref,
        phoneNumber: input.phoneNumber,
      },
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.SUBSCRIPTION_PAYMENT_INITIATED,
      entity: 'SubscriptionInvoicePayment',
      entityId: payment.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: { invoiceNumber: invoice.invoiceNumber, ref: cashin.ref },
    });

    return {
      status: 'PENDING' as const,
      provider: 'paypack',
      ref: cashin.ref,
      message: cashin.message ?? 'Payment initiated. Confirm on your phone.',
    };
  }

  private async syncSchoolSubscription(
    tx: Pick<Prisma.TransactionClient, 'schoolSubscription' | 'subscriptionPlan'>,
    tenantId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<void> {
    const plan = await tx.subscriptionPlan.findFirst({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });
    if (!plan) return;

    await tx.schoolSubscription.upsert({
      where: { tenantId },
      create: {
        tenantId,
        planId: plan.id,
        status: 'ACTIVE',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
      update: {
        status: 'ACTIVE',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
    });
  }

  /** Paypack webhook handler. Returns whether the reference belonged to billing. */
  async handlePaypackWebhook(
    ref: string,
    status: string,
    context: RequestAuditContext
  ): Promise<{ handled: boolean; paymentStatus?: string }> {
    const payment = await prisma.subscriptionInvoicePayment.findUnique({
      where: { providerRef: ref },
    });

    if (!payment) return { handled: false };

    if (payment.status !== 'PENDING') {
      return { handled: false };
    }

    if (status !== 'successful') {
      if (status === 'failed' || status === 'cancelled') {
        await prisma.subscriptionInvoicePayment.update({
          where: { id: payment.id },
          data: { status: status === 'failed' ? 'FAILED' : 'CANCELLED' },
        });
        return { handled: true, paymentStatus: status.toUpperCase() };
      }
      return { handled: false };
    }

    const invoice = await prisma.subscriptionInvoice.findUnique({
      where: { id: payment.invoiceId },
    });
    if (!invoice) return { handled: false };

    if (invoice.status === 'PAID') {
      // Duplicate settlement (e.g. retried webhook after mock/manual confirmation).
      await prisma.subscriptionInvoicePayment.update({
        where: { id: payment.id },
        data: { status: 'CANCELLED' },
      });
      return { handled: true, paymentStatus: 'CANCELLED' };
    }

    await prisma.$transaction(async tx => {
      await tx.subscriptionInvoicePayment.update({
        where: { id: payment.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      await tx.subscriptionInvoice.update({
        where: { id: invoice.id },
        data: { status: 'PAID', paidAt: new Date() },
      });
      await this.syncSchoolSubscription(
        tx,
        payment.tenantId,
        invoice.periodStart,
        invoice.periodEnd
      );
    });

    resetSubscriptionGateCache(payment.tenantId);

    await this.auditService.log({
      tenantId: payment.tenantId,
      event: AUDIT_EVENT.SUBSCRIPTION_PAYMENT_CONFIRMED,
      entity: 'SubscriptionInvoicePayment',
      entityId: payment.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: { invoiceNumber: invoice.invoiceNumber, provider: 'paypack', ref },
    });

    return { handled: true, paymentStatus: 'COMPLETED' };
  }

  /**
   * Paginated invoice list for billing staff (Rev #16 follow-up).
   * Super-admin view across schools with tenant/status filters.
   */
  async listInvoices(query: ListInvoicesQueryInput) {
    const where: Prisma.SubscriptionInvoiceWhereInput = {};
    if (query.tenantId) where.tenantId = query.tenantId;
    if (query.status) where.status = query.status;
    const [total, items] = await prisma.$transaction([
      prisma.subscriptionInvoice.count({ where }),
      prisma.subscriptionInvoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          tenant: { select: { id: true, code: true, name: true } },
          payments: {
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: {
              id: true,
              amount: true,
              currency: true,
              status: true,
              provider: true,
              completedAt: true,
              createdAt: true,
            },
          },
        },
      }),
    ]);
    return {
      items: items.map(invoice => ({
        ...mapInvoice(invoice),
        tenant: invoice.tenant,
        payments: invoice.payments,
      })),
      pagination: buildPagination(query.page, query.pageSize, total),
    };
  }

  /**
   * Manual school billing (Rev #16–19). For schools not on online payment:
   * creates an invoice with amount/currency/method/payment+expiry dates,
   * reference and notes. Status derives from dates where applicable.
   */
  async createManualInvoice(
    input: CreateManualInvoiceInput,
    actor: JwtUser,
    context: RequestAuditContext
  ) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: { id: true, code: true },
    });
    if (!tenant || tenant.code === 'platform') {
      throw new AppError(404, 'TENANT_NOT_FOUND', 'School not found');
    }
    const periodStart = new Date(input.periodStart);
    const periodEnd = new Date(input.periodEnd);
    if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
      throw new AppError(400, 'INVALID_DATE', 'Invalid billing period dates');
    }
    if (periodEnd <= periodStart) {
      throw new AppError(400, 'INVALID_DATE_RANGE', 'Expiring date must be after period start');
    }
    const dueDate = input.dueDate ? new Date(input.dueDate) : periodEnd;
    const paymentDate = input.paymentDate ? new Date(input.paymentDate) : null;
    if (input.paymentDate && paymentDate && Number.isNaN(paymentDate.getTime())) {
      throw new AppError(400, 'INVALID_DATE', 'Invalid payment date');
    }
    const yearLabel = String(periodStart.getFullYear());
    const invoiceNumber = `MAN-${yearLabel}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    const invoice = await prisma.subscriptionInvoice.create({
      data: {
        tenantId: input.tenantId,
        invoiceNumber,
        yearLabel,
        title: input.title,
        description: input.description,
        amountDue: input.amountDue,
        currency: input.currency,
        status: input.status,
        periodStart,
        periodEnd,
        dueDate,
        paidAt: input.status === 'PAID' ? (paymentDate ?? new Date()) : null,
        paymentMethod: input.paymentMethod ?? null,
        paymentDate,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
      } as never,
    });

    if (input.status === 'PAID') {
      await prisma.$transaction(async tx => {
        await this.syncSchoolSubscription(tx, input.tenantId, periodStart, periodEnd);
      });
      resetSubscriptionGateCache(input.tenantId);
    }

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.SUBSCRIPTION_PAYMENT_CONFIRMED,
      entity: 'SubscriptionInvoice',
      entityId: invoice.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: { invoiceNumber, manual: true, amount: input.amountDue, currency: input.currency },
    });

    return invoice;
  }

  /** Record an offline payment (cash/bank/MoMo/card) against an invoice. */
  async recordManualPayment(
    invoiceId: string,
    input: RecordManualPaymentInput,
    actor: JwtUser,
    context: RequestAuditContext
  ) {
    const invoice = await prisma.subscriptionInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new AppError(404, 'INVOICE_NOT_FOUND', 'Invoice not found');
    const paymentDate = input.paymentDate ? new Date(input.paymentDate) : new Date();
    if (Number.isNaN(paymentDate.getTime())) {
      throw new AppError(400, 'INVALID_DATE', 'Invalid payment date');
    }
    const result = await prisma.$transaction(async tx => {
      const payment = await tx.subscriptionInvoicePayment.create({
        data: {
          tenantId: invoice.tenantId,
          invoiceId: invoice.id,
          amount: input.amount,
          currency: input.currency,
          status: 'COMPLETED',
          provider: 'manual',
          paymentMethod: input.paymentMethod,
          reference: input.reference ?? null,
          providerRef: `MANUAL-${crypto.randomBytes(8).toString('hex').toUpperCase()}`,
          completedAt: paymentDate,
        } as never,
      });
      const updated = await tx.subscriptionInvoice.update({
        where: { id: invoice.id },
        data: {
          status: 'PAID',
          paidAt: paymentDate,
          paymentMethod: input.paymentMethod,
          paymentDate,
          reference: input.reference ?? (invoice as never as { reference?: string }).reference ?? null,
        } as never,
      });
      await this.syncSchoolSubscription(tx, invoice.tenantId, invoice.periodStart, invoice.periodEnd);
      return { payment, invoice: updated };
    });
    resetSubscriptionGateCache(invoice.tenantId);
    await this.auditService.log({
      tenantId: invoice.tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.SUBSCRIPTION_PAYMENT_CONFIRMED,
      entity: 'SubscriptionInvoicePayment',
      entityId: result.payment.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: { invoiceNumber: invoice.invoiceNumber, manual: true, method: input.paymentMethod },
    });
    return result;
  }
}
