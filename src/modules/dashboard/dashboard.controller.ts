import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import { DashboardService } from './dashboard.service';

const dashboardService = new DashboardService();

export class DashboardController {
  async getSuperAdminDashboard(req: Request, res: Response): Promise<Response> {
    const result = await dashboardService.getSuperAdminDashboard(req.user!);
    return sendSuccess(req, res, result);
  }

  async getSchoolAdminDashboard(req: Request, res: Response): Promise<Response> {
    const result = await dashboardService.getSchoolAdminDashboard(req.user!);
    return sendSuccess(req, res, result);
  }

  async getStudentDashboard(req: Request, res: Response): Promise<Response> {
    const result = await dashboardService.getStudentDashboard(req.user!);
    return sendSuccess(req, res, result);
  }
}
