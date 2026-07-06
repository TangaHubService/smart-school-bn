import { Request, Response } from 'express';
import { resolveAcademicYearId } from '../../common/utils/academic-year-scope';
import { sendSuccess } from '../../common/utils/response';
import { LessonPlansService } from './lesson-plans.service';
import {
  createLessonPlanSchema,
  updateLessonPlanSchema,
  reviewLessonPlanSchema,
  lessonPlanFeedbackSchema,
  listLessonPlansQuerySchema,
} from './lesson-plans.schemas';

const service = new LessonPlansService();

export class LessonPlansController {
  async create(req: Request, res: Response) {
    const input = createLessonPlanSchema.parse(req.body);
    const result = await service.create(req.tenantId!, input, req.user!);
    return sendSuccess(req, res, result, 201);
  }

  async update(req: Request, res: Response) {
    const input = updateLessonPlanSchema.parse(req.body);
    const result = await service.update(req.tenantId!, req.params.planId, input, req.user!);
    return sendSuccess(req, res, result);
  }

  async submit(req: Request, res: Response) {
    const result = await service.submit(req.tenantId!, req.params.planId, req.user!);
    return sendSuccess(req, res, result);
  }

  async review(req: Request, res: Response) {
    const input = reviewLessonPlanSchema.parse(req.body);
    const result = await service.review(req.tenantId!, req.params.planId, input, req.user!);
    return sendSuccess(req, res, result);
  }

  async delete(req: Request, res: Response) {
    const result = await service.delete(req.tenantId!, req.params.planId, req.user!);
    return sendSuccess(req, res, result);
  }

  async addFeedback(req: Request, res: Response) {
    const input = lessonPlanFeedbackSchema.parse(req.body);
    const result = await service.addFeedback(req.tenantId!, req.params.planId, input, req.user!);
    return sendSuccess(req, res, result);
  }

  async listRevisions(req: Request, res: Response) {
    const result = await service.listRevisions(req.tenantId!, req.params.planId, req.user!);
    return sendSuccess(req, res, result);
  }

  async list(req: Request, res: Response) {
    const query = listLessonPlansQuerySchema.parse(req.query);
    query.academicYearId = await resolveAcademicYearId(req, query.academicYearId);
    const result = await service.list(req.tenantId!, query, req.user!);
    return sendSuccess(req, res, result);
  }
}
