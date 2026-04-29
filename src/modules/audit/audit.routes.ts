import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { AuditController } from './audit.controller';

const controller = new AuditController();

export const auditRoutes = Router();

auditRoutes.get(
  '/audit-logs',
  authenticate,
  requirePermissions([PERMISSIONS.TENANTS_READ]),
  asyncHandler((req, res) => controller.list(req, res)),
);

auditRoutes.get(
  '/activity-logs',
  authenticate,
  requirePermissions([PERMISSIONS.TENANTS_READ]),
  asyncHandler((req, res) => controller.listTenant(req, res)),
);
