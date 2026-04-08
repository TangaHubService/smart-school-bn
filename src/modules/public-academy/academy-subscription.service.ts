import {
  AcademyPlanCode,
  AcademySubscriptionStatus,
  PaymentStatus,
  Prisma,
  type AcademySubscription,
} from '@prisma/client';

import { AppError } from '../../common/errors/app-error';
import { PaypackService } from '../../common/services/paypack.service';
import { env } from '../../config/env';
import { prisma } from '../../db/prisma';
import { resolveAcademyCatalogTenantId } from './academy-catalog';

export const ACADEMY_COURSE_LIMIT = 3;

export const ACADEMY_CHECKOUT_PLANS = {
  test: {
    code: AcademyPlanCode.TEST,
    amount: 100,
    durationDays: 1,
  },
  weekly: {
    code: AcademyPlanCode.WEEKLY,
    amount: 2000,
    durationDays: 7,
  },
  monthly: {
    code: AcademyPlanCode.MONTHLY,
    amount: 5000,
    durationDays: 30,
  },
  quarterly: {
    code: AcademyPlanCode.QUARTERLY,
    amount: 10000,
    durationDays: 90,
  },
  yearly: {
    code: AcademyPlanCode.YEARLY,
    amount: 30000,
    durationDays: 365,
  },
} as const;

export type AcademyCheckoutPlanId = keyof typeof ACADEMY_CHECKOUT_PLANS;
type AcademySubscriptionDb = Prisma.TransactionClient | typeof prisma;

