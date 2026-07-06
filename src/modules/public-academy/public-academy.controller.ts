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
  AcademyClassSelectionInput,
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
    classRoom: {
      include: {
        gradeLevel: true;
      };
    };
  };
}>;

type CatalogProgramResult =
  | { ok: true; program: CatalogProgramRow; catalogTenantId: string }
  | { ok: false; reason: 'no_catalog' | 'not_found' };

function buildCatalogClassStats(programs: CatalogProgramRow[]) {
  const classRoomIds = [
    ...new Set(programs.map(program => program.classRoomId).filter(Boolean)),
  ];
  return prisma.course.findMany({
    where: {
      tenantId: programs[0]?.tenantId ?? '',
      isActive: true,
      classRoomId: { in: classRoomIds as string[] },
    },
    include: {
      subject: { select: { id: true, name: true } },
    },
    orderBy: [{ title: 'asc' }],
  });
}

function mapCatalogProgram(
  program: CatalogProgramRow,
  classStats: Map<string, { subjectCount: number; courseCount: number; titles: string[] }>
) {
  const classRoom = program.classRoom ?? null;
  const stats = classRoom ? classStats.get(classRoom.id) : null;

  return {
    id: program.id,
    title: program.title,
    description: program.description,
    thumbnail: program.thumbnail,
    section: program.section,
    price: program.price,
    durationDays: program.durationDays,
    classRoomId: program.classRoomId,
    className: classRoom?.name ?? null,
    gradeLevelId: classRoom?.gradeLevel?.id ?? null,
    gradeLevelName: classRoom?.gradeLevel?.name ?? null,
    classSubjectCount: stats?.subjectCount ?? 0,
    classCourseCount: stats?.courseCount ?? 0,
    classCourseTitles: stats?.titles ?? [],
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
      classRoom: {
        include: {
          gradeLevel: true,
        },
      },
    },
  });
  if (!program) {
    return { ok: false, reason: 'not_found' };
  }
  return { ok: true, program, catalogTenantId };
}

