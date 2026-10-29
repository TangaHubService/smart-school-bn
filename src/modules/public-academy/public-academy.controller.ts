import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../db/prisma';
import { sendSuccess, sendError } from '../../common/utils/response';
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
  AcademyClassSelectionInput,
} from './public-academy.schemas';

const academySubscriptionService = new AcademySubscriptionService();
const academyWebhookLog = rootLogger.child({ module: 'public-academy-webhook' });

type CatalogClassRow = {
  id: string;
  tenantId: string;
  name: string;
  price: number;
  durationDays: number;
  thumbnail: string | null;
  gradeLevel: { id: string; name: string; rank: number };
};

function mapCatalogClass(
  classRoom: CatalogClassRow,
  stats: { subjectCount: number; courseCount: number; titles: string[] }
) {
  return {
    id: classRoom.id,
    title: classRoom.name,
    description: null as string | null,
    thumbnail: classRoom.thumbnail,
    price: classRoom.price,
    durationDays: classRoom.durationDays,
    classRoomId: classRoom.id,
    className: classRoom.name,
    gradeLevelId: classRoom.gradeLevel.id,
    gradeLevelName: classRoom.gradeLevel.name,
    classSubjectCount: stats.subjectCount,
    classCourseCount: stats.courseCount,
    classCourseTitles: stats.titles,
  };
}

async function buildClassCourseStats(catalogTenantId: string, classRoomIds: string[]) {
  const stats = new Map<string, { subjectCount: number; courseCount: number; titles: string[] }>();
  if (!classRoomIds.length) return stats;
  const courses = await prisma.course.findMany({
    where: { tenantId: catalogTenantId, isActive: true, classRoomId: { in: classRoomIds } },
    select: { classRoomId: true, subjectId: true, title: true },
    orderBy: [{ title: 'asc' }],
  });
  const byClass = new Map<string, typeof courses>();
  for (const c of courses) {
    const list = byClass.get(c.classRoomId) ?? [];
    list.push(c);
    byClass.set(c.classRoomId, list);
  }
  for (const [classRoomId, list] of byClass) {
    stats.set(classRoomId, {
      subjectCount: new Set(list.map(c => c.subjectId).filter(Boolean)).size,
      courseCount: list.length,
      titles: list.slice(0, 6).map(c => c.title),
    });
  }
  return stats;
}

async function assertCatalogClass(classRoomId: string) {
  const catalogTenantId = await resolveAcademyCatalogTenantId();
  if (!catalogTenantId) return { ok: false as const, reason: 'no_catalog' as const };
  const classRoom = await prisma.classRoom.findFirst({
    where: { id: classRoomId, tenantId: catalogTenantId, isActive: true, listedInPublicCatalog: true },
    include: { gradeLevel: true },
  });
  if (!classRoom) return { ok: false as const, reason: 'not_found' as const };
  return { ok: true as const, classRoom, catalogTenantId };
}

async function hasActiveClassAccess(userId: string, classRoomId: string) {
  const enrollment = await prisma.classEnrollment.findFirst({
    where: {
      userId,
      classRoomId,
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true },
  });
  return Boolean(enrollment);
}

export class PublicAcademyController {
  /**
   * Public plan catalog (single source of truth for plan prices/durations).
   * Frontend must fetch this instead of hardcoding prices.
   */
  static async getPlans(req: Request, res: Response, next: NextFunction) {
    try {
      const { ACADEMY_CHECKOUT_PLANS, isMockAcademyBillingEnabled } = await import(
        './academy-subscription.service'
      );
      const plans = Object.entries(ACADEMY_CHECKOUT_PLANS).map(([id, plan]) => ({
        id,
        name: id.charAt(0).toUpperCase() + id.slice(1),
        amount: plan.amount,
        durationDays: plan.durationDays,
        currency: 'RWF',
      }));
      return sendSuccess(req, res, {
        plans,
        currency: 'RWF',
        mockBillingEnabled: isMockAcademyBillingEnabled(),
      });
    } catch (error) {
      next(error);
    }
  }

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

