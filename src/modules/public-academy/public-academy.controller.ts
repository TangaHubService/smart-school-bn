import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { sendSuccess, sendError } from '../../common/utils/response';
import { PaypackService } from '../../common/services/paypack.service';
import { getIO } from '../../common/utils/socket-server';
import { env } from '../../config/env';
import { rootLogger } from '../../config/logger';
import { resolveAcademyCatalogTenantId } from './academy-catalog';
import {
  AcademySubscriptionService,
  type AcademyCheckoutPlanId,
} from './academy-subscription.service';
import type {
  AcademyPlanCheckoutInput,
  AcademyProgramSelectionInput,
  AcademySubjectSelectionInput,
} from './public-academy.schemas';

const PLAN_DURATION_MAP: Record<string, number> = {
  test: 1,
  weekly: 7,
  monthly: 30,
  quarterly: 90,
  yearly: 365,
};

const academySubscriptionService = new AcademySubscriptionService();
const academyWebhookLog = rootLogger.child({ module: 'public-academy-webhook' });

type CatalogProgramRow = Prisma.ProgramGetPayload<{
  include: {
    course: {
      include: {
        subject: true;
      };
    };
  };
}>;

type CatalogProgramResult =
  | { ok: true; program: CatalogProgramRow; catalogTenantId: string }
  | { ok: false; reason: 'no_catalog' | 'not_found' };

function buildCatalogSubjectStats(programs: CatalogProgramRow[]) {
  const subjectIds = [...new Set(programs.map((program) => program.course?.subjectId).filter(Boolean))];
  return prisma.course.findMany({
    where: {
      tenantId: programs[0]?.tenantId ?? '',
      isActive: true,
      subjectId: { in: subjectIds as string[] },
    },
    select: {
      id: true,
      title: true,
      subjectId: true,
    },
    orderBy: [{ title: 'asc' }],
  });
}

function mapCatalogProgram(
  program: CatalogProgramRow,
  subjectStats: Map<string, { count: number; titles: string[] }>,
) {
  const subject = program.course?.subject ?? null;
  const stats = subject ? subjectStats.get(subject.id) : null;

  return {
    id: program.id,
    title: program.title,
    description: program.description,
    thumbnail: program.thumbnail,
    price: program.price,
    durationDays: program.durationDays,
    courseId: program.courseId,
    subjectId: subject?.id ?? null,
    subjectName: subject?.name ?? null,
    subjectCode: subject?.code ?? null,
    subjectDescription: subject?.description ?? null,
    subjectCourseCount: stats?.count ?? (program.courseId ? 1 : 0),
    subjectCourseTitles: stats?.titles ?? [],
  };
}

async function assertCatalogProgram(programId: string): Promise<CatalogProgramResult> {
  const catalogTenantId = await resolveAcademyCatalogTenantId();
  if (!catalogTenantId) {
    return { ok: false, reason: 'no_catalog' };
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
    return { ok: false, reason: 'not_found' };
  }
  return { ok: true, program, catalogTenantId };
}

export class PublicAcademyController {
  static webhookProbe(req: Request, res: Response) {
    if (req.method === 'HEAD') {
      return res.status(200).end();
    }

    return res.status(200).json({
      ok: true,
      message: 'Paypack webhook endpoint is reachable.',
      method: 'POST',
    });
  }

