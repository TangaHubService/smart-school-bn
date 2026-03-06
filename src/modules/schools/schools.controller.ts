import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import { SchoolsService } from './schools.service';

const schoolsService = new SchoolsService();

function buildContext(req: Request) {
  return {
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  };
}

export class SchoolsController {
  async completeSetup(req: Request, res: Response): Promise<Response> {
    const result = await schoolsService.completeSetup(
      req.tenantId!,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result);
  }

  async getSetupStatus(req: Request, res: Response): Promise<Response> {
    const result = await schoolsService.getSchoolSetupStatus(req.tenantId!);
    return sendSuccess(req, res, result);
  }
}
