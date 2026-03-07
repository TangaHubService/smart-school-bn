import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import { StaffService } from './staff.service';
import { listStaffMembersQuerySchema } from './staff.schemas';

const staffService = new StaffService();

function buildContext(req: Request) {
  return {
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  };
}

export class StaffController {
  async invite(req: Request, res: Response): Promise<Response> {
    const result = await staffService.inviteStaff(
      req.tenantId!,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result, 201);
  }

  async acceptInvite(req: Request, res: Response): Promise<Response> {
    const result = await staffService.acceptInvite(req.body, buildContext(req));
    return sendSuccess(req, res, result);
  }

  async listInvites(req: Request, res: Response): Promise<Response> {
    const result = await staffService.listInvites(req.tenantId!);
    return sendSuccess(req, res, result);
  }

  async listMembers(req: Request, res: Response): Promise<Response> {
    const query = listStaffMembersQuerySchema.parse(req.query);
    const result = await staffService.listMembers(req.tenantId!, query);
    return sendSuccess(req, res, result);
  }

  async getMember(req: Request, res: Response): Promise<Response> {
    const result = await staffService.getMember(req.tenantId!, req.params.id);
    return sendSuccess(req, res, result);
  }

  async updateMember(req: Request, res: Response): Promise<Response> {
    const result = await staffService.updateMember(
      req.tenantId!,
      req.params.id,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result);
  }

  async deleteMember(req: Request, res: Response): Promise<Response> {
    const result = await staffService.deleteMember(
      req.tenantId!,
      req.params.id,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result);
  }

  async revokeInvite(req: Request, res: Response): Promise<Response> {
    const result = await staffService.revokeInvite(
      req.tenantId!,
      req.params.id,
      req.user!,
      buildContext(req),
    );
    return sendSuccess(req, res, result);
  }
}
