import { Request, Response } from 'express';

import { buildRequestAuditContext } from '../../common/utils/request-audit-context';
import { sendSuccess } from '../../common/utils/response';
import {
  createAnnouncementSchema,
  listAnnouncementsQuerySchema,
  listMyAnnouncementsQuerySchema,
  updateAnnouncementSchema,
} from './announcements.schemas';
import { AnnouncementsService } from './announcements.service';

const service = new AnnouncementsService();

export class AnnouncementsController {
  async list(req: Request, res: Response): Promise<Response> {
    const query = listAnnouncementsQuerySchema.parse(req.query);
    const result = await service.list(req.tenantId!, query, req.user ?? undefined);
    return sendSuccess(req, res, result);
  }

  async listForViewer(req: Request, res: Response): Promise<Response> {
    const query = listMyAnnouncementsQuerySchema.parse(req.query);
    const result = await service.listForViewer(req.tenantId!, req.user!, query);
    return sendSuccess(req, res, result);
  }

  async markRead(req: Request, res: Response): Promise<Response> {
    const result = await service.markRead(req.tenantId!, req.params.id, req.user!);
    return sendSuccess(req, res, result);
  }

  async getById(req: Request, res: Response): Promise<Response> {
    const result = await service.getById(req.tenantId!, req.params.id, req.user ?? undefined);
    return sendSuccess(req, res, result);
  }

  async create(req: Request, res: Response): Promise<Response> {
    const body = createAnnouncementSchema.parse(req.body);
    const result = await service.create(
      req.tenantId!,
      body,
      req.user!,
      buildRequestAuditContext(req)
    );
    return sendSuccess(req, res, result, 201);
  }

  async update(req: Request, res: Response): Promise<Response> {
    const body = updateAnnouncementSchema.parse(req.body);
    const result = await service.update(
      req.tenantId!,
      req.params.id,
      body,
      req.user!,
      buildRequestAuditContext(req)
    );
    return sendSuccess(req, res, result);
  }

  async delete(req: Request, res: Response): Promise<Response> {
    const result = await service.delete(
      req.tenantId!,
      req.params.id,
      req.user!,
      buildRequestAuditContext(req)
    );
    return sendSuccess(req, res, result);
  }
}