  /** Public class catalog — pricing lives on the class. Replaces legacy GET /programs. */
  static async getClasses(req: Request, res: Response, next: NextFunction) {
    try {
      const catalogTenantId = await resolveAcademyCatalogTenantId();
      if (!catalogTenantId) {
        return sendSuccess(req, res, [], 200, null, {
          academyCatalog: { resolved: false, publicProgramCount: 0 },
        });
      }
      const classes = await prisma.classRoom.findMany({
        where: { tenantId: catalogTenantId, isActive: true, listedInPublicCatalog: true },
        include: { gradeLevel: true },
        orderBy: [{ gradeLevel: { rank: 'asc' } }, { name: 'asc' }],
      });
      const stats = await buildClassCourseStats(
        catalogTenantId,
        classes.map(c => c.id)
      );
      return sendSuccess(
        req,
        res,
        classes.map(c =>
          mapCatalogClass(c, stats.get(c.id) ?? { subjectCount: 0, courseCount: 0, titles: [] })
        ),
        200,
        null,
        {
          academyCatalog: { resolved: true, publicProgramCount: classes.length },
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

      const classes = await prisma.classRoom.findMany({
        where: { tenantId: catalogTenantId, isActive: true, listedInPublicCatalog: true },
        include: { gradeLevel: true },
      });

      const classRoomIds = classes.map(c => c.id);
      const classById = new Map(classes.map(c => [c.id, c]));

      const enrollmentGroups = classRoomIds.length
        ? await prisma.classEnrollment.groupBy({
            by: ['classRoomId'],
            where: { tenantId: catalogTenantId, isActive: true, classRoomId: { in: classRoomIds } },
            _count: { _all: true },
          })
        : [];
      const enrolledByClassId = new Map(
        enrollmentGroups.map(g => [g.classRoomId, g._count._all])
      );

      const courses = classRoomIds.length
        ? await prisma.course.findMany({
            where: { tenantId: catalogTenantId, isActive: true, classRoomId: { in: classRoomIds } },
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
                price: number;
                thumbnail: string | null;
                enrolledCount: number;
                subjects: Map<
                  string,
                  {
                    id: string;
                    name: string;
                    courseCount: number;
                    courses: Array<{ id: string; title: string }>;
                  }
                >;
              }
            >;
          }
        >;
      };

      const years = new Map<string, YearNode>();

      for (const course of courses) {
        if (!course.classRoomId) continue;
        const classRoom = classById.get(course.classRoomId);
        if (!classRoom) continue;

        const year =
          years.get(course.academicYear.id) ??
          ({
            id: course.academicYear.id,
            name: course.academicYear.name,
            isCurrent: course.academicYear.isCurrent,
            gradeLevels: new Map(),
          } as YearNode);
        years.set(course.academicYear.id, year);

        const gradeLevel = classRoom.gradeLevel;
        const gradeNode = year.gradeLevels.get(gradeLevel.id) ?? {
          id: gradeLevel.id,
          name: gradeLevel.name,
          rank: gradeLevel.rank,
          classRooms: new Map(),
        };
        year.gradeLevels.set(gradeLevel.id, gradeNode);

        const classNode = gradeNode.classRooms.get(classRoom.id) ?? {
          id: classRoom.id,
          name: classRoom.name,
          price: classRoom.price,
          thumbnail: classRoom.thumbnail,
          enrolledCount: enrolledByClassId.get(classRoom.id) ?? 0,
          subjects: new Map(),
        };
        gradeNode.classRooms.set(classRoom.id, classNode);

        if (course.subject) {
          const subjectNode = classNode.subjects.get(course.subject.id) ?? {
            id: course.subject.id,
            name: course.subject.name,
            courseCount: 0,
            courses: [] as Array<{ id: string; title: string }>,
          };
          subjectNode.courseCount += 1;
          subjectNode.courses.push({ id: course.id, title: course.title });
          subjectNode.courses.sort((a: { title: string }, b: { title: string }) =>
            a.title.localeCompare(b.title)
          );
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
                  price: classRoom.price,
                  thumbnail: classRoom.thumbnail,
                  enrolledCount: classRoom.enrolledCount,
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

  /**
   * Public platform stats: real counts for the public home page.
   * successRate = snapshots with averagePercentage >= 50 / snapshots with totals * 100.
   * No auth required. Null rate when no result data yet.
   */
  static async getPublicStats(req: Request, res: Response, next: NextFunction) {
    try {
      const [activeUsers, schools, courses, snapshots] = await Promise.all([
        prisma.user.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
        prisma.tenant.count({ where: { isActive: true, code: { not: 'platform' } } }),
        prisma.course.count({ where: { isActive: true } }),
        prisma.resultSnapshot.findMany({
          select: { payload: true },
          take: 5000,
        }),
      ]);
      let eligible = 0;
      let passed = 0;
      for (const s of snapshots) {
        const avg = (s.payload as unknown as { totals?: { averagePercentage?: unknown } } | null)
          ?.totals?.averagePercentage;
        if (typeof avg !== 'number' || Number.isNaN(avg)) continue;
        eligible += 1;
        if (avg >= 50) passed += 1;
      }
      return sendSuccess(req, res, {
        studentSuccessRate:
          eligible > 0
            ? { rate: Number(((passed / eligible) * 100).toFixed(1)), passed, eligible }
            : null,
        activeUsers,
        schools,
        courseModules: courses,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getClassById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await assertCatalogClass(id);
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
        return sendError(req, res, 404, 'CLASS_NOT_FOUND', 'Class not found');
      }
      const stats = await buildClassCourseStats(result.catalogTenantId, [result.classRoom.id]);
      return sendSuccess(
        req,
        res,
        mapCatalogClass(
          result.classRoom,
          stats.get(result.classRoom.id) ?? { subjectCount: 0, courseCount: 0, titles: [] }
        )
      );
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

  /**
   * Dev/demo instant checkout (no Paypack). The service refuses unless mock
   * billing is enabled, so this endpoint is inert in production.
   */
  static async startMockPlanCheckout(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.sub;
      const tenantId = req.user?.tenantId;

      if (!userId || !tenantId) {
        return sendError(req, res, 401, 'UNAUTHORIZED', 'Authentication required');
      }

      const { planId } = req.body as AcademyPlanCheckoutInput;
      const result = await academySubscriptionService.startMockPlanCheckout(
        userId,
        tenantId,
        planId as AcademyCheckoutPlanId
      );
      return sendSuccess(req, res, result, 201);
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

  static async handleWebhook(req: Request, res: Response) {
    try {
      const signature = req.get('X-Paypack-Signature');
      const webhookSecret = env.PAYPACK_WEBHOOK_SECRET;

      if (webhookSecret && signature) {
        const rawBody = req.rawBody;
        if (rawBody) {
          const crypto = await import('crypto');
          const hash = crypto
            .createHmac('sha256', webhookSecret)
            .update(rawBody)
            .digest('base64');

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
    } catch (error) {
      academyWebhookLog.error({ err: error }, 'Failed to process Paypack webhook');
      res.status(500).send('Internal Server Error');
    }
  }

  static async getMyEnrollments(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.sub;
      if (!userId) return res.status(401).send('Unauthorized');

      const enrollments = await prisma.classEnrollment.findMany({
        where: { userId, isActive: true },
        include: { classRoom: { include: { gradeLevel: true } } },
        orderBy: { createdAt: 'desc' },
      });

      return sendSuccess(req, res, enrollments);
    } catch (error) {
      next(error);
    }
  }

  /** Enrolling in a class unlocks every subject, course, lesson, and assessment within it. */
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
