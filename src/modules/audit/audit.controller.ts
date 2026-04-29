import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import { listAuditLogsQuerySchema } from './audit.schemas';
import { AuditListService } from './audit-list.service';

const auditListService = new AuditListService();

export class AuditController {
  async list(req: Request, res: Response): Promise<Response> {
    const query = listAuditLogsQuerySchema.parse(req.query);
    const result = await auditListService.listSuperAdmin(req.user!, query);
    return sendSuccess(req, res, result);
  }

  async listTenant(req: Request, res: Response): Promise<Response> {
    const query = listAuditLogsQuerySchema.parse(req.query);
    const result = await auditListService.listTenant(req.user!, query);
    return sendSuccess(req, res, result);
  }
}
