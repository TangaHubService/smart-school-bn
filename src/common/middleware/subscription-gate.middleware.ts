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

function isPlatformActor(user: JwtUser | undefined): boolean {
  const roles = user?.roles ?? [];
  return roles.includes('SUPER_ADMIN') || roles.includes('GOV_AUDITOR');
}

/**
 * Hard gate: blocks every school-scoped API for tenants whose annual
 * subscription is unpaid (no PAID invoice covering today and no ACTIVE
 * SchoolSubscription period). Platform actors and academy-catalog tenants
 * are always allowed.
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

    let allowed = getCachedDecision(tenantId);

    if (allowed === null) {
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

      if (
        !tenant ||
        !tenant.isActive ||
        tenant.isAcademyCatalog ||
        tenant.code === 'platform'
      ) {
        markCached(tenantId, true);
        next();
        return;
      }

      const now = new Date();
      const invoiceCoversToday = tenant.subscriptionInvoices.some(
        invoice => invoice.periodStart <= now && invoice.periodEnd >= now
      );

      const sub = tenant.schoolSubscription;
      const subscriptionActive =
        sub?.status === 'ACTIVE' &&
        (sub.currentPeriodStart ?? new Date(0)) <= now &&
        (sub.currentPeriodEnd ? sub.currentPeriodEnd >= now : true);

      allowed = invoiceCoversToday || subscriptionActive;
      markCached(tenantId, allowed);
    }

    if (!allowed) {
      const auditService = new AuditService();
      await auditService.log({
        tenantId,
        actorUserId: user.sub,
        event: AUDIT_EVENT.SUBSCRIPTION_GATE_BLOCKED,
        module: 'billing',
        description: `Blocked ${req.originalUrl ?? ''} for tenant with unpaid annual subscription`,
        requestId: req.requestId,
        ipAddress: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      });

      throw new AppError(
        402,
        'SUBSCRIPTION_REQUIRED',
        'The annual school subscription has not been paid. Pay the invoice to unlock the school dashboard.',
        { invoicePath: '/admin/subscription' }
      );
    }

    next();
  } catch (error) {
    next(error);
  }
}
