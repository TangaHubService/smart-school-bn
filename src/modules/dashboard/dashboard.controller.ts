import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import { DashboardService } from './dashboard.service';

const dashboardService = new DashboardService();

export class DashboardController {
  async getSuperAdminDashboard(req: Request, res: Response): Promise<Response> {
    const filters = {
      academicYear: typeof req.query.academicYear === 'string' ? req.query.academicYear : undefined,
      term: typeof req.query.term === 'string' ? req.query.term : undefined,
      region: typeof req.query.region === 'string' ? req.query.region : undefined,
      school: typeof req.query.school === 'string' ? req.query.school : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
    };
    const result = await dashboardService.getSuperAdminDashboard(req.user!, filters);
    return sendSuccess(req, res, result);
  }

  async getSuperAdminFilters(req: Request, res: Response): Promise<Response> {
    const result = await dashboardService.getSuperAdminFilters(req.user!);
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

  async getTeacherDashboard(req: Request, res: Response): Promise<Response> {
    const result = await dashboardService.getTeacherDashboard(req.user!);
    return sendSuccess(req, res, result);
  }
}
