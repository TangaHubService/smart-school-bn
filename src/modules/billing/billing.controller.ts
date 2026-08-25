import crypto from 'crypto';
import { Request, Response } from 'express';

import { AppError } from '../../common/errors/app-error';
import { env } from '../../config/env';
import { sendSuccess } from '../../common/utils/response';
import { BillingService } from './billing.service';
import { paySubscriptionInvoiceSchema } from './billing.schemas';

const service = new BillingService();

function buildContext(req: Request) {
  return {
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  };
}

export class BillingController {
  async getMyInvoice(req: Request, res: Response): Promise<Response> {
    const result = await service.getMyInvoice(req.tenantId!);
    return sendSuccess(req, res, result);
  }

  async payMyInvoice(req: Request, res: Response): Promise<Response> {
    const body = paySubscriptionInvoiceSchema.parse(req.body);
    const result = await service.payInvoice(req.tenantId!, req.user!, body, buildContext(req));
    return sendSuccess(req, res, result);
  }

  /**
   * Unauthenticated Paypack callback. Signature is HMAC-SHA256 (base64) over
   * the raw request body, mirroring the public-academy webhook contract.
   */
  async handlePaypackWebhook(req: Request, res: Response): Promise<Response> {
    const signature = req.get('X-Paypack-Signature');
    const webhookSecret = env.PAYPACK_WEBHOOK_SECRET;

    if (!webhookSecret || !signature || !req.rawBody) {
      return res.status(401).send('Invalid Signature');
    }

    const hash = crypto.createHmac('sha256', webhookSecret).update(req.rawBody).digest('base64');
    if (hash !== signature) {
      return res.status(401).send('Invalid Signature');
    }

    const payload = req.body;
    if (!payload?.data?.ref) {
      return res.status(400).send('Invalid payload');
    }

    const result = await service.handlePaypackWebhook(
      String(payload.data.ref),
      String(payload.data.status ?? ''),
      buildContext(req)
    );

    if (!result.handled) {
      return res.status(200).send('Payment not found (ignored)');
    }

    return res.status(200).send('OK');
  }
}

export function assertBillingWebhookConfigured(): void {
  if (!env.PAYPACK_WEBHOOK_SECRET) {
    throw new AppError(
      503,
      'BILLING_WEBHOOK_NOT_CONFIGURED',
      'PAYPACK_WEBHOOK_SECRET must be configured to receive payment confirmations'
    );
  }
}
