import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import { ConductService } from './conduct.service';
import {
  listConductIncidentsQuerySchema,
  studentConductProfileQuerySchema,
} from './conduct.schemas';

const conductService = new ConductService();

function buildContext(req: Request) {
  return {
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  };
}

export class ConductController {
  async createIncident(req: Request, res: Response): Promise<Response> {
    const result = await conductService.createIncident(
      req.tenantId!,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result, 201);
  }

  async listIncidents(req: Request, res: Response): Promise<Response> {
    const query = listConductIncidentsQuerySchema.parse(req.query);
    const result = await conductService.listIncidents(req.tenantId!, query);

    return sendSuccess(req, res, result);
  }

  async getIncidentDetail(req: Request, res: Response): Promise<Response> {
    const result = await conductService.getIncidentDetail(
      req.tenantId!,
      req.params.id,
    );

    return sendSuccess(req, res, result);
  }

  async updateIncident(req: Request, res: Response): Promise<Response> {
    const result = await conductService.updateIncident(
      req.tenantId!,
      req.params.id,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result);
  }

  async addAction(req: Request, res: Response): Promise<Response> {
    const result = await conductService.addAction(
      req.tenantId!,
      req.params.id,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result, 201);
  }

  async resolveIncident(req: Request, res: Response): Promise<Response> {
    const result = await conductService.resolveIncident(
      req.tenantId!,
      req.params.id,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result);
  }

  async getStudentConductProfile(req: Request, res: Response): Promise<Response> {
    const query = studentConductProfileQuerySchema.parse(req.query);
    const result = await conductService.getStudentConductProfile(
      req.tenantId!,
      req.params.studentId,
      query,
    );

    return sendSuccess(req, res, result);
  }
}
