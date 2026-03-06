import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { TenantsController } from './tenants.controller';
import { createTenantSchema } from './tenants.schemas';

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
