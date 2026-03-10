import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../db/prisma';
import { sendSuccess, sendError } from '../../common/utils/response';
import { PaypackService } from '../../common/services/paypack.service';
import { getIO } from '../../common/utils/socket-server';
import crypto from 'crypto';
import { env } from '../../config/env';

const PLAN_DURATION_MAP: Record<string, number> = {
  weekly: 7,
  monthly: 30,
  quarterly: 90,
  yearly: 365,
};

export class PublicAcademyController {
  /**
   * List all active programs
   */
  static async getPrograms(req: Request, res: Response, next: NextFunction) {
    try {
      const programs = await prisma.program.findMany({
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
      });
      return sendSuccess(req, res, programs);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get a single program details
   */
  static async getProgramById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const program = await prisma.program.findUnique({
        where: { id },
      });

      if (!program) {
        return sendError(req, res, 404, 'PROGRAM_NOT_FOUND', 'Program not found');
      }

      return sendSuccess(req, res, program);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Purchase a program (initiates Paypack cashin)
   */
  static async purchaseProgram(req: Request, res: Response, next: NextFunction) {
    try {
      const { programId, phoneNumber, amount, planId } = req.body;
      const userId = req.user?.sub;

      if (!userId) {
        return sendError(req, res, 401, 'UNAUTHORIZED', 'Authentication required');
      }

      const program = await prisma.program.findUnique({
        where: { id: programId },
      });

      if (!program) {
        return sendError(req, res, 404, 'PROGRAM_NOT_FOUND', 'Program not found');
      }

      const finalAmount = amount || program.price;
      const durationDays = planId ? PLAN_DURATION_MAP[planId] : (program.durationDays || 30);

      // 1. Create PENDING payment
      const payment = await prisma.payment.create({
        data: {
          tenantId: program.tenantId,
          userId,
          programId: program.id,
          amount: finalAmount,
          planId: planId || 'standard',
          durationDays,
          status: 'PENDING',
        },
      });

      // 2. Initiate Paypack cashin
      const paypackResponse = await PaypackService.cashin(finalAmount, phoneNumber);

      // 3. Update payment with reference
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          paypackRef: paypackResponse.ref,
        },
      });

      return sendSuccess(req, res, {
        message: 'Payment initiated. Please confirm on your phone.',
        paymentId: payment.id,
        paypackRef: paypackResponse.ref,
      }, 202);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle Paypack Webhook
   */
  static async handleWebhook(req: Request, res: Response) {
    try {
      const signature = req.get('X-Paypack-Signature');
      const webhookSecret = env.PAYPACK_WEBHOOK_SECRET;

      // 1. Verify Signature
      if (webhookSecret && signature) {
        const rawBody = req.rawBody;
        if (rawBody) {
          const hash = crypto
            .createHmac('sha256', webhookSecret)
            .update(rawBody)
            .digest('base64');

          if (hash !== signature) {
            console.warn('[WEBHOOK] Invalid signature detected');
            return res.status(401).send('Invalid Signature');
          }
        }
      }

      const payload = req.body;
      if (!payload || !payload.data || !payload.data.ref) {
        return res.status(400).send('Invalid payload');
      }

      const { ref, status } = payload.data;

      // 2. Find Payment
      const payment = await prisma.payment.findUnique({
        where: { paypackRef: ref },
      });

      if (!payment) {
        return res.status(200).send('Payment not found (ignored)');
      }

      if (payment.status !== 'PENDING') {
        return res.status(200).send('Already processed');
      }

      // 3. Update Status and Enroll
      if (status === 'successful') {
        await prisma.$transaction(async (tx) => {
          // Update Payment
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: 'COMPLETED' },
          });

          // Fetch program duration from payment
          const duration = payment.durationDays || 30;
          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + duration);

          // Upsert Enrollment
          await tx.programEnrollment.upsert({
            where: {
              userId_programId: {
                userId: payment.userId,
                programId: payment.programId,
              },
            },
            update: {
              isActive: true,
              expiresAt,
            },
            create: {
              tenantId: payment.tenantId,
              userId: payment.userId,
              programId: payment.programId,
              expiresAt,
              isActive: true,
            },
          });
        });

        // Notify client via Socket
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
          data: { status: newStatus as any },
        });

        // Notify client via Socket
        getIO().to(`trx-${ref}`).emit('transactionUpdate', {
          event: 'payment:processed',
          status: newStatus,
          paymentId: payment.id,
          ref,
        });
      }

      res.status(200).send('OK');
    } catch (error) {
      console.error('[WEBHOOK] Processing failed:', error);
      res.status(500).send('Internal Server Error');
    }
  }

  /**
   * Get active enrollments for the current user
   */
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

  /**
   * Get lessons and assessments for an enrolled program
   */
  static async getProgramContent(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const userId = req.user?.sub;

      if (!userId) return res.status(401).send('Unauthorized');

      // 1. Check Enrollment
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

      // 2. Fetch Content
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
