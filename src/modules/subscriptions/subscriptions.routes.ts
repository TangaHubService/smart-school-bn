import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { SubscriptionsController } from './subscriptions.controller';
import { grantAcademyAccessSchema, updateSchoolSubscriptionSchema } from './subscriptions.schemas';

const controller = new SubscriptionsController();

export const subscriptionsRoutes = Router();

subscriptionsRoutes.use(authenticate);

subscriptionsRoutes.get(
  '/subscription-plans',
  requirePermissions([PERMISSIONS.TENANTS_READ]),
  asyncHandler((req, res) => controller.listPlans(req, res)),
);

subscriptionsRoutes.get(
  '/subscriptions/schools',
  requirePermissions([PERMISSIONS.TENANTS_READ]),
  asyncHandler((req, res) => controller.listSchoolSubscriptions(req, res)),
);

subscriptionsRoutes.patch(
  '/subscriptions/schools/:tenantId',
  requirePermissions([PERMISSIONS.TENANTS_MANAGE]),
  validateBody(updateSchoolSubscriptionSchema),
  asyncHandler((req, res) => controller.updateSchoolSubscription(req, res)),
);

subscriptionsRoutes.get(
  '/subscriptions/academy/enrollments',
  requirePermissions([PERMISSIONS.TENANTS_READ]),
  asyncHandler((req, res) => controller.listAcademyEnrollments(req, res)),
);

subscriptionsRoutes.get(
  '/subscriptions/academy/catalog-programs',
  requirePermissions([PERMISSIONS.TENANTS_READ]),
  asyncHandler((req, res) => controller.listAcademyCatalogPrograms(req, res)),
);

subscriptionsRoutes.post(
  '/subscriptions/academy/grant-access',
  requirePermissions([PERMISSIONS.TENANTS_MANAGE]),
  validateBody(grantAcademyAccessSchema),
  asyncHandler((req, res) => controller.grantAcademyAccess(req, res)),
);
