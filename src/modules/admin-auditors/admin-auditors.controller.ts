import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import { AdminAuditorsService } from './admin-auditors.service';
import { assignAuditorSchema, createAuditorUserSchema, listAuditorsQuerySchema, locationQuerySchema } from './admin-auditors.schemas';

const adminAuditorsService = new AdminAuditorsService();

export class AdminAuditorsController {
  async getLocations(req: Request, res: Response) {
    const query = locationQuerySchema.parse(req.query);
    const result = await adminAuditorsService.getLocations(query.province, query.district);
    return sendSuccess(req, res, result);
  }

  async listAuditors(req: Request, res: Response) {
    const query = listAuditorsQuerySchema.parse(req.query);
    const result = await adminAuditorsService.listAuditors(query, req.user!);
    return sendSuccess(req, res, result);
  }

  async getAuditorById(req: Request, res: Response) {
    const { auditorId } = req.params;
    const result = await adminAuditorsService.getAuditorById(auditorId, req.user!);
    return sendSuccess(req, res, result);
  }

  async assignAuditorScope(req: Request, res: Response) {
    const { userId } = req.params;
    const input = assignAuditorSchema.parse(req.body);
    const result = await adminAuditorsService.assignAuditorScope(userId, input, req.user!);
    return sendSuccess(req, res, result, 201);
  }

  async removeAuditorScope(req: Request, res: Response) {
    const { auditorId } = req.params;
    const result = await adminAuditorsService.removeAuditorScope(auditorId, req.user!);
    return sendSuccess(req, res, result);
  }

  async createAuditorUser(req: Request, res: Response) {
    const input = createAuditorUserSchema.parse(req.body);
    const result = await adminAuditorsService.createAuditorUser(input, req.user!);
    return sendSuccess(req, res, result, 201);
  }

  async searchUsers(req: Request, res: Response) {
    const { q } = req.query;
    if (!q || typeof q !== 'string') {
      return sendSuccess(req, res, []);
      return;
    }
    const result = await adminAuditorsService.searchUsers(q, req.user!);
    return sendSuccess(req, res, result);
  }

  async getMyScope(req: Request, res: Response) {
    const result = await adminAuditorsService.getMyScope(req.user!);
    return sendSuccess(req, res, result);
  }

  async getAuditorReport(req: Request, res: Response) {
    const result = await adminAuditorsService.getAuditorReport(req.user!);
    return sendSuccess(req, res, result);
  }
}