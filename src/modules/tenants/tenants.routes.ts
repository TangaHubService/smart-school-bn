import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { TenantsController } from './tenants.controller';
import {
  assignSchoolAdminSchema,
  createTenantSchema,
  inviteTenantAdminSchema,
  updateTenantStatusSchema,
  updateTenantSchema,
} from './tenants.schemas';

const tenantsController = new TenantsController();

export const tenantsRoutes = Router();

tenantsRoutes.get(
  '/',
  authenticate,
  requirePermissions([PERMISSIONS.TENANTS_READ]),
  asyncHandler((req, res) => tenantsController.listTenants(req, res)),
);

tenantsRoutes.post(
  '/',
  authenticate,
  requirePermissions([PERMISSIONS.TENANTS_CREATE]),
  validateBody(createTenantSchema),
  asyncHandler((req, res) => tenantsController.createTenant(req, res)),
);

tenantsRoutes.get(
  '/:id',
  authenticate,
  requirePermissions([PERMISSIONS.TENANTS_READ]),
  asyncHandler((req, res) => tenantsController.getTenant(req, res)),
);

tenantsRoutes.post(
  '/:id/admin-invite',
  authenticate,
  requirePermissions([PERMISSIONS.TENANTS_CREATE]),
  validateBody(inviteTenantAdminSchema),
  asyncHandler((req, res) => tenantsController.inviteSchoolAdmin(req, res)),
);

tenantsRoutes.post(
  '/:id/school-admins',
  authenticate,
  requirePermissions([PERMISSIONS.TENANTS_MANAGE]),
  validateBody(assignSchoolAdminSchema),
  asyncHandler((req, res) => tenantsController.assignSchoolAdmin(req, res)),
);

tenantsRoutes.patch(
  '/:id',
  authenticate,
  requirePermissions([PERMISSIONS.TENANTS_MANAGE]),
  validateBody(updateTenantSchema),
  asyncHandler((req, res) => tenantsController.updateTenant(req, res)),
);

tenantsRoutes.patch(
  '/:id/status',
  authenticate,
  requirePermissions([PERMISSIONS.TENANTS_MANAGE]),
  validateBody(updateTenantStatusSchema),
  asyncHandler((req, res) => tenantsController.updateTenantStatus(req, res)),
);

tenantsRoutes.delete(
  '/:id',
  authenticate,
  requirePermissions([PERMISSIONS.TENANTS_MANAGE]),
  asyncHandler((req, res) => tenantsController.deactivateTenant(req, res)),
);
