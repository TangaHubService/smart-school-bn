import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import { ParentsService } from './parents.service';
import { listLinkableStudentsQuerySchema, listParentsQuerySchema } from './parents.schemas';

const parentsService = new ParentsService();

function buildContext(req: Request) {
  return {
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  };
}

export class ParentsController {
  async listParents(req: Request, res: Response): Promise<Response> {
    const query = listParentsQuerySchema.parse(req.query);
    const result = await parentsService.listParents(req.tenantId!, query);

    return sendSuccess(req, res, result);
  }

  async createParent(req: Request, res: Response): Promise<Response> {
    const result = await parentsService.createParent(
      req.tenantId!,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result, 201);
  }

  async updateParent(req: Request, res: Response): Promise<Response> {
    const result = await parentsService.updateParent(
      req.tenantId!,
      req.params.id,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result);
  }

  async linkStudent(req: Request, res: Response): Promise<Response> {
    const result = await parentsService.linkStudent(
      req.tenantId!,
      req.params.id,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result, 201);
  }

  async listLinkableStudents(req: Request, res: Response): Promise<Response> {
    const query = listLinkableStudentsQuerySchema.parse(req.query);
    const result = await parentsService.listLinkableStudents(req.tenantId!, query);
    return sendSuccess(req, res, result);
  }

  async listMyStudents(req: Request, res: Response): Promise<Response> {
    const result = await parentsService.listMyStudents(req.tenantId!, req.user!.sub);
    return sendSuccess(req, res, result);
  }
}
