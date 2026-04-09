import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import { AssessmentsService } from './assessments.service';
import {
  listAssessmentResultsQuerySchema,
  listAssessmentsQuerySchema,
  listMyAssessmentsQuerySchema,
  replaceAssessmentAssigneesSchema,
  startAssessmentAttemptSchema,
  updateAssessmentSchema,
  updateAssessmentPortalSchema,
} from './assessments.schemas';

const assessmentsService = new AssessmentsService();

function buildContext(req: Request) {
  return {
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  };
}

export class AssessmentsController {
  async createAssessment(req: Request, res: Response): Promise<Response> {
    const result = await assessmentsService.createAssessment(
      req.tenantId!,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result, 201);
  }

  async listAssessments(req: Request, res: Response): Promise<Response> {
    const query = listAssessmentsQuerySchema.parse(req.query);
    const result = await assessmentsService.listAssessments(req.tenantId!, query, req.user!);

    return sendSuccess(req, res, result, 200, result.pagination);
  }

  async getAssessmentDetail(req: Request, res: Response): Promise<Response> {
    const result = await assessmentsService.getAssessmentDetail(
      req.tenantId!,
      req.params.id,
      req.user!,
    );

    return sendSuccess(req, res, result);
  }

  async updateAssessment(req: Request, res: Response): Promise<Response> {
    const body = updateAssessmentSchema.parse(req.body ?? {});
    const result = await assessmentsService.updateAssessment(
      req.tenantId!,
      req.params.id,
      body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result);
  }

  async deleteAssessment(req: Request, res: Response): Promise<Response> {
    const result = await assessmentsService.deleteAssessment(
      req.tenantId!,
      req.params.id,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result);
  }

  async addQuestion(req: Request, res: Response): Promise<Response> {
    const result = await assessmentsService.addQuestion(
      req.tenantId!,
      req.params.id,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result, 201);
  }

  async updateQuestion(req: Request, res: Response): Promise<Response> {
    const result = await assessmentsService.updateQuestion(
      req.tenantId!,
      req.params.id,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result);
  }

  async deleteQuestion(req: Request, res: Response): Promise<Response> {
    const result = await assessmentsService.deleteQuestion(
      req.tenantId!,
      req.params.id,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result);
  }

  async publishAssessment(req: Request, res: Response): Promise<Response> {
    const result = await assessmentsService.publishAssessment(
      req.tenantId!,
      req.params.id,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result);
  }

  async updateAssessmentPortal(req: Request, res: Response): Promise<Response> {
    const body = updateAssessmentPortalSchema.parse(req.body ?? {});
    const result = await assessmentsService.updateAssessmentPortal(
      req.tenantId!,
      req.params.id,
      body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result);
  }

  async replaceAssessmentAssignees(req: Request, res: Response): Promise<Response> {
    const body = replaceAssessmentAssigneesSchema.parse(req.body ?? {});
    const result = await assessmentsService.replaceAssessmentAssignees(
      req.tenantId!,
      req.params.id,
      body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result);
  }

  async listResults(req: Request, res: Response): Promise<Response> {
    const query = listAssessmentResultsQuerySchema.parse(req.query);
    const result = await assessmentsService.listAssessmentResults(
      req.tenantId!,
      req.params.id,
      query,
      req.user!,
    );

    return sendSuccess(req, res, result, 200, result.pagination);
  }

  async listMyAssessments(req: Request, res: Response): Promise<Response> {
    const query = listMyAssessmentsQuerySchema.parse(req.query);
    const result = await assessmentsService.listMyAssessments(req.tenantId!, req.user!, query);

    return sendSuccess(req, res, result, 200, result.pagination);
  }

  async getMyAssessment(req: Request, res: Response): Promise<Response> {
    const result = await assessmentsService.getMyAssessment(
      req.tenantId!,
      req.params.id,
      req.user!,
    );

    return sendSuccess(req, res, result);
  }

  async startAttempt(req: Request, res: Response): Promise<Response> {
    const body = startAssessmentAttemptSchema.parse(req.body ?? {});
    const result = await assessmentsService.startAttempt(
      req.tenantId!,
      req.params.id,
      body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result, 201);
  }

  async saveAttemptAnswers(req: Request, res: Response): Promise<Response> {
    const result = await assessmentsService.saveAttemptAnswers(
      req.tenantId!,
      req.params.id,
      req.body,
      req.user!,
    );

    return sendSuccess(req, res, result);
  }

  async submitAttempt(req: Request, res: Response): Promise<Response> {
    const result = await assessmentsService.submitAttempt(
      req.tenantId!,
      req.params.id,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result);
  }

  async regradeAttempt(req: Request, res: Response): Promise<Response> {
    const result = await assessmentsService.regradeAttempt(
      req.tenantId!,
      req.params.id,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result);
  }

  async getAttempt(req: Request, res: Response): Promise<Response> {
    const result = await assessmentsService.getAttempt(req.tenantId!, req.params.id, req.user!);

    return sendSuccess(req, res, result);
  }
}
