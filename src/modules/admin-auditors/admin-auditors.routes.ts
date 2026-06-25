import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { AdminAuditorsController } from './admin-auditors.controller';

const controller = new AdminAuditorsController();

export const adminAuditorsRoutes = Router();

adminAuditorsRoutes.get(
  '/admin/auditors/locations',
  authenticate,
  requirePermissions([PERMISSIONS.GOV_AUDITORS_MANAGE]),
  asyncHandler((req, res) => controller.getLocations(req, res))
);

adminAuditorsRoutes.get(
  '/admin/auditors/users/search',
  authenticate,
  requirePermissions([PERMISSIONS.GOV_AUDITORS_MANAGE]),
  asyncHandler((req, res) => controller.searchUsers(req, res))
);

adminAuditorsRoutes.get(
  '/admin/auditors/scope',
  authenticate,
  requirePermissions([PERMISSIONS.GOV_DASHBOARD_READ]),
  asyncHandler((req, res) => controller.getMyScope(req, res))
);

adminAuditorsRoutes.get(
  '/admin/auditors/report',
  authenticate,
  requirePermissions([PERMISSIONS.GOV_DASHBOARD_READ]),
  asyncHandler((req, res) => controller.getAuditorReport(req, res))
);

adminAuditorsRoutes.get(
  '/admin/auditors',
  authenticate,
  requirePermissions([PERMISSIONS.GOV_AUDITORS_MANAGE]),
  asyncHandler((req, res) => controller.listAuditors(req, res))
);

adminAuditorsRoutes.get(
  '/admin/auditors/:auditorId',
  authenticate,
  requirePermissions([PERMISSIONS.GOV_AUDITORS_MANAGE]),
  asyncHandler((req, res) => controller.getAuditorById(req, res))
);

adminAuditorsRoutes.post(
  '/admin/auditors/:userId/assign',
  authenticate,
  requirePermissions([PERMISSIONS.GOV_AUDITORS_MANAGE]),
  asyncHandler((req, res) => controller.assignAuditorScope(req, res))
);

adminAuditorsRoutes.delete(
  '/admin/auditors/:auditorId/scope',
  authenticate,
  requirePermissions([PERMISSIONS.GOV_AUDITORS_MANAGE]),
  asyncHandler((req, res) => controller.removeAuditorScope(req, res))
);

adminAuditorsRoutes.post(
  '/admin/auditors/create',
  authenticate,
  requirePermissions([PERMISSIONS.GOV_AUDITORS_MANAGE]),
  asyncHandler((req, res) => controller.createAuditorUser(req, res))
);