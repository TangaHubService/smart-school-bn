import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { BillingController } from './billing.controller';
import { paySubscriptionInvoiceSchema } from './billing.schemas';

const controller = new BillingController();

export const billingRoutes = Router();

// Public provider callback (signature-verified in the controller).
billingRoutes.post(
  '/webhooks/paypack',
  asyncHandler((req, res) => controller.handlePaypackWebhook(req, res))
);

// Authenticated school billing surface. Deliberately NOT behind the
// subscription gate so unpaid schools can still view and pay their invoice.
billingRoutes.use(authenticate, enforceTenant);

billingRoutes.get(
  '/billing/invoice',
  requirePermissions([PERMISSIONS.BILLING_READ]),
  asyncHandler((req, res) => controller.getMyInvoice(req, res))
);

billingRoutes.post(
  '/billing/invoice/pay',
  requirePermissions([PERMISSIONS.BILLING_PAY]),
  validateBody(paySubscriptionInvoiceSchema),
  asyncHandler((req, res) => controller.payMyInvoice(req, res))
);
