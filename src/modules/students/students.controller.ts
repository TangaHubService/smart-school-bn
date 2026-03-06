import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import { StudentsService } from './students.service';
import { listStudentsQuerySchema } from './students.schemas';

const studentsService = new StudentsService();

function buildContext(req: Request) {
  return {
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  };
}

export class StudentsController {
  async createStudent(req: Request, res: Response): Promise<Response> {
    const result = await studentsService.createStudent(
      req.tenantId!,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result, 201);
  }

  async listStudents(req: Request, res: Response): Promise<Response> {
    const query = listStudentsQuerySchema.parse(req.query);
    const result = await studentsService.listStudents(req.tenantId!, query);

    return sendSuccess(req, res, result);
  }

  async updateStudent(req: Request, res: Response): Promise<Response> {
    const result = await studentsService.updateStudent(
      req.tenantId!,
      req.params.id,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result);
  }

  async deleteStudent(req: Request, res: Response): Promise<Response> {
    const result = await studentsService.deleteStudent(
      req.tenantId!,
      req.params.id,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result);
  }

  async importStudents(req: Request, res: Response): Promise<Response> {
    const result = await studentsService.importStudents(
      req.tenantId!,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result);
  }

  async exportStudents(req: Request, res: Response): Promise<Response> {
    const query = listStudentsQuerySchema.parse(req.query);
    const result = await studentsService.exportStudents(req.tenantId!, query);

    return sendSuccess(req, res, result);
  }
}
