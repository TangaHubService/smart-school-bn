import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import {
  requireAnyPermissions,
  requirePermissions,
} from '../../common/middleware/require-permissions.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { ConductController } from './conduct.controller';
import {
  addConductActionSchema,
  createConductIncidentSchema,
  lockConductMarkSchema,
  recalculateConductMarkSchema,
  resolveConductIncidentSchema,
  updateConductMarkSchema,
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
  '/conduct/students/:studentId/profile',
  requirePermissions([PERMISSIONS.CONDUCT_READ]),
  asyncHandler((req, res) => conductController.getStudentConductProfile(req, res)),
);

conductRoutes.get(
  '/students/:id/conduct',
  requirePermissions([PERMISSIONS.CONDUCT_READ]),
  asyncHandler((req, res) => conductController.getStudentConduct(req, res)),
);

conductRoutes.get(
  '/conduct/marks',
  requireAnyPermissions([PERMISSIONS.CONDUCT_MARKS_READ, PERMISSIONS.CONDUCT_READ]),
  asyncHandler((req, res) => conductController.listMarks(req, res)),
);

conductRoutes.put(
  '/conduct/marks/:studentId/:termId',
  requireAnyPermissions([PERMISSIONS.CONDUCT_MARKS_MANAGE, PERMISSIONS.CONDUCT_MANAGE]),
  validateBody(updateConductMarkSchema),
  asyncHandler((req, res) => conductController.upsertMark(req, res)),
);

conductRoutes.post(
  '/conduct/marks/:studentId/:termId/recalculate',
  requireAnyPermissions([PERMISSIONS.CONDUCT_MARKS_MANAGE, PERMISSIONS.CONDUCT_MANAGE]),
  validateBody(recalculateConductMarkSchema),
  asyncHandler((req, res) => conductController.recalculateMark(req, res)),
);

conductRoutes.post(
  '/conduct/marks/:studentId/:termId/lock',
  requireAnyPermissions([PERMISSIONS.CONDUCT_MARKS_LOCK, PERMISSIONS.RESULTS_LOCK]),
  validateBody(lockConductMarkSchema),
  asyncHandler((req, res) => conductController.lockMark(req, res)),
);
