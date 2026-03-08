import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import {
  requireAnyPermissions,
  requirePermissions,
} from '../../common/middleware/require-permissions.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { GovController } from './gov.controller';
import {
  addGovFeedbackSchema,
  assignGovAuditorScopeSchema,
  createGovAuditorSchema,
  updateGovAuditorScopeSchema,
} from './gov.schemas';

const govController = new GovController();

export const govRoutes = Router();

govRoutes.use(authenticate);

govRoutes.post(
  '/gov/admin/auditors',
  requirePermissions([PERMISSIONS.GOV_AUDITORS_MANAGE]),
  validateBody(createGovAuditorSchema),
  asyncHandler((req, res) => govController.createAuditor(req, res)),
);

govRoutes.post(
  '/gov/auditors',
  requirePermissions([PERMISSIONS.GOV_AUDITORS_MANAGE]),
  validateBody(createGovAuditorSchema),
  asyncHandler((req, res) => govController.createAuditor(req, res)),
);

govRoutes.get(
  '/gov/admin/auditors',
  requirePermissions([PERMISSIONS.GOV_AUDITORS_MANAGE]),
  asyncHandler((req, res) => govController.listAuditors(req, res)),
);

govRoutes.get(
  '/gov/auditors',
  requirePermissions([PERMISSIONS.GOV_AUDITORS_MANAGE]),
  asyncHandler((req, res) => govController.listAuditors(req, res)),
);

govRoutes.get(
  '/gov/admin/auditors/:auditorUserId/scopes',
  requirePermissions([PERMISSIONS.GOV_SCOPES_MANAGE]),
  asyncHandler((req, res) => govController.listAuditorScopes(req, res)),
);

govRoutes.get(
  '/gov/auditors/:auditorUserId/scopes',
  requirePermissions([PERMISSIONS.GOV_SCOPES_MANAGE]),
  asyncHandler((req, res) => govController.listAuditorScopes(req, res)),
);


govRoutes.post(
  '/gov/admin/auditors/:auditorUserId/scopes',
  requirePermissions([PERMISSIONS.GOV_SCOPES_MANAGE]),
  validateBody(assignGovAuditorScopeSchema),
  asyncHandler((req, res) => govController.assignScope(req, res)),
);

govRoutes.post(
  '/gov/auditors/:auditorUserId/scopes',
  requirePermissions([PERMISSIONS.GOV_SCOPES_MANAGE]),
  validateBody(assignGovAuditorScopeSchema),
  asyncHandler((req, res) => govController.assignScope(req, res)),
);


govRoutes.patch(
  '/gov/admin/scopes/:scopeId',
  requirePermissions([PERMISSIONS.GOV_SCOPES_MANAGE]),
  validateBody(updateGovAuditorScopeSchema),
  asyncHandler((req, res) => govController.updateScope(req, res)),
);

govRoutes.patch(
  '/gov/scopes/:scopeId',
  requirePermissions([PERMISSIONS.GOV_SCOPES_MANAGE]),
  validateBody(updateGovAuditorScopeSchema),
  asyncHandler((req, res) => govController.updateScope(req, res)),
);

govRoutes.get(
  '/gov/dashboard',
  requirePermissions([PERMISSIONS.GOV_DASHBOARD_READ]),
  asyncHandler((req, res) => govController.getDashboard(req, res)),
);

govRoutes.get(
  '/gov/schools',
  requirePermissions([PERMISSIONS.GOV_SCHOOLS_READ]),
  asyncHandler((req, res) => govController.listSchools(req, res)),
);

govRoutes.get(
  '/gov/schools/:tenantId',
  requirePermissions([PERMISSIONS.GOV_SCHOOLS_READ]),
  asyncHandler((req, res) => govController.getSchoolDetail(req, res)),
);

govRoutes.get(
  '/gov/incidents',
  requirePermissions([PERMISSIONS.GOV_INCIDENTS_READ]),
  asyncHandler((req, res) => govController.listIncidents(req, res)),
);

govRoutes.get(
  '/gov/conduct/incidents',
  requirePermissions([PERMISSIONS.GOV_INCIDENTS_READ]),
  asyncHandler((req, res) => govController.listIncidents(req, res)),
);

govRoutes.get(
  '/gov/incidents/:incidentId',
  requirePermissions([PERMISSIONS.GOV_INCIDENTS_READ]),
  asyncHandler((req, res) => govController.getIncidentDetail(req, res)),
);

govRoutes.get(
  '/gov/conduct/incidents/:incidentId',
  requirePermissions([PERMISSIONS.GOV_INCIDENTS_READ]),
  asyncHandler((req, res) => govController.getIncidentDetail(req, res)),
);

govRoutes.post(
  '/gov/incidents/:incidentId/feedback',
  requirePermissions([PERMISSIONS.GOV_FEEDBACK_MANAGE]),
  validateBody(addGovFeedbackSchema),
  asyncHandler((req, res) => govController.addFeedback(req, res)),
);

govRoutes.post(
  '/gov/conduct/incidents/:incidentId/feedback',
  requirePermissions([PERMISSIONS.GOV_FEEDBACK_MANAGE]),
  validateBody(addGovFeedbackSchema),
  asyncHandler((req, res) => govController.addFeedback(req, res)),
);

govRoutes.get(
  '/gov/conduct/marks',
  requireAnyPermissions([PERMISSIONS.GOV_MARKS_READ, PERMISSIONS.GOV_INCIDENTS_READ]),
  asyncHandler((req, res) => govController.listMarks(req, res)),
);

govRoutes.post(
  '/gov/conduct/marks/:markId/feedback',
  requirePermissions([PERMISSIONS.GOV_FEEDBACK_MANAGE]),
  validateBody(addGovFeedbackSchema),
  asyncHandler((req, res) => govController.addMarkFeedback(req, res)),
);
