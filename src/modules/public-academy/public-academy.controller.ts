import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import type { Program } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { sendSuccess, sendError } from '../../common/utils/response';
import { PaypackService } from '../../common/services/paypack.service';
import { getIO } from '../../common/utils/socket-server';
import { env } from '../../config/env';
import { resolveAcademyCatalogTenantId } from './academy-catalog';

const PLAN_DURATION_MAP: Record<string, number> = {
  weekly: 7,
  monthly: 30,
  quarterly: 90,
  yearly: 365,
};

type CatalogProgramResult =
  | { ok: true; program: Program; catalogTenantId: string }
  | { ok: false; reason: 'no_catalog' | 'not_found' };

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
  });
  if (!program) {
    return { ok: false, reason: 'not_found' };
  }
  return { ok: true, program, catalogTenantId };
}

export class PublicAcademyController {
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
        orderBy: { createdAt: 'desc' },
      });
      return sendSuccess(req, res, programs, 200, null, {
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
      return sendSuccess(req, res, result.program);
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
            return res.status(401).send('Invalid Signature');
          }
        }
      }

      const payload = req.body;
      if (!payload || !payload.data || !payload.data.ref) {
        return res.status(400).send('Invalid payload');
      }

      const { ref, status } = payload.data;

      const payment = await prisma.payment.findUnique({
        where: { paypackRef: ref },
      });

      if (!payment) {
        return res.status(200).send('Payment not found (ignored)');
      }

      if (payment.status !== 'PENDING') {
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
      }

      res.status(200).send('OK');
    } catch (error) {
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
