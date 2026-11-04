import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../errors/app-error';
import { JwtUser } from '../types/auth.types';
import { prisma } from '../../db/prisma';
import { AUDIT_EVENT } from '../../constants/audit-events';
import { AuditService } from '../../modules/audit/audit.service';

const GATE_CACHE_TTL_MS = 30_000;

interface CacheEntry {
  allowed: boolean;
  expiresAt: number;
}

const decisionCache = new Map<string, CacheEntry>();

export function resetSubscriptionGateCache(tenantId?: string): void {
  if (tenantId) {
    decisionCache.delete(tenantId);
    return;
  }
  decisionCache.clear();
}

function getCachedDecision(tenantId: string): boolean | null {
  const entry = decisionCache.get(tenantId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    decisionCache.delete(tenantId);
    return null;
  }
  return entry.allowed;
}

function markCached(tenantId: string, allowed: boolean): void {
  decisionCache.set(tenantId, { allowed, expiresAt: Date.now() + GATE_CACHE_TTL_MS });
}

export function isPlatformActor(user: JwtUser | undefined): boolean {
  const roles = user?.roles ?? [];
  return roles.includes('SUPER_ADMIN') || roles.includes('GOV_AUDITOR');
}

/** Invoices a Super Admin issues to a school use this number prefix. */
export const MANUAL_INVOICE_PREFIX = 'MAN-';

/**
 * A school keeps access only while it has a paid period covering today and no
 * unpaid invoice issued by a Super Admin. An issued invoice blocks straight
 * away, even if the school has already paid for the current period.
 */
export async function isTenantAccessAllowed(tenantId: string): Promise<boolean> {
  const cached = getCachedDecision(tenantId);
  if (cached !== null) return cached;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      code: true,
      isActive: true,
      isAcademyCatalog: true,
      schoolSubscription: {
        select: { status: true, currentPeriodStart: true, currentPeriodEnd: true },
      },
      subscriptionInvoices: {
        where: { status: 'PAID' },
        select: { periodStart: true, periodEnd: true },
        orderBy: { periodEnd: 'desc' },
        take: 1,
      },
    },
  });

  if (!tenant || !tenant.isActive || tenant.isAcademyCatalog || tenant.code === 'platform') {
    markCached(tenantId, true);
    return true;
  }

  const unpaidIssuedInvoice = await prisma.subscriptionInvoice.findFirst({
    where: {
      tenantId,
      status: 'PENDING',
      invoiceNumber: { startsWith: MANUAL_INVOICE_PREFIX },
    },
    select: { id: true },
  });

  const now = new Date();
  const invoiceCoversToday = tenant.subscriptionInvoices.some(
    invoice => invoice.periodStart <= now && invoice.periodEnd >= now
  );

  const sub = tenant.schoolSubscription;
  const subscriptionActive =
    sub?.status === 'ACTIVE' &&
    (sub.currentPeriodStart ?? new Date(0)) <= now &&
    (sub.currentPeriodEnd ? sub.currentPeriodEnd >= now : true);

  const allowed = !unpaidIssuedInvoice && (invoiceCoversToday || subscriptionActive);
  markCached(tenantId, allowed);
  return allowed;
}

/**
 * Hard gate: blocks every school-scoped API for tenants that fail
 * isTenantAccessAllowed. Platform actors are always allowed.
 *
 * Must run AFTER authenticate + enforceTenant so req.user/req.tenantId exist.
 */
export async function requireActiveSubscription(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = req.user;
    if (!user || isPlatformActor(user)) {
      next();
      return;
    }

    const tenantId = req.tenantId ?? user.tenantId;
    if (!tenantId) {
      next();
      return;
    }

    const allowed = await isTenantAccessAllowed(tenantId);

    if (!allowed) {
      const auditService = new AuditService();
      await auditService.log({
        tenantId,
        actorUserId: user.sub,
        event: AUDIT_EVENT.SUBSCRIPTION_GATE_BLOCKED,
        module: 'billing',
        description: `Blocked ${req.originalUrl ?? ''} for tenant with an unpaid subscription invoice`,
        requestId: req.requestId,
        ipAddress: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      });

      throw new AppError(
        402,
        'SUBSCRIPTION_REQUIRED',
        'This school has an unpaid invoice. Pay the invoice to unlock the school dashboard.',
        { invoicePath: '/admin/subscription' }
      );
    }

    next();
  } catch (error) {
    next(error);
  }
}
