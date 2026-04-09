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

export const ACADEMY_SUBJECT_LIMIT = 3;
export const ACADEMY_COURSE_LIMIT = ACADEMY_SUBJECT_LIMIT;

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
type AcademyEnrollmentRow = Prisma.ProgramEnrollmentGetPayload<{
  include: {
    program: {
      include: {
        course: {
          include: {
            subject: true;
          };
        };
      };
    };
  };
}>;

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

  private async ensureSelectableSubscription(userId: string, tenantId: string) {
    const subscription = await this.ensureTrialSubscription(userId, tenantId);
    const current = await this.syncSubscriptionStatus(subscription);

    if (
      current.status !== AcademySubscriptionStatus.ACTIVE &&
      current.status !== AcademySubscriptionStatus.TRIAL
    ) {
      throw new AppError(
        403,
        'ACADEMY_SUBSCRIPTION_REQUIRED',
        'Activate a plan or trial before selecting subjects.',
      );
    }

    if (current.expiresAt && current.expiresAt.getTime() <= Date.now()) {
      throw new AppError(
        403,
        'ACADEMY_SUBSCRIPTION_EXPIRED',
        'Your academy plan has expired. Renew to manage subject access.',
      );
    }

    return current;
  }

  private collectSubjectIds(rows: AcademyEnrollmentRow[]) {
    const subjectIds = new Set<string>();
    for (const row of rows) {
      const subjectId = row.program.course?.subject?.id ?? row.program.course?.subjectId ?? null;
      if (subjectId) {
        subjectIds.add(subjectId);
      }
    }
    return subjectIds;
  }

  private buildSubjectSelections(rows: AcademyEnrollmentRow[], currentSubscriptionId: string) {
    const map = new Map<
      string,
      {
        subjectId: string;
        subjectName: string;
        subjectCode: string;
        subjectDescription: string | null;
        thumbnail: string | null;
        courseCount: number;
        programCount: number;
        courseIds: string[];
        programIds: string[];
        programTitles: string[];
        expiresAt: string | null;
        isTrial: boolean;
        isLegacy: boolean;
      }
    >();

    for (const row of rows) {
      const subject = row.program.course?.subject;
      if (!subject) {
        continue;
      }

      const current = map.get(subject.id) ?? {
        subjectId: subject.id,
        subjectName: subject.name,
        subjectCode: subject.code,
        subjectDescription: subject.description,
        thumbnail: row.program.thumbnail,
        courseCount: 0,
        programCount: 0,
        courseIds: [],
        programIds: [],
        programTitles: [],
        expiresAt: row.expiresAt?.toISOString() ?? null,
        isTrial: row.isTrial,
        isLegacy: row.academySubscriptionId !== currentSubscriptionId,
      };

      if (!current.thumbnail && row.program.thumbnail) {
        current.thumbnail = row.program.thumbnail;
      }
      if (row.program.courseId && !current.courseIds.includes(row.program.courseId)) {
        current.courseIds.push(row.program.courseId);
        current.courseCount = current.courseIds.length;
      }
      if (!current.programIds.includes(row.programId)) {
        current.programIds.push(row.programId);
        current.programCount = current.programIds.length;
      }
      if (row.program.title && !current.programTitles.includes(row.program.title)) {
        current.programTitles.push(row.program.title);
      }
      if (
        row.expiresAt &&
        (!current.expiresAt || row.expiresAt.getTime() > new Date(current.expiresAt).getTime())
      ) {
        current.expiresAt = row.expiresAt.toISOString();
      }

      current.isTrial = current.isTrial || row.isTrial;
      current.isLegacy = current.isLegacy && row.academySubscriptionId !== currentSubscriptionId;

      map.set(subject.id, current);
    }

    return [...map.values()].sort((a, b) => a.subjectName.localeCompare(b.subjectName));
  }

  private async getCurrentSubjectSelections(userId: string, subscriptionId: string) {
    const rows = await prisma.programEnrollment.findMany({
      where: {
        userId,
        academySubscriptionId: subscriptionId,
        isActive: true,
      },
      include: {
        program: {
          include: {
            course: {
              include: {
                subject: true,
              },
            },
          },
        },
      },
      orderBy: [{ updatedAt: 'desc' }],
    });

    return {
      rows,
      subjectIds: this.collectSubjectIds(rows),
    };
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
      include: {
        course: {
          include: {
            subject: true,
          },
        },
      },
    });

    if (!program) {
      throw new AppError(404, 'PROGRAM_NOT_FOUND', 'Program not found');
    }

    return program;
  }

  private async getCatalogProgramsForSubject(subjectId: string) {
    const catalogTenantId = await resolveAcademyCatalogTenantId();
    if (!catalogTenantId) {
      throw new AppError(
        503,
        'ACADEMY_CATALOG_NOT_CONFIGURED',
        'Set one tenant as academy catalog or ACADEMY_CATALOG_TENANT_ID in env',
      );
    }

    const programs = await prisma.program.findMany({
      where: {
        tenantId: catalogTenantId,
        isActive: true,
        listedInPublicCatalog: true,
        course: {
          is: {
            isActive: true,
            subjectId,
          },
        },
      },
      include: {
        course: {
          include: {
            subject: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    if (!programs.length) {
      throw new AppError(404, 'SUBJECT_NOT_FOUND', 'Subject not found in academy catalog.');
    }

    return programs;
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
        courseLimit: ACADEMY_SUBJECT_LIMIT,
        expiresAt: createTrialExpiry(),
      },
    });
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
          program: {
            include: {
              course: {
                include: {
                  subject: true,
                },
              },
            },
          },
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
          program: {
            include: {
              course: {
                include: {
                  subject: true,
                },
              },
            },
          },
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

    const selectedSubjects = this.buildSubjectSelections(selectedRows, current.id);
    const accessibleSubjects = this.buildSubjectSelections(accessibleRows, current.id);
    const remainingSubjectSlots = Math.max(0, current.courseLimit - selectedSubjects.length);

    const selectedPrograms = selectedRows.map((row) => ({
      enrollmentId: row.id,
      programId: row.programId,
      title: row.program.title,
      description: row.program.description,
      thumbnail: row.program.thumbnail,
      courseId: row.program.courseId,
      subjectId: row.program.course?.subject?.id ?? row.program.course?.subjectId ?? null,
      subjectName: row.program.course?.subject?.name ?? null,
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
        subjectLimit: current.courseLimit,
        remainingSubjectSlots,
        courseLimit: current.courseLimit,
        remainingSlots: remainingSubjectSlots,
      },
      selectedSubjects,
      accessibleSubjects,
      selectedPrograms,
      accessiblePrograms: accessibleRows.map((row) => ({
        enrollmentId: row.id,
        programId: row.programId,
        title: row.program.title,
        description: row.program.description,
        thumbnail: row.program.thumbnail,
        courseId: row.program.courseId,
        subjectId: row.program.course?.subject?.id ?? row.program.course?.subjectId ?? null,
        subjectName: row.program.course?.subject?.name ?? null,
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
    const program = await this.getCatalogProgram(programId);
    if (!program.courseId) {
      throw new AppError(
        400,
        'PROGRAM_COURSE_NOT_READY',
        'This program is not linked to a course yet.',
      );
    }

    const subjectId = program.course?.subject?.id ?? program.course?.subjectId ?? null;
    if (!subjectId) {
      throw new AppError(
        400,
        'PROGRAM_SUBJECT_NOT_READY',
        'This program is not linked to a subject yet.',
      );
    }

    return this.selectSubject(userId, tenantId, subjectId);
  }

  async selectSubject(userId: string, tenantId: string, subjectId: string) {
    const current = await this.ensureSelectableSubscription(userId, tenantId);
    const programs = await this.getCatalogProgramsForSubject(subjectId);
    const { subjectIds } = await this.getCurrentSubjectSelections(userId, current.id);

    if (!subjectIds.has(subjectId) && subjectIds.size >= current.courseLimit) {
      throw new AppError(
        409,
        'ACADEMY_SELECTION_LIMIT_REACHED',
        `You can only keep ${current.courseLimit} academy subjects active at a time.`,
      );
    }

    await prisma.$transaction(
      programs.map((program) =>
        prisma.programEnrollment.upsert({
          where: {
            userId_programId: {
              userId,
              programId: program.id,
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
            programId: program.id,
            academySubscriptionId: current.id,
            expiresAt: current.expiresAt,
            isActive: true,
            isTrial: current.isTrial,
          },
        }),
      ),
    );

    return this.buildSummary(current, userId);
  }

  async removeProgram(userId: string, tenantId: string, programId: string) {
    const program = await this.getCatalogProgram(programId);
    const subjectId = program.course?.subject?.id ?? program.course?.subjectId ?? null;
    if (!subjectId) {
      throw new AppError(
        400,
        'PROGRAM_SUBJECT_NOT_READY',
        'This program is not linked to a subject yet.',
      );
    }

    return this.removeSubject(userId, tenantId, subjectId);
  }

  async removeSubject(userId: string, tenantId: string, subjectId: string) {
    const subscription = await this.ensureTrialSubscription(userId, tenantId);
    const current = await this.syncSubscriptionStatus(subscription);

    const selectedRows = await prisma.programEnrollment.findMany({
      where: {
        userId,
        academySubscriptionId: current.id,
        isActive: true,
        program: {
          course: {
            is: {
              subjectId,
            },
          },
        },
      },
      select: { id: true },
    });

    if (!selectedRows.length) {
      throw new AppError(404, 'SUBJECT_NOT_SELECTED', 'This subject is not selected on your plan.');
    }

    await prisma.programEnrollment.updateMany({
      where: {
        id: {
          in: selectedRows.map((row) => row.id),
        },
      },
      data: {
        academySubscriptionId: null,
        isActive: false,
      },
    });

    return this.buildSummary(current, userId);
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
                courseLimit: ACADEMY_SUBJECT_LIMIT,
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
                courseLimit: ACADEMY_SUBJECT_LIMIT,
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
