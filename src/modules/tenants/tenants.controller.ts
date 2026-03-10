import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import { TenantsService } from './tenants.service';
import { listTenantsQuerySchema } from './tenants.schemas';

const tenantsService = new TenantsService();

function buildContext(req: Request) {
  return {
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  };
}

export class TenantsController {
  async listTenants(req: Request, res: Response): Promise<Response> {
    const query = listTenantsQuerySchema.parse(req.query);
    const result = await tenantsService.listTenants(query, req.user!);
    return sendSuccess(req, res, result.items, 200, result.pagination);
  }

  async createTenant(req: Request, res: Response): Promise<Response> {
    const result = await tenantsService.createTenant(
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result, 201);
  }

  async getTenant(req: Request, res: Response): Promise<Response> {
    const result = await tenantsService.getTenant(req.params.id, req.user!);
    return sendSuccess(req, res, result);
  }

  async inviteSchoolAdmin(req: Request, res: Response): Promise<Response> {
    const result = await tenantsService.inviteSchoolAdmin(
      req.params.id,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result, 201);
  }

  async updateTenant(req: Request, res: Response): Promise<Response> {
    const result = await tenantsService.updateTenant(
      req.params.id,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result);
  }

  async updateTenantStatus(req: Request, res: Response): Promise<Response> {
    const result = await tenantsService.updateTenantStatus(
      req.params.id,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result);
  }

  async deactivateTenant(req: Request, res: Response): Promise<Response> {
    const result = await tenantsService.deactivateTenant(
      req.params.id,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result);
  }
}
