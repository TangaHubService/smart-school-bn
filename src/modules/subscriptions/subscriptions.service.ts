import { Prisma, SubscriptionStatus } from '@prisma/client';

import { AppError } from '../../common/errors/app-error';
import { JwtUser, RequestAuditContext } from '../../common/types/auth.types';
import { AUDIT_EVENT } from '../../constants/audit-events';
import { prisma } from '../../db/prisma';
import { AuditService } from '../audit/audit.service';
import { UpdateSchoolSubscriptionInput } from './subscriptions.schemas';

export class SubscriptionsService {
  private readonly auditService = new AuditService();

  /** Billing tables are created in migration 20260327174818_*; prod may lag behind. */
  private isSubscriptionTableMissing(e: unknown): boolean {
    return (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2021' &&
      (e.meta?.modelName === 'SubscriptionPlan' || e.meta?.modelName === 'SchoolSubscription')
    );
  }

  private subscriptionSchemaNotReadyError(): AppError {
    return new AppError(
      503,
      'SCHEMA_NOT_READY',
      'Subscription billing tables are missing. Run database migrations (e.g. 20260327174818_super_admin_billing_system_announcements).',
    );
  }

  async listPlans(_actor: JwtUser) {
    try {
      const plans = await prisma.subscriptionPlan.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });

      return {
        items: plans.map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          description: p.description,
          maxStudents: p.maxStudents,
          maxStaff: p.maxStaff,
        })),
      };
    } catch (e) {
      if (this.isSubscriptionTableMissing(e)) {
        return { items: [] };
      }
      throw e;
    }
  }

  async listSchoolSubscriptions(actor: JwtUser) {
    if (!(actor.roles ?? []).includes('SUPER_ADMIN')) {
      throw new AppError(403, 'FORBIDDEN', 'Only super admins can list subscriptions');
    }

    try {
      const rows = await prisma.schoolSubscription.findMany({
        include: {
          plan: true,
          tenant: {
            include: {
              school: {
                select: {
                  displayName: true,
                },
              },
            },
          },
        },
        orderBy: {
          updatedAt: 'desc',
        },
      });

      return {
        items: rows.map((s) => ({
          tenantId: s.tenantId,
          schoolName: s.tenant.school?.displayName ?? s.tenant.name,
          tenantCode: s.tenant.code,
          plan: {
            id: s.plan.id,
            code: s.plan.code,
            name: s.plan.name,
            maxStudents: s.plan.maxStudents,
            maxStaff: s.plan.maxStaff,
          },
          status: s.status,
          trialEndsAt: s.trialEndsAt?.toISOString() ?? null,
          currentPeriodStart: s.currentPeriodStart?.toISOString() ?? null,
          currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
          cancelAtPeriodEnd: s.cancelAtPeriodEnd,
          updatedAt: s.updatedAt.toISOString(),
        })),
      };
    } catch (e) {
      if (this.isSubscriptionTableMissing(e)) {
        return { items: [] };
      }
      throw e;
    }
  }

  async updateSchoolSubscription(
    tenantId: string,
    input: UpdateSchoolSubscriptionInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    if (!(actor.roles ?? []).includes('SUPER_ADMIN')) {
      throw new AppError(403, 'FORBIDDEN', 'Only super admins can update subscriptions');
    }

    try {
      const tenant = await prisma.tenant.findFirst({
        where: { id: tenantId, code: { not: 'platform' } },
        select: { id: true, code: true },
      });

      if (!tenant) {
        throw new AppError(404, 'TENANT_NOT_FOUND', 'School not found');
      }

      const plan = await prisma.subscriptionPlan.findFirst({
        where: { id: input.planId, isActive: true },
      });

      if (!plan) {
        throw new AppError(404, 'PLAN_NOT_FOUND', 'Subscription plan not found');
      }

      const updated = await prisma.schoolSubscription.upsert({
        where: { tenantId },
        create: {
          tenantId,
          planId: input.planId,
          status: input.status as SubscriptionStatus,
          trialEndsAt: input.trialEndsAt ? new Date(input.trialEndsAt) : null,
          currentPeriodStart: input.currentPeriodStart ? new Date(input.currentPeriodStart) : null,
          currentPeriodEnd: input.currentPeriodEnd ? new Date(input.currentPeriodEnd) : null,
          cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
        },
        update: {
          planId: input.planId,
          status: input.status as SubscriptionStatus,
          ...(input.trialEndsAt !== undefined && {
            trialEndsAt: input.trialEndsAt ? new Date(input.trialEndsAt) : null,
          }),
          ...(input.currentPeriodStart !== undefined && {
            currentPeriodStart: input.currentPeriodStart ? new Date(input.currentPeriodStart) : null,
          }),
          ...(input.currentPeriodEnd !== undefined && {
            currentPeriodEnd: input.currentPeriodEnd ? new Date(input.currentPeriodEnd) : null,
          }),
          ...(input.cancelAtPeriodEnd !== undefined && { cancelAtPeriodEnd: input.cancelAtPeriodEnd }),
        },
        include: {
          plan: true,
        },
      });

      await this.auditService.log({
        tenantId,
        actorUserId: actor.sub,
        event: AUDIT_EVENT.SUBSCRIPTION_UPDATED,
        entity: 'SchoolSubscription',
        entityId: updated.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        payload: {
          planCode: plan.code,
          status: input.status,
        },
      });

      return {
        tenantId: updated.tenantId,
        plan: {
          id: updated.plan.id,
          code: updated.plan.code,
          name: updated.plan.name,
        },
        status: updated.status,
        trialEndsAt: updated.trialEndsAt?.toISOString() ?? null,
        currentPeriodStart: updated.currentPeriodStart?.toISOString() ?? null,
        currentPeriodEnd: updated.currentPeriodEnd?.toISOString() ?? null,
        cancelAtPeriodEnd: updated.cancelAtPeriodEnd,
      };
    } catch (e) {
      if (this.isSubscriptionTableMissing(e)) {
        throw this.subscriptionSchemaNotReadyError();
      }
      throw e;
    }
  }
}
