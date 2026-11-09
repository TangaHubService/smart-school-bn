import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { webhookLimiter } from '../../common/middleware/rate-limit.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { BillingController } from './billing.controller';
import {
  createManualInvoiceSchema,
  paySubscriptionInvoiceSchema,
  recordManualPaymentSchema,
} from './billing.schemas';

const controller = new BillingController();

/** Public provider callback (signature-verified in the controller). Mounted in the public section. */
export const billingWebhookRoutes = Router();

billingWebhookRoutes.post(
  '/webhooks/paypack',
  webhookLimiter,
  asyncHandler((req, res) => controller.handlePaypackWebhook(req, res))
);

export const billingRoutes = Router();

// Authenticated school billing surface. Deliberately NOT behind the
// subscription gate so unpaid schools can still view and pay their invoice.
billingRoutes.use(authenticate, enforceTenant);

// Any signed-in school user, so everyone at a locked school sees why.
billingRoutes.get(
  '/billing/access',
  asyncHandler((req, res) => controller.getAccessStatus(req, res))
);

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

// Manual billing for schools not on online payment (Super Admin only, Rev #16–19).
billingRoutes.get(
  '/billing/invoices',
  requirePermissions([PERMISSIONS.TENANTS_MANAGE]),
  asyncHandler((req, res) => controller.listInvoices(req, res))
);

billingRoutes.post(
  '/billing/invoices/manual',
  requirePermissions([PERMISSIONS.TENANTS_MANAGE]),
  validateBody(createManualInvoiceSchema),
  asyncHandler((req, res) => controller.createManualInvoice(req, res))
);

billingRoutes.post(
  '/billing/invoices/:id/payments/manual',
  requirePermissions([PERMISSIONS.TENANTS_MANAGE]),
  validateBody(recordManualPaymentSchema),
  asyncHandler((req, res) => controller.recordManualPayment(req, res))
);

billingRoutes.post(
  '/billing/invoices/:id/cancel',
  requirePermissions([PERMISSIONS.TENANTS_MANAGE]),
  asyncHandler((req, res) => controller.cancelInvoice(req, res))
);