async function hasActiveClassAccess(userId: string, classRoomId: string) {
  const enrollment = await prisma.programEnrollment.findFirst({
    where: {
      userId,
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      program: { classRoomId },
    },
    select: { id: true },
  });
  return Boolean(enrollment);
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
          classRoom: {
            include: {
              gradeLevel: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      const classStats = new Map<
        string,
        { subjectCount: number; courseCount: number; titles: string[] }
      >();
      if (programs.length) {
        const classCourses = await buildCatalogClassStats(programs);
        for (const course of classCourses) {
          if (!course.classRoomId) {
            continue;
          }
          const current = classStats.get(course.classRoomId) ?? {
            subjectCount: 0,
            courseCount: 0,
            titles: [],
          };
          current.courseCount += 1;
          if (course.subjectId) {
            current.subjectCount = new Set([
              ...classCourses
                .filter(c => c.classRoomId === course.classRoomId && c.subjectId)
                .map(c => c.subjectId),
            ]).size;
          }
          if (current.titles.length < 6) {
            current.titles.push(course.title);
          }
          classStats.set(course.classRoomId, current);
        }
      }
      return sendSuccess(
        req,
        res,
        programs.map(program => mapCatalogProgram(program, classStats)),
        200,
        null,
        {
          academyCatalog: {
            resolved: true,
            publicProgramCount: programs.length,
          },
        }
      );
    } catch (error) {
      next(error);
    }
  }

  static async getCatalogTree(req: Request, res: Response, next: NextFunction) {
    try {
      const catalogTenantId = await resolveAcademyCatalogTenantId();
      if (!catalogTenantId) {
        return sendSuccess(req, res, { academicYears: [] }, 200, null, {
          academyCatalog: { resolved: false, publicProgramCount: 0 },
        });
      }

      const programs = await prisma.program.findMany({
        where: {
          tenantId: catalogTenantId,
          isActive: true,
          listedInPublicCatalog: true,
          classRoomId: { not: null },
        },
        include: {
          classRoom: { include: { gradeLevel: true } },
        },
      });

      const classRoomIds = programs.map(p => p.classRoomId).filter((id): id is string => !!id);
      const programByClassRoomId = new Map(programs.map(p => [p.classRoomId as string, p]));

      const courses = classRoomIds.length
        ? await prisma.course.findMany({
            where: {
              tenantId: catalogTenantId,
              isActive: true,
              classRoomId: { in: classRoomIds },
            },
            include: {
              subject: { select: { id: true, name: true, code: true } },
              academicYear: { select: { id: true, name: true, isCurrent: true } },
            },
            orderBy: [{ title: 'asc' }],
          })
        : [];

      type YearNode = {
        id: string;
        name: string;
        isCurrent: boolean;
        gradeLevels: Map<
          string,
          {
            id: string;
            name: string;
            rank: number;
            classRooms: Map<
              string,
              {
                id: string;
                name: string;
                programId: string;
                price: number;
                thumbnail: string | null;
                subjects: Map<string, { id: string; name: string; courseCount: number }>;
              }
            >;
          }
        >;
      };

      const years = new Map<string, YearNode>();

      for (const course of courses) {
        if (!course.classRoomId) continue;
        const program = programByClassRoomId.get(course.classRoomId);
        if (!program || !program.classRoom) continue;

        const year =
          years.get(course.academicYear.id) ??
          ({
            id: course.academicYear.id,
            name: course.academicYear.name,
            isCurrent: course.academicYear.isCurrent,
            gradeLevels: new Map(),
          } as YearNode);
        years.set(course.academicYear.id, year);

        const gradeLevel = program.classRoom.gradeLevel;
        const gradeNode = year.gradeLevels.get(gradeLevel.id) ?? {
          id: gradeLevel.id,
          name: gradeLevel.name,
          rank: gradeLevel.rank,
          classRooms: new Map(),
        };
        year.gradeLevels.set(gradeLevel.id, gradeNode);

        const classNode = gradeNode.classRooms.get(program.classRoom.id) ?? {
          id: program.classRoom.id,
          name: program.classRoom.name,
          programId: program.id,
          price: program.price,
          thumbnail: program.thumbnail,
          subjects: new Map(),
        };
        gradeNode.classRooms.set(program.classRoom.id, classNode);

        if (course.subject) {
          const subjectNode = classNode.subjects.get(course.subject.id) ?? {
            id: course.subject.id,
            name: course.subject.name,
            courseCount: 0,
          };
          subjectNode.courseCount += 1;
          classNode.subjects.set(course.subject.id, subjectNode);
        }
      }

      const academicYears = [...years.values()]
        .map(year => ({
          id: year.id,
          name: year.name,
          isCurrent: year.isCurrent,
          gradeLevels: [...year.gradeLevels.values()]
            .map(grade => ({
              id: grade.id,
              name: grade.name,
              rank: grade.rank,
              classRooms: [...grade.classRooms.values()]
                .map(classRoom => ({
                  id: classRoom.id,
                  name: classRoom.name,
                  programId: classRoom.programId,
                  price: classRoom.price,
                  thumbnail: classRoom.thumbnail,
                  subjects: [...classRoom.subjects.values()].sort((a, b) =>
                    a.name.localeCompare(b.name)
                  ),
                }))
                .sort((a, b) => a.name.localeCompare(b.name)),
            }))
            .sort((a, b) => a.rank - b.rank),
        }))
        .sort((a, b) => (a.isCurrent === b.isCurrent ? 0 : a.isCurrent ? -1 : 1));

      return sendSuccess(req, res, { academicYears });
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
            'Set one tenant as academy catalog or ACADEMY_CATALOG_TENANT_ID in env'
          );
        }
        return sendError(req, res, 404, 'PROGRAM_NOT_FOUND', 'Program not found');
      }
      const classStats = new Map<
        string,
        { subjectCount: number; courseCount: number; titles: string[] }
      >();
      if (result.program.classRoomId) {
        const classCourses = await buildCatalogClassStats([result.program]);
        classStats.set(result.program.classRoomId, {
          subjectCount: new Set(classCourses.map(c => c.subjectId).filter(Boolean)).size,
          courseCount: classCourses.length,
          titles: classCourses.slice(0, 6).map(course => course.title),
        });
      }
      return sendSuccess(req, res, mapCatalogProgram(result.program, classStats));
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

  static async selectClass(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.sub;
      const tenantId = req.user?.tenantId;

      if (!userId || !tenantId) {
        return sendError(req, res, 401, 'UNAUTHORIZED', 'Authentication required');
      }

      const { classRoomId } = req.body as AcademyClassSelectionInput;
      const result = await academySubscriptionService.selectClass(userId, tenantId, classRoomId);
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
        req.params.programId
      );
      return sendSuccess(req, res, result);
    } catch (error) {
      next(error);
    }
  }

  static async removeClass(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.sub;
      const tenantId = req.user?.tenantId;

      if (!userId || !tenantId) {
        return sendError(req, res, 401, 'UNAUTHORIZED', 'Authentication required');
      }

      const result = await academySubscriptionService.removeClass(
        userId,
        tenantId,
        req.params.classRoomId
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
            'Set one tenant as academy catalog or ACADEMY_CATALOG_TENANT_ID in env'
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
        202
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
          academyWebhookLog.info(
            { ref, status },
            'Ignored Paypack webhook for unknown payment reference'
          );
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
          'Processed academy subscription Paypack webhook'
        );

        getIO()
          .to(`trx-${ref}`)
          .emit('transactionUpdate', {
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
          'Ignored already-processed legacy payment webhook'
        );
        return res.status(200).send('Already processed');
      }

      if (status === 'successful') {
        await prisma.$transaction(async tx => {
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
          'Processed legacy program payment Paypack webhook'
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
          'Processed legacy program payment Paypack webhook'
        );
      } else {
        academyWebhookLog.info(
          { ref, status, paymentId: payment.id, paymentStatus: payment.status },
          'Received Paypack webhook with non-terminal legacy payment status'
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
        include: { program: true },
      });

      if (!enrollment || !enrollment.isActive) {
        return sendError(req, res, 403, 'ENROLLMENT_REQUIRED', 'Active enrollment required');
      }

      if (enrollment.expiresAt && enrollment.expiresAt.getTime() < Date.now()) {
        return sendError(req, res, 403, 'ENROLLMENT_EXPIRED', 'Enrollment has expired');
      }

      if (!enrollment.program.classRoomId) {
        return sendError(req, res, 404, 'CONTENT_NOT_FOUND', 'Program content not linked or found');
      }

      req.params.classRoomId = enrollment.program.classRoomId;
      return PublicAcademyController.getClassContent(req, res, next);
    } catch (error) {
      next(error);
    }
  }

  /** Purchasing a class unlocks every subject, course, lesson, and assessment within it. */
  static async getClassContent(req: Request, res: Response, next: NextFunction) {
    try {
      const { classRoomId } = req.params;
      const userId = req.user?.sub;

      if (!userId) return sendError(req, res, 401, 'UNAUTHORIZED', 'Unauthorized');

      const hasAccess = await hasActiveClassAccess(userId, classRoomId);
      if (!hasAccess) {
        return sendError(req, res, 403, 'ENROLLMENT_REQUIRED', 'Active class enrollment required');
      }

      const classRoom = await prisma.classRoom.findUnique({
        where: { id: classRoomId },
        include: { gradeLevel: true },
      });

      if (!classRoom) {
        return sendError(req, res, 404, 'CLASS_NOT_FOUND', 'Class not found');
      }

      const courses = await prisma.course.findMany({
        where: { classRoomId, isActive: true },
        include: {
          subject: true,
          lessons: {
            where: { isPublished: true },
            orderBy: { sequence: 'asc' },
          },
          assessments: {
            where: { isPublished: true },
          },
          assignments: {
            where: { isPublished: true },
          },
        },
        orderBy: [{ title: 'asc' }],
      });

      return sendSuccess(req, res, {
        classRoomId: classRoom.id,
        className: classRoom.name,
        gradeLevelName: classRoom.gradeLevel.name,
        courses,
      });
    } catch (error) {
      next(error);
    }
  }
}
