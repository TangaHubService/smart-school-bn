import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import { GovService } from './gov.service';
import {
  listGovAuditorsQuerySchema,
  listGovConductMarksQuerySchema,
  listGovIncidentsQuerySchema,
  listGovSchoolsQuerySchema,
} from './gov.schemas';

const govService = new GovService();

function buildContext(req: Request) {
  return {
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  };
}

export class GovController {
  async createAuditor(req: Request, res: Response): Promise<Response> {
    const result = await govService.createAuditor(
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result, 201);
  }

  async listAuditors(req: Request, res: Response): Promise<Response> {
    const query = listGovAuditorsQuerySchema.parse(req.query);
    const result = await govService.listAuditors(query, req.user!);

    return sendSuccess(req, res, result);
  }

  async listAuditorScopes(req: Request, res: Response): Promise<Response> {
    const auditorUserId = req.params.auditorUserId ?? req.params.userId;
    const result = await govService.listAuditorScopes(auditorUserId, req.user!);

    return sendSuccess(req, res, result);
  }

  async assignScope(req: Request, res: Response): Promise<Response> {
    const auditorUserId = req.params.auditorUserId ?? req.params.userId;
    const result = await govService.assignScope(
      auditorUserId,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result, 201);
  }

  async updateScope(req: Request, res: Response): Promise<Response> {
    const result = await govService.updateScope(
      req.params.scopeId,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result);
  }

  async getDashboard(req: Request, res: Response): Promise<Response> {
    const result = await govService.getDashboard(req.user!);

    return sendSuccess(req, res, result);
  }

  async listSchools(req: Request, res: Response): Promise<Response> {
    const query = listGovSchoolsQuerySchema.parse(req.query);
    const result = await govService.listSchools(req.user!, query);

    return sendSuccess(req, res, result);
  }

  async getSchoolDetail(req: Request, res: Response): Promise<Response> {
    const result = await govService.getSchoolDetail(req.user!, req.params.tenantId);

    return sendSuccess(req, res, result);
  }

  async listIncidents(req: Request, res: Response): Promise<Response> {
    const query = listGovIncidentsQuerySchema.parse(req.query);
    const result = await govService.listIncidents(req.user!, query);

    return sendSuccess(req, res, result);
  }

  async getIncidentDetail(req: Request, res: Response): Promise<Response> {
    const result = await govService.getIncidentDetail(req.user!, req.params.incidentId);

    return sendSuccess(req, res, result);
  }

  async addFeedback(req: Request, res: Response): Promise<Response> {
    const result = await govService.addFeedback(
      req.user!,
      req.params.incidentId,
      req.body,
      buildContext(req),
    );

    return sendSuccess(req, res, result, 201);
  }

  async listMarks(req: Request, res: Response): Promise<Response> {
    const query = listGovConductMarksQuerySchema.parse(req.query);
    const result = await govService.listMarks(req.user!, query);

    return sendSuccess(req, res, result);
  }

  async addMarkFeedback(req: Request, res: Response): Promise<Response> {
    const result = await govService.addMarkFeedback(
      req.user!,
      req.params.markId,
      req.body,
      buildContext(req),
    );

    return sendSuccess(req, res, result, 201);
  }
}
