import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import { HealthService } from './health.service';

const healthService = new HealthService();

export class HealthController {
  async getHealth(req: Request, res: Response): Promise<Response> {
    const result = await healthService.getHealth();
    return sendSuccess(req, res, result);
  }

  async getInfo(req: Request, res: Response): Promise<Response> {
    const result = await healthService.getPublicInfo();
    return sendSuccess(req, res, result);
  }
}