  static async getPrograms(req: Request, res: Response, next: NextFunction) {
    try {
      const catalogTenantId = await resolveAcademyCatalogTenantId();
      if (!catalogTenantId) {
        return sendSuccess(req, res, [], 200, null, {
          academyCatalog: { resolved: false, publicProgramCount: 0 },
        });
      }
      const programs = await prisma.program.findMany({
        where: {
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
        orderBy: { createdAt: 'desc' },
      });
      const subjectStats = new Map<string, { count: number; titles: string[] }>();
      if (programs.length) {
        const subjectCourses = await buildCatalogSubjectStats(programs);
        for (const course of subjectCourses) {
          if (!course.subjectId) {
            continue;
          }
          const current = subjectStats.get(course.subjectId) ?? { count: 0, titles: [] };
          current.count += 1;
          if (current.titles.length < 6) {
            current.titles.push(course.title);
          }
          subjectStats.set(course.subjectId, current);
        }
      }
      return sendSuccess(req, res, programs.map((program) => mapCatalogProgram(program, subjectStats)), 200, null, {
        academyCatalog: {
          resolved: true,
          publicProgramCount: programs.length,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async getProgramById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await assertCatalogProgram(id);
      if (!result.ok) {
        if (result.reason === 'no_catalog') {
          return sendError(
            req,
            res,
            503,
            'ACADEMY_CATALOG_NOT_CONFIGURED',
            'Set one tenant as academy catalog or ACADEMY_CATALOG_TENANT_ID in env',
          );
        }
        return sendError(req, res, 404, 'PROGRAM_NOT_FOUND', 'Program not found');
      }
      const subjectStats = new Map<string, { count: number; titles: string[] }>();
      const subjectId = result.program.course?.subject?.id ?? null;
      if (subjectId) {
        const subjectCourses = await buildCatalogSubjectStats([result.program]);
        subjectStats.set(subjectId, {
          count: subjectCourses.length,
          titles: subjectCourses.slice(0, 6).map((course) => course.title),
        });
      }
      return sendSuccess(req, res, mapCatalogProgram(result.program, subjectStats));
    } catch (error) {
      next(error);
    }
  }

  static async getSubscriptionSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.sub;
      const tenantId = req.user?.tenantId;

      if (!userId || !tenantId) {
        return sendError(req, res, 401, 'UNAUTHORIZED', 'Authentication required');
      }

      const summary = await academySubscriptionService.getSummary(userId, tenantId);
      return sendSuccess(req, res, summary);
    } catch (error) {
      next(error);
    }
  }

  static async startPlanCheckout(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.sub;
      const tenantId = req.user?.tenantId;

      if (!userId || !tenantId) {
        return sendError(req, res, 401, 'UNAUTHORIZED', 'Authentication required');
      }

      const { planId, phoneNumber } = req.body as AcademyPlanCheckoutInput;
      const result = await academySubscriptionService.startPlanCheckout(userId, tenantId, {
        planId: planId as AcademyCheckoutPlanId,
        phoneNumber,
      });
      return sendSuccess(req, res, result, 202);
    } catch (error) {
      next(error);
    }
  }

  static async selectProgram(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.sub;
      const tenantId = req.user?.tenantId;

      if (!userId || !tenantId) {
        return sendError(req, res, 401, 'UNAUTHORIZED', 'Authentication required');
      }

      const { programId } = req.body as AcademyProgramSelectionInput;
      const result = await academySubscriptionService.selectProgram(userId, tenantId, programId);
      return sendSuccess(req, res, result);
    } catch (error) {
      next(error);
    }
  }

