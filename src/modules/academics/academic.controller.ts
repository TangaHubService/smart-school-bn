import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import { AcademicsService } from './academic.service';
import { listTermsQuerySchema } from './academic.schemas';

const academicsService = new AcademicsService();

function buildContext(req: Request) {
  return {
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  };
}

export class AcademicsController {
  async createAcademicYear(req: Request, res: Response): Promise<Response> {
    const result = await academicsService.createAcademicYear(
      req.tenantId!,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result, 201);
  }

  async listAcademicYears(req: Request, res: Response): Promise<Response> {
    const result = await academicsService.listAcademicYears(req.tenantId!);
    return sendSuccess(req, res, result);
  }

  async updateAcademicYear(req: Request, res: Response): Promise<Response> {
    const result = await academicsService.updateAcademicYear(
      req.tenantId!,
      req.params.id,
      req.body,
    );

    return sendSuccess(req, res, result);
  }

  async deleteAcademicYear(req: Request, res: Response): Promise<Response> {
    const result = await academicsService.deleteAcademicYear(
      req.tenantId!,
      req.params.id,
    );

    return sendSuccess(req, res, result);
  }

  async createTerm(req: Request, res: Response): Promise<Response> {
    const result = await academicsService.createTerm(
      req.tenantId!,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result, 201);
  }

  async listTerms(req: Request, res: Response): Promise<Response> {
    const query = listTermsQuerySchema.parse(req.query);
    const result = await academicsService.listTerms(req.tenantId!, query);
    return sendSuccess(req, res, result);
  }

  async updateTerm(req: Request, res: Response): Promise<Response> {
    const result = await academicsService.updateTerm(
      req.tenantId!,
      req.params.id,
      req.body,
    );

    return sendSuccess(req, res, result);
  }

  async deleteTerm(req: Request, res: Response): Promise<Response> {
    const result = await academicsService.deleteTerm(req.tenantId!, req.params.id);
    return sendSuccess(req, res, result);
  }

  async createGradeLevel(req: Request, res: Response): Promise<Response> {
    const result = await academicsService.createGradeLevel(
      req.tenantId!,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result, 201);
  }

  async listGradeLevels(req: Request, res: Response): Promise<Response> {
    const result = await academicsService.listGradeLevels(req.tenantId!);
    return sendSuccess(req, res, result);
  }

  async updateGradeLevel(req: Request, res: Response): Promise<Response> {
    const result = await academicsService.updateGradeLevel(
      req.tenantId!,
      req.params.id,
      req.body,
    );

    return sendSuccess(req, res, result);
  }

  async deleteGradeLevel(req: Request, res: Response): Promise<Response> {
    const result = await academicsService.deleteGradeLevel(
      req.tenantId!,
      req.params.id,
    );

    return sendSuccess(req, res, result);
  }

  async createClassRoom(req: Request, res: Response): Promise<Response> {
    const result = await academicsService.createClassRoom(
      req.tenantId!,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result, 201);
  }

  async listClassRooms(req: Request, res: Response): Promise<Response> {
    const result = await academicsService.listClassRooms(req.tenantId!);
    return sendSuccess(req, res, result);
  }

  async updateClassRoom(req: Request, res: Response): Promise<Response> {
    const result = await academicsService.updateClassRoom(
      req.tenantId!,
      req.params.id,
      req.body,
    );

    return sendSuccess(req, res, result);
  }

  async deleteClassRoom(req: Request, res: Response): Promise<Response> {
    const result = await academicsService.deleteClassRoom(req.tenantId!, req.params.id);
    return sendSuccess(req, res, result);
  }

  async createSubject(req: Request, res: Response): Promise<Response> {
    const result = await academicsService.createSubject(
      req.tenantId!,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result, 201);
  }

  async listSubjects(req: Request, res: Response): Promise<Response> {
    const result = await academicsService.listSubjects(req.tenantId!);
    return sendSuccess(req, res, result);
  }

  async updateSubject(req: Request, res: Response): Promise<Response> {
    const result = await academicsService.updateSubject(
      req.tenantId!,
      req.params.id,
      req.body,
    );

    return sendSuccess(req, res, result);
  }

  async deleteSubject(req: Request, res: Response): Promise<Response> {
    const result = await academicsService.deleteSubject(req.tenantId!, req.params.id);
    return sendSuccess(req, res, result);
  }
}
