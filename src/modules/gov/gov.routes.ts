import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { GovController } from './gov.controller';
import {
  createGovAuditSchema,
  addGovFeedbackSchema,
  assignGovAuditorScopeSchema,
  createGovAuditorSchema,
  submitGovAuditReportSchema,
  updateGovAuditorSchema,
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

govRoutes.get(
  '/gov/admin/auditors',
  requirePermissions([PERMISSIONS.GOV_AUDITORS_MANAGE]),
  asyncHandler((req, res) => govController.listAuditors(req, res)),
);

govRoutes.patch(
  '/gov/admin/auditors/:auditorUserId',
  requirePermissions([PERMISSIONS.GOV_AUDITORS_MANAGE]),
  validateBody(updateGovAuditorSchema),
  asyncHandler((req, res) => govController.updateAuditor(req, res)),
);

govRoutes.get(
  '/gov/admin/auditors/:auditorUserId/scopes',
  requirePermissions([PERMISSIONS.GOV_SCOPES_MANAGE]),
  asyncHandler((req, res) => govController.listAuditorScopes(req, res)),
);

govRoutes.post(
  '/gov/admin/auditors/:auditorUserId/scopes',
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

govRoutes.get(
  '/gov/dashboard',
  requirePermissions([PERMISSIONS.GOV_DASHBOARD_READ]),
  asyncHandler((req, res) => govController.getDashboard(req, res)),
);

govRoutes.post(
  '/gov/audits',
  requirePermissions([PERMISSIONS.GOV_FEEDBACK_MANAGE]),
  validateBody(createGovAuditSchema),
  asyncHandler((req, res) => govController.createAudit(req, res)),
);

govRoutes.get(
  '/gov/audits',
  requirePermissions([PERMISSIONS.GOV_SCHOOLS_READ]),
  asyncHandler((req, res) => govController.listAudits(req, res)),
);

govRoutes.get(
  '/gov/audits/:auditId',
  requirePermissions([PERMISSIONS.GOV_SCHOOLS_READ]),
  asyncHandler((req, res) => govController.getAuditDetail(req, res)),
);

govRoutes.post(
  '/gov/reports',
  requirePermissions([PERMISSIONS.GOV_FEEDBACK_MANAGE]),
  validateBody(submitGovAuditReportSchema),
  asyncHandler((req, res) => govController.submitReport(req, res)),
);

govRoutes.get(
  '/gov/reports',
  requirePermissions([PERMISSIONS.GOV_DASHBOARD_READ]),
  asyncHandler((req, res) => govController.listReports(req, res)),
);

govRoutes.get(
  '/gov/activity-logs',
  requirePermissions([PERMISSIONS.GOV_DASHBOARD_READ]),
  asyncHandler((req, res) => govController.listActivityLogs(req, res)),
);

govRoutes.get(
  '/gov/schools',
  requirePermissions([PERMISSIONS.GOV_SCHOOLS_READ]),
  asyncHandler((req, res) => govController.listSchools(req, res)),
);

govRoutes.get(
  '/gov/me/scopes',
  requirePermissions([PERMISSIONS.GOV_DASHBOARD_READ]),
  asyncHandler((req, res) => govController.listMyScopes(req, res)),
);

govRoutes.get(
  '/gov/schools/:tenantId/courses',
  requirePermissions([PERMISSIONS.GOV_SCHOOLS_READ]),
  asyncHandler((req, res) => govController.listSchoolCourses(req, res)),
);

govRoutes.get(
  '/gov/schools/:tenantId/reports/conduct-summary',
  requirePermissions([PERMISSIONS.GOV_SCHOOLS_READ]),
  asyncHandler((req, res) => govController.getSchoolConductReportSummary(req, res)),
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
  '/gov/incidents/:incidentId',
  requirePermissions([PERMISSIONS.GOV_INCIDENTS_READ]),
  asyncHandler((req, res) => govController.getIncidentDetail(req, res)),
);

govRoutes.post(
  '/gov/incidents/:incidentId/feedback',
  requirePermissions([PERMISSIONS.GOV_FEEDBACK_MANAGE]),
  validateBody(addGovFeedbackSchema),
  asyncHandler((req, res) => govController.addFeedback(req, res)),
);