  static async selectSubject(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.sub;
      const tenantId = req.user?.tenantId;

      if (!userId || !tenantId) {
        return sendError(req, res, 401, 'UNAUTHORIZED', 'Authentication required');
      }

      const { subjectId } = req.body as AcademySubjectSelectionInput;
      const result = await academySubscriptionService.selectSubject(userId, tenantId, subjectId);
      return sendSuccess(req, res, result);
    } catch (error) {
      next(error);
    }
  }

  static async removeProgram(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.sub;
      const tenantId = req.user?.tenantId;

      if (!userId || !tenantId) {
        return sendError(req, res, 401, 'UNAUTHORIZED', 'Authentication required');
      }

      const result = await academySubscriptionService.removeProgram(
        userId,
        tenantId,
        req.params.programId,
      );
      return sendSuccess(req, res, result);
    } catch (error) {
      next(error);
    }
  }

  static async removeSubject(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.sub;
      const tenantId = req.user?.tenantId;

      if (!userId || !tenantId) {
        return sendError(req, res, 401, 'UNAUTHORIZED', 'Authentication required');
      }

      const result = await academySubscriptionService.removeSubject(
        userId,
        tenantId,
        req.params.subjectId,
      );
      return sendSuccess(req, res, result);
    } catch (error) {
      next(error);
    }
  }

  static async purchaseProgram(req: Request, res: Response, next: NextFunction) {
    try {
      const { programId, phoneNumber, planId } = req.body;
      const userId = req.user?.sub;
      const buyerTenantId = req.user?.tenantId;

      if (!userId || !buyerTenantId) {
        return sendError(req, res, 401, 'UNAUTHORIZED', 'Authentication required');
      }

      const result = await assertCatalogProgram(programId);
      if (!result.ok) {
        if (result.reason === 'no_catalog') {
          return sendError(
            req,
            res,
            503,
            'ACADEMY_CATALOG_NOT_CONFIGURED',
            'Set one tenant as academy catalog or ACADEMY_CATALOG_TENANT_ID in env',
          );
        }
        return sendError(req, res, 404, 'PROGRAM_NOT_FOUND', 'Program not found');
      }
      const { program } = result;

      const durationDays =
        planId && typeof planId === 'string' && PLAN_DURATION_MAP[planId]
          ? PLAN_DURATION_MAP[planId]
          : program.durationDays || 30;

      const chargeAmount = program.price;

      const payment = await prisma.payment.create({
        data: {
          tenantId: program.tenantId,
          buyerTenantId,
          userId,
          programId: program.id,
          amount: chargeAmount,
          planId: planId && typeof planId === 'string' ? planId : 'standard',
          durationDays,
          status: 'PENDING',
        },
      });

      const paypackResponse = await PaypackService.cashin(chargeAmount, phoneNumber);

      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          paypackRef: paypackResponse.ref,
        },
      });

      return sendSuccess(
        req,
        res,
        {
          message: 'Payment initiated. Please confirm on your phone.',
          paymentId: payment.id,
          paypackRef: paypackResponse.ref,
        },
        202,
      );
    } catch (error) {
      next(error);
    }
  }

  static async handleWebhook(req: Request, res: Response) {
    try {
      const signature = req.get('X-Paypack-Signature');
      const webhookSecret = env.PAYPACK_WEBHOOK_SECRET;

      if (webhookSecret && signature) {
        const rawBody = req.rawBody;
        if (rawBody) {
          const hash = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('base64');

          if (hash !== signature) {
            academyWebhookLog.warn('Rejected Paypack webhook with invalid signature');
            return res.status(401).send('Invalid Signature');
          }
        }
      }

      const payload = req.body;
      if (!payload || !payload.data || !payload.data.ref) {
        academyWebhookLog.warn({ payload }, 'Rejected Paypack webhook with invalid payload');
        return res.status(400).send('Invalid payload');
      }

      const { ref, status } = payload.data;

      const payment = await prisma.payment.findUnique({
        where: { paypackRef: ref },
      });

      if (!payment) {
        const academyResult = await academySubscriptionService.handlePaymentWebhook(ref, status);
        if (!academyResult.handled) {
          academyWebhookLog.info({ ref, status }, 'Ignored Paypack webhook for unknown payment reference');
          return res.status(200).send('Payment not found (ignored)');
        }

        academyWebhookLog.info(
          {
            ref,
            status,
            paymentStatus: academyResult.status,
            paymentId: 'paymentId' in academyResult ? academyResult.paymentId : undefined,
            subscriptionId:
              'subscriptionId' in academyResult ? academyResult.subscriptionId : undefined,
          },
          'Processed academy subscription Paypack webhook',
        );

        getIO().to(`trx-${ref}`).emit('transactionUpdate', {
          event: 'payment:processed',
          status: academyResult.status,
          paymentId: 'paymentId' in academyResult ? academyResult.paymentId : undefined,
          ref,
        });

        return res.status(200).send('OK');
      }

      if (payment.status !== 'PENDING') {
        academyWebhookLog.info(
          { ref, status, paymentId: payment.id, paymentStatus: payment.status },
          'Ignored already-processed legacy payment webhook',
        );
        return res.status(200).send('Already processed');
      }

      if (status === 'successful') {
        await prisma.$transaction(async (tx) => {
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: 'COMPLETED' },
          });

          const duration = payment.durationDays || 30;
          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + duration);

          const enrollmentTenantId = payment.buyerTenantId ?? payment.tenantId;

          await tx.programEnrollment.upsert({
            where: {
              userId_programId: {
                userId: payment.userId,
                programId: payment.programId,
              },
            },
            update: {
              tenantId: enrollmentTenantId,
              isActive: true,
              expiresAt,
              isTrial: false,
            },
            create: {
              tenantId: enrollmentTenantId,
              userId: payment.userId,
              programId: payment.programId,
              expiresAt,
              isActive: true,
              isTrial: false,
            },
          });
        });

        getIO().to(`trx-${ref}`).emit('transactionUpdate', {
          event: 'payment:processed',
          status: 'COMPLETED',
          paymentId: payment.id,
          ref,
        });

        academyWebhookLog.info(
          { ref, status, paymentId: payment.id, paymentStatus: 'COMPLETED' },
          'Processed legacy program payment Paypack webhook',
        );
      } else if (status === 'failed' || status === 'cancelled') {
        const newStatus = status === 'failed' ? 'FAILED' : 'CANCELLED';
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: newStatus },
        });

        getIO().to(`trx-${ref}`).emit('transactionUpdate', {
          event: 'payment:processed',
          status: newStatus,
          paymentId: payment.id,
          ref,
        });

        academyWebhookLog.info(
          { ref, status, paymentId: payment.id, paymentStatus: newStatus },
          'Processed legacy program payment Paypack webhook',
        );
      } else {
        academyWebhookLog.info(
          { ref, status, paymentId: payment.id, paymentStatus: payment.status },
          'Received Paypack webhook with non-terminal legacy payment status',
        );
      }

      res.status(200).send('OK');
    } catch (error) {
      academyWebhookLog.error({ err: error }, 'Failed to process Paypack webhook');
      res.status(500).send('Internal Server Error');
    }
  }

  static async getMyEnrollments(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.sub;
      if (!userId) return res.status(401).send('Unauthorized');

      const enrollments = await prisma.programEnrollment.findMany({
        where: { userId, isActive: true },
        include: { program: true },
        orderBy: { createdAt: 'desc' },
      });

      return sendSuccess(req, res, enrollments);
    } catch (error) {
      next(error);
    }
  }

  static async getProgramContent(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const userId = req.user?.sub;

      if (!userId) return sendError(req, res, 401, 'UNAUTHORIZED', 'Unauthorized');

      const enrollment = await prisma.programEnrollment.findUnique({
        where: {
          userId_programId: {
            userId,
            programId: id,
          },
        },
      });

      if (!enrollment || !enrollment.isActive) {
        return sendError(req, res, 403, 'ENROLLMENT_REQUIRED', 'Active enrollment required');
      }

      if (enrollment.expiresAt && enrollment.expiresAt.getTime() < Date.now()) {
        return sendError(req, res, 403, 'ENROLLMENT_EXPIRED', 'Enrollment has expired');
      }

      const program = await prisma.program.findUnique({
        where: { id },
        include: {
          course: {
            include: {
              lessons: {
                where: { isPublished: true },
                orderBy: { sequence: 'asc' },
              },
              assessments: {
                where: { isPublished: true },
              },
            },
          },
        },
      });

      if (!program || !program.course) {
        return sendError(req, res, 404, 'CONTENT_NOT_FOUND', 'Program content not linked or found');
      }

      return sendSuccess(req, res, {
        programId: program.id,
        programTitle: program.title,
        course: program.course,
      });
    } catch (error) {
      next(error);
    }
  }
}
