import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { ConductController } from './conduct.controller';
import {
  addConductActionSchema,
  createConductIncidentSchema,
  resolveConductIncidentSchema,
  updateConductIncidentSchema,
} from './conduct.schemas';

const conductController = new ConductController();

export const conductRoutes = Router();

conductRoutes.use(authenticate, enforceTenant);

conductRoutes.post(
  '/conduct/incidents',
  requirePermissions([PERMISSIONS.CONDUCT_MANAGE]),
  validateBody(createConductIncidentSchema),
  asyncHandler((req, res) => conductController.createIncident(req, res)),
);

conductRoutes.get(
  '/conduct/incidents',
  requirePermissions([PERMISSIONS.CONDUCT_READ]),
  asyncHandler((req, res) => conductController.listIncidents(req, res)),
);

conductRoutes.get(
  '/conduct/incidents/:id',
  requirePermissions([PERMISSIONS.CONDUCT_READ]),
  asyncHandler((req, res) => conductController.getIncidentDetail(req, res)),
);

conductRoutes.patch(
  '/conduct/incidents/:id',
  requirePermissions([PERMISSIONS.CONDUCT_MANAGE]),
  validateBody(updateConductIncidentSchema),
  asyncHandler((req, res) => conductController.updateIncident(req, res)),
);

conductRoutes.post(
  '/conduct/incidents/:id/actions',
  requirePermissions([PERMISSIONS.CONDUCT_MANAGE]),
  validateBody(addConductActionSchema),
  asyncHandler((req, res) => conductController.addAction(req, res)),
);

conductRoutes.post(
  '/conduct/incidents/:id/resolve',
  requirePermissions([PERMISSIONS.CONDUCT_RESOLVE]),
  validateBody(resolveConductIncidentSchema),
  asyncHandler((req, res) => conductController.resolveIncident(req, res)),
);

conductRoutes.get(
  '/conduct/me',
  requirePermissions([PERMISSIONS.CONDUCT_MY_READ]),
  asyncHandler((req, res) => conductController.getMyConductProfile(req, res)),
);

conductRoutes.get(
  '/conduct/students/:studentId/profile',
  requirePermissions([PERMISSIONS.CONDUCT_READ]),
  asyncHandler((req, res) => conductController.getStudentConductProfile(req, res)),
);
