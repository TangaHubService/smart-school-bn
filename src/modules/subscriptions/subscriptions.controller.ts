import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import { updateSchoolSubscriptionSchema } from './subscriptions.schemas';
import { SubscriptionsService } from './subscriptions.service';

const service = new SubscriptionsService();

function buildContext(req: Request) {
  return {
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  };
}

export class SubscriptionsController {
  async listPlans(req: Request, res: Response): Promise<Response> {
    const result = await service.listPlans(req.user!);
    return sendSuccess(req, res, result);
  }

  async listSchoolSubscriptions(req: Request, res: Response): Promise<Response> {
    const result = await service.listSchoolSubscriptions(req.user!);
    return sendSuccess(req, res, result);
  }

  async updateSchoolSubscription(req: Request, res: Response): Promise<Response> {
    const body = updateSchoolSubscriptionSchema.parse(req.body);
    const result = await service.updateSchoolSubscription(
      req.params.tenantId,
      body,
      req.user!,
      buildContext(req),
    );
    return sendSuccess(req, res, result);
  }
}