function addDays(base: Date, days: number) {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function createTrialExpiry() {
  const expiresAt = new Date();
  expiresAt.setTime(expiresAt.getTime() + env.ACADEMY_TRIAL_HOURS * 60 * 60 * 1000);
  return expiresAt;
}

function academyPlanCodeToApi(code: AcademyPlanCode): 'trial' | AcademyCheckoutPlanId {
  switch (code) {
    case AcademyPlanCode.TRIAL:
      return 'trial';
    case AcademyPlanCode.TEST:
      return 'test';
    case AcademyPlanCode.WEEKLY:
      return 'weekly';
    case AcademyPlanCode.MONTHLY:
      return 'monthly';
    case AcademyPlanCode.QUARTERLY:
      return 'quarterly';
    case AcademyPlanCode.YEARLY:
      return 'yearly';
  }
}

function academyStatusToApi(status: AcademySubscriptionStatus) {
  return status;
}

export class AcademySubscriptionService {
  private async assertAcademyLearner(
    userId: string,
    tenantId: string,
    db: AcademySubscriptionDb = prisma,
  ) {
    const catalogTenantId = await resolveAcademyCatalogTenantId();
    if (!catalogTenantId || catalogTenantId !== tenantId) {
      throw new AppError(
        403,
        'ACADEMY_ACCOUNT_REQUIRED',
        'Use a public academy learner account to manage academy plans.',
      );
    }

    const user = await db.user.findFirst({
      where: {
        id: userId,
        tenantId,
        deletedAt: null,
        status: 'ACTIVE',
      },
      include: {
        userRoles: {
          include: {
            role: true,
          },
        },
        studentProfile: {
          select: { id: true },
        },
      },
    });

    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const hasLearnerRole = user.userRoles.some((item) => item.role.name === 'PUBLIC_LEARNER');
    if (!hasLearnerRole || !user.studentProfile) {
      throw new AppError(
        403,
        'ACADEMY_ACCOUNT_REQUIRED',
        'Use a public academy learner account to manage academy plans.',
      );
    }

    return user;
  }

  private async syncSubscriptionStatus(subscription: AcademySubscription) {
    if (
      subscription.status !== AcademySubscriptionStatus.CANCELLED &&
      subscription.status !== AcademySubscriptionStatus.EXPIRED &&
      subscription.expiresAt &&
      subscription.expiresAt.getTime() <= Date.now()
    ) {
      return prisma.academySubscription.update({
        where: { id: subscription.id },
        data: { status: AcademySubscriptionStatus.EXPIRED },
      });
    }

    return subscription;
  }

  async ensureTrialSubscription(
    userId: string,
    tenantId: string,
    db: AcademySubscriptionDb = prisma,
  ) {
    await this.assertAcademyLearner(userId, tenantId, db);

    const existing = await db.academySubscription.findUnique({
      where: {
        tenantId_userId: {
          tenantId,
          userId,
        },
      },
    });

    if (existing) {
      return this.syncSubscriptionStatus(existing);
    }

    return db.academySubscription.create({
      data: {
        tenantId,
        userId,
        planCode: AcademyPlanCode.TRIAL,
        status: AcademySubscriptionStatus.TRIAL,
        isTrial: true,
        courseLimit: ACADEMY_COURSE_LIMIT,
        expiresAt: createTrialExpiry(),
      },
    });
  }

  private async getCatalogProgram(programId: string) {
    const catalogTenantId = await resolveAcademyCatalogTenantId();
    if (!catalogTenantId) {
      throw new AppError(
        503,
        'ACADEMY_CATALOG_NOT_CONFIGURED',
        'Set one tenant as academy catalog or ACADEMY_CATALOG_TENANT_ID in env',
      );
    }

    const program = await prisma.program.findFirst({
      where: {
        id: programId,
        tenantId: catalogTenantId,
        isActive: true,
        listedInPublicCatalog: true,
      },
    });

    if (!program) {
      throw new AppError(404, 'PROGRAM_NOT_FOUND', 'Program not found');
    }

    return program;
  }

  private async buildSummary(subscription: AcademySubscription, userId: string) {
    const current = await this.syncSubscriptionStatus(subscription);

    const [selectedRows, accessibleRows, pendingPayment] = await Promise.all([
      prisma.programEnrollment.findMany({
        where: {
          userId,
          academySubscriptionId: current.id,
          isActive: true,
        },
        include: {
          program: true,
        },
        orderBy: [{ updatedAt: 'desc' }],
      }),
      prisma.programEnrollment.findMany({
        where: {
          userId,
          isActive: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        include: {
          program: true,
        },
        orderBy: [{ updatedAt: 'desc' }],
      }),
      prisma.academySubscriptionPayment.findFirst({
        where: {
          tenantId: current.tenantId,
          userId,
          status: PaymentStatus.PENDING,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const selectedPrograms = selectedRows.map((row) => ({
      enrollmentId: row.id,
      programId: row.programId,
      title: row.program.title,
      description: row.program.description,
      thumbnail: row.program.thumbnail,
      courseId: row.program.courseId,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      isTrial: row.isTrial,
    }));

    return {
      subscription: {
        id: current.id,
        planCode: academyPlanCodeToApi(current.planCode),
        status: academyStatusToApi(current.status),
        isTrial: current.isTrial,
        expiresAt: current.expiresAt?.toISOString() ?? null,
        courseLimit: current.courseLimit,
        remainingSlots: Math.max(0, current.courseLimit - selectedPrograms.length),
      },
      selectedPrograms,
      accessiblePrograms: accessibleRows.map((row) => ({
        enrollmentId: row.id,
        programId: row.programId,
        title: row.program.title,
        description: row.program.description,
        thumbnail: row.program.thumbnail,
        courseId: row.program.courseId,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        isTrial: row.isTrial,
        isLegacy: row.academySubscriptionId !== current.id,
      })),
      pendingPayment: pendingPayment
        ? {
            id: pendingPayment.id,
            planCode: academyPlanCodeToApi(pendingPayment.planCode),
            status: pendingPayment.status,
            amount: pendingPayment.amount,
            currency: pendingPayment.currency,
            createdAt: pendingPayment.createdAt.toISOString(),
          }
        : null,
    };
  }

  async getSummary(userId: string, tenantId: string) {
    const subscription = await this.ensureTrialSubscription(userId, tenantId);
    return this.buildSummary(subscription, userId);
  }

  async startPlanCheckout(
    userId: string,
    tenantId: string,
    input: { planId: AcademyCheckoutPlanId; phoneNumber: string },
  ) {
    const subscription = await this.ensureTrialSubscription(userId, tenantId);
    const plan = ACADEMY_CHECKOUT_PLANS[input.planId];

    const payment = await prisma.academySubscriptionPayment.create({
      data: {
        tenantId,
        userId,
        academySubscriptionId: subscription.id,
        planCode: plan.code,
        amount: plan.amount,
        durationDays: plan.durationDays,
        currency: 'RWF',
        status: PaymentStatus.PENDING,
        channel: 'PAYPACK_MOMO',
      },
    });

    try {
      const paypackResponse = await PaypackService.cashin(plan.amount, input.phoneNumber);
      await prisma.academySubscriptionPayment.update({
        where: { id: payment.id },
        data: {
          paypackRef: paypackResponse.ref,
        },
      });

      return {
        message: 'Payment initiated. Please confirm on your phone.',
        paymentId: payment.id,
        paypackRef: paypackResponse.ref,
        planId: input.planId,
      };
    } catch (error) {
      await prisma.academySubscriptionPayment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
        },
      });
      throw error;
    }
  }

  async selectProgram(userId: string, tenantId: string, programId: string) {
    const subscription = await this.ensureTrialSubscription(userId, tenantId);
    const current = await this.syncSubscriptionStatus(subscription);

    if (
      current.status !== AcademySubscriptionStatus.ACTIVE &&
      current.status !== AcademySubscriptionStatus.TRIAL
    ) {
      throw new AppError(
        403,
        'ACADEMY_SUBSCRIPTION_REQUIRED',
        'Activate a plan or trial before selecting courses.',
      );
    }

    if (current.expiresAt && current.expiresAt.getTime() <= Date.now()) {
      throw new AppError(
        403,
        'ACADEMY_SUBSCRIPTION_EXPIRED',
        'Your academy plan has expired. Renew to manage course access.',
      );
    }

    const program = await this.getCatalogProgram(programId);
    if (!program.courseId) {
      throw new AppError(
        400,
        'PROGRAM_COURSE_NOT_READY',
        'This program is not linked to a course yet.',
      );
    }

    const [selectedCount, existing] = await Promise.all([
      prisma.programEnrollment.count({
        where: {
          userId,
          academySubscriptionId: current.id,
          isActive: true,
        },
      }),
      prisma.programEnrollment.findUnique({
        where: {
          userId_programId: {
            userId,
            programId,
          },
        },
      }),
    ]);

    const alreadySelected =
      existing && existing.academySubscriptionId === current.id && existing.isActive;
    if (!alreadySelected && selectedCount >= current.courseLimit) {
      throw new AppError(
        409,
        'ACADEMY_SELECTION_LIMIT_REACHED',
        `You can only keep ${current.courseLimit} academy courses active at a time.`,
      );
    }

    await prisma.programEnrollment.upsert({
      where: {
        userId_programId: {
          userId,
          programId,
        },
      },
      update: {
        tenantId,
        academySubscriptionId: current.id,
        expiresAt: current.expiresAt,
        isActive: true,
        isTrial: current.isTrial,
      },
      create: {
        tenantId,
        userId,
        programId,
        academySubscriptionId: current.id,
        expiresAt: current.expiresAt,
        isActive: true,
        isTrial: current.isTrial,
      },
    });

    return this.buildSummary(current, userId);
  }

  async removeProgram(userId: string, tenantId: string, programId: string) {
    const subscription = await this.ensureTrialSubscription(userId, tenantId);

    const existing = await prisma.programEnrollment.findUnique({
      where: {
        userId_programId: {
          userId,
          programId,
        },
      },
    });

    if (!existing || existing.academySubscriptionId !== subscription.id || !existing.isActive) {
      throw new AppError(404, 'PROGRAM_NOT_SELECTED', 'This program is not selected on your plan.');
    }

    await prisma.programEnrollment.update({
      where: { id: existing.id },
      data: {
        academySubscriptionId: null,
        isActive: false,
      },
    });

    return this.buildSummary(subscription, userId);
  }

  async handlePaymentWebhook(ref: string, rawStatus: string) {
    const payment = await prisma.academySubscriptionPayment.findUnique({
      where: { paypackRef: ref },
      include: {
        academySubscription: true,
      },
    });

    if (!payment) {
      return { handled: false as const };
    }

    if (payment.status !== PaymentStatus.PENDING) {
      return { handled: true as const, status: payment.status };
    }

    if (rawStatus === 'successful') {
      const now = new Date();
      const result = await prisma.$transaction(async (tx) => {
        await tx.academySubscriptionPayment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.COMPLETED },
        });

        const existing = await tx.academySubscription.findUnique({
          where: {
            tenantId_userId: {
              tenantId: payment.tenantId,
              userId: payment.userId,
            },
          },
        });

        const baseDate =
          existing?.expiresAt && existing.expiresAt.getTime() > now.getTime()
            ? existing.expiresAt
            : now;
        const expiresAt = addDays(baseDate, payment.durationDays);

        const subscription = existing
          ? await tx.academySubscription.update({
              where: { id: existing.id },
              data: {
                planCode: payment.planCode,
                status: AcademySubscriptionStatus.ACTIVE,
                isTrial: false,
                courseLimit: ACADEMY_COURSE_LIMIT,
                expiresAt,
              },
            })
          : await tx.academySubscription.create({
              data: {
                tenantId: payment.tenantId,
                userId: payment.userId,
                planCode: payment.planCode,
                status: AcademySubscriptionStatus.ACTIVE,
                isTrial: false,
                courseLimit: ACADEMY_COURSE_LIMIT,
                expiresAt,
              },
            });

        await tx.academySubscriptionPayment.update({
          where: { id: payment.id },
          data: { academySubscriptionId: subscription.id },
        });

        await tx.programEnrollment.updateMany({
          where: {
            userId: payment.userId,
            academySubscriptionId: subscription.id,
            isActive: true,
          },
          data: {
            tenantId: payment.tenantId,
            expiresAt,
            isTrial: false,
          },
        });

        return {
          paymentId: payment.id,
          subscriptionId: subscription.id,
        };
      });

      return {
        handled: true as const,
        status: PaymentStatus.COMPLETED,
        ...result,
      };
    }

    if (rawStatus === 'failed' || rawStatus === 'cancelled') {
      const nextStatus =
        rawStatus === 'failed' ? PaymentStatus.FAILED : PaymentStatus.CANCELLED;
      await prisma.academySubscriptionPayment.update({
        where: { id: payment.id },
        data: { status: nextStatus },
      });

      return {
        handled: true as const,
        status: nextStatus,
        paymentId: payment.id,
      };
    }

    return { handled: true as const, status: payment.status };
  }
}
