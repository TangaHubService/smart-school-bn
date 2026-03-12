import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import {
  createAnnouncementSchema,
  listAnnouncementsQuerySchema,
  updateAnnouncementSchema,
} from './announcements.schemas';
import { AnnouncementsService } from './announcements.service';

const service = new AnnouncementsService();

export class AnnouncementsController {
  async list(req: Request, res: Response): Promise<Response> {
    const query = listAnnouncementsQuerySchema.parse(req.query);
    const result = await service.list(req.tenantId!, query, req.user ?? undefined);
    return sendSuccess(req, res, result);
  }

  async listForStudent(req: Request, res: Response): Promise<Response> {
    const student = await this.getStudentForUser(req);
    const query = {
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 20,
    };
    const result = await service.listForStudent(
      req.tenantId!,
      student.id,
      query,
    );
    return sendSuccess(req, res, result);
  }

  async getById(req: Request, res: Response): Promise<Response> {
    const result = await service.getById(req.tenantId!, req.params.id);
    return sendSuccess(req, res, result);
  }

  async create(req: Request, res: Response): Promise<Response> {
    const body = createAnnouncementSchema.parse(req.body);
    const result = await service.create(req.tenantId!, body, req.user!);
    return sendSuccess(req, res, result, 201);
  }

  async update(req: Request, res: Response): Promise<Response> {
    const body = updateAnnouncementSchema.parse(req.body);
    const result = await service.update(req.tenantId!, req.params.id, body);
    return sendSuccess(req, res, result);
  }

  async delete(req: Request, res: Response): Promise<Response> {
    const result = await service.delete(req.tenantId!, req.params.id);
    return sendSuccess(req, res, result);
  }

  private async getStudentForUser(req: Request) {
    const { prisma } = await import('../../db/prisma');
    const student = await prisma.student.findFirst({
      where: {
        tenantId: req.tenantId!,
        userId: req.user!.sub,
        deletedAt: null,
      },
    });
    if (!student) {
      const { AppError } = await import('../../common/errors/app-error');
      throw new AppError(403, 'STUDENT_NOT_FOUND', 'Student profile not found');
    }
    return student;
  }
}
