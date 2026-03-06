import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { SchoolsController } from './schools.controller';
import { schoolSetupSchema } from './schools.schemas';

const schoolsController = new SchoolsController();

export const schoolsRoutes = Router();

schoolsRoutes.get(
  '/setup-status',
  authenticate,
  enforceTenant,
  requirePermissions([PERMISSIONS.SCHOOL_SETUP_MANAGE]),
  asyncHandler((req, res) => schoolsController.getSetupStatus(req, res)),
);

schoolsRoutes.post(
  '/setup',
  authenticate,
  enforceTenant,
  requirePermissions([PERMISSIONS.SCHOOL_SETUP_MANAGE]),
  validateBody(schoolSetupSchema),
  asyncHandler((req, res) => schoolsController.completeSetup(req, res)),
);
