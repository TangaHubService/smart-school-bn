import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import {
  createSystemAnnouncementSchema,
  listSystemAnnouncementsQuerySchema,
  updateSystemAnnouncementSchema,
} from './system-announcements.schemas';
import { SystemAnnouncementsService } from './system-announcements.service';

const service = new SystemAnnouncementsService();

function buildContext(req: Request) {
  return {
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  };
}

export class SystemAnnouncementsController {
  async list(req: Request, res: Response): Promise<Response> {
    const query = listSystemAnnouncementsQuerySchema.parse(req.query);
    const result = await service.list(req.user!, query);
    return sendSuccess(req, res, result);
  }

  async create(req: Request, res: Response): Promise<Response> {
    const body = createSystemAnnouncementSchema.parse(req.body);
    const result = await service.create(req.user!, body, buildContext(req));
    return sendSuccess(req, res, result, 201);
  }

  async update(req: Request, res: Response): Promise<Response> {
    const body = updateSystemAnnouncementSchema.parse(req.body);
    const result = await service.update(req.params.id, req.user!, body, buildContext(req));
    return sendSuccess(req, res, result);
  }
}
