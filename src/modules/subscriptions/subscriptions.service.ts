import { Prisma, SubscriptionStatus } from '@prisma/client';

import { AppError } from '../../common/errors/app-error';
import { JwtUser, RequestAuditContext } from '../../common/types/auth.types';
import { AUDIT_EVENT } from '../../constants/audit-events';
import { prisma } from '../../db/prisma';
import { AuditService } from '../audit/audit.service';
import { resolveAcademyCatalogTenantId } from '../public-academy/academy-catalog';
import { GrantAcademyAccessInput, UpdateSchoolSubscriptionInput } from './subscriptions.schemas';

export class SubscriptionsService {
  private readonly auditService = new AuditService();

  private assertSuperAdmin(actor: JwtUser) {
    if (!(actor.roles ?? []).includes('SUPER_ADMIN')) {
      throw new AppError(403, 'FORBIDDEN', 'Only super admins can perform this action');
    }
  }

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
    this.assertSuperAdmin(actor);

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
    this.assertSuperAdmin(actor);

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

  /**
   * All active programs in the academy catalog tenant (including not listed on the public storefront).
   * Used by super admins to grant enrollments; public GET /public-academy/programs only returns listed ones.
   */
  async listAcademyCatalogPrograms(actor: JwtUser) {
    this.assertSuperAdmin(actor);

    const catalogTenantId = await resolveAcademyCatalogTenantId();
    if (!catalogTenantId) {
      return {
        catalogConfigured: false as const,
        catalogTenantId: null as string | null,
        items: [] as Array<{
          id: string;
          title: string;
          price: number;
          durationDays: number;
          listedInPublicCatalog: boolean;
          courseId: string | null;
          courseTitle: string | null;
        }>,
      };
    }

    const programs = await prisma.program.findMany({
      where: {
        tenantId: catalogTenantId,
        isActive: true,
      },
      orderBy: [{ title: 'asc' }],
      include: {
        course: { select: { id: true, title: true } },
      },
    });

    return {
      catalogConfigured: true as const,
      catalogTenantId,
      items: programs.map((p) => ({
        id: p.id,
        title: p.title,
        price: p.price,
        durationDays: p.durationDays,
        listedInPublicCatalog: p.listedInPublicCatalog,
        courseId: p.courseId,
        courseTitle: p.course?.title ?? null,
      })),
    };
  }

  async listAcademyEnrollments(actor: JwtUser, page: number, pageSize: number) {
    this.assertSuperAdmin(actor);
    const safePage = Math.max(1, page);
    const safeSize = Math.min(100, Math.max(1, pageSize));
    const skip = (safePage - 1) * safeSize;

    const [total, rows] = await prisma.$transaction([
      prisma.programEnrollment.count(),
      prisma.programEnrollment.findMany({
        skip,
        take: safeSize,
        orderBy: { updatedAt: 'desc' },
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
          program: {
            select: { id: true, title: true, price: true, durationDays: true },
          },
          tenant: { select: { id: true, name: true, code: true } },
        },
      }),
    ]);

    const keys = new Set(rows.map((r) => `${r.userId}:${r.programId}`));
    const payments =
      keys.size === 0
        ? []
        : await prisma.payment.findMany({
            where: {
              OR: rows.map((r) => ({
                userId: r.userId,
                programId: r.programId,
              })),
            },
            orderBy: { createdAt: 'desc' },
          });

    const latestPaymentByPair = new Map<
      string,
      { status: string; amount: number; currency: string; createdAt: string }
    >();
    for (const p of payments) {
      const k = `${p.userId}:${p.programId}`;
      if (!latestPaymentByPair.has(k)) {
        latestPaymentByPair.set(k, {
          status: p.status,
          amount: p.amount,
          currency: p.currency,
          createdAt: p.createdAt.toISOString(),
        });
      }
    }

    return {
      pagination: { page: safePage, pageSize: safeSize, total },
      items: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        userEmail: r.user.email,
        userName: `${r.user.firstName} ${r.user.lastName}`.trim(),
        programId: r.programId,
        programTitle: r.program.title,
        tenantName: r.tenant.name,
        tenantCode: r.tenant.code,
        isActive: r.isActive,
        isTrial: r.isTrial,
        expiresAt: r.expiresAt?.toISOString() ?? null,
        updatedAt: r.updatedAt.toISOString(),
        lastPayment: latestPaymentByPair.get(`${r.userId}:${r.programId}`) ?? null,
      })),
    };
  }

  async grantAcademyAccess(
    input: GrantAcademyAccessInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    this.assertSuperAdmin(actor);

    const catalogTenantId = await resolveAcademyCatalogTenantId();
    if (!catalogTenantId) {
      throw new AppError(
        503,
        'ACADEMY_CATALOG_NOT_CONFIGURED',
        'Set ACADEMY_CATALOG_TENANT_ID or mark a tenant as academy catalog',
      );
    }

    const program = await prisma.program.findFirst({
      where: {
        id: input.programId,
        tenantId: catalogTenantId,
        isActive: true,
      },
    });

    if (!program) {
      throw new AppError(404, 'PROGRAM_NOT_FOUND', 'Program not found in the public academy catalog');
    }

    const user = input.userId
      ? await prisma.user.findFirst({
          where: { id: input.userId, deletedAt: null },
        })
      : await prisma.user.findFirst({
          where: { email: { equals: input.email!, mode: 'insensitive' }, deletedAt: null },
        });

    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found for that id or email');
    }

    const days = input.durationDays ?? program.durationDays ?? 30;
    const expiresAt = new Date();
    expiresAt.setUTCDate(expiresAt.getUTCDate() + days);

    const enrollment = await prisma.programEnrollment.upsert({
      where: {
        userId_programId: {
          userId: user.id,
          programId: program.id,
        },
      },
      update: {
        tenantId: catalogTenantId,
        isActive: true,
        isTrial: false,
        expiresAt,
      },
      create: {
        tenantId: catalogTenantId,
        userId: user.id,
        programId: program.id,
        isActive: true,
        isTrial: false,
        expiresAt,
      },
    });

    await this.auditService.log({
      tenantId: catalogTenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.ACADEMY_ACCESS_GRANTED,
      entity: 'ProgramEnrollment',
      entityId: enrollment.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        targetUserId: user.id,
        programId: program.id,
        programTitle: program.title,
        durationDays: days,
        expiresAt: expiresAt.toISOString(),
      },
    });

    return {
      enrollmentId: enrollment.id,
      userId: user.id,
      email: user.email,
      programId: program.id,
      programTitle: program.title,
      expiresAt: expiresAt.toISOString(),
      isTrial: false,
    };
  }
}
