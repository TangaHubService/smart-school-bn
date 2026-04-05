import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { requireAnyPermissions, requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { ConductMarksController } from './conduct-marks.controller';
import { createDeductionBodySchema, termSettingBodySchema } from './conduct-marks.schemas';

const controller = new ConductMarksController();

export const conductMarksRoutes = Router();

conductMarksRoutes.use(authenticate, enforceTenant);

conductMarksRoutes.get(
  '/conduct-marks/term-settings',
  requireAnyPermissions([PERMISSIONS.TERM_MANAGE, PERMISSIONS.ACADEMIC_YEAR_MANAGE]),
  asyncHandler((req, res) => controller.listTermSettings(req, res)),
);

conductMarksRoutes.put(
  '/conduct-marks/term-settings/:termId',
  requireAnyPermissions([PERMISSIONS.TERM_MANAGE, PERMISSIONS.ACADEMIC_YEAR_MANAGE]),
  validateBody(termSettingBodySchema),
  asyncHandler((req, res) => controller.upsertTermSetting(req, res)),
);

conductMarksRoutes.post(
  '/conduct-marks/deductions',
  requirePermissions([PERMISSIONS.CONDUCT_MANAGE]),
  validateBody(createDeductionBodySchema),
  asyncHandler((req, res) => controller.createDeduction(req, res)),
);

conductMarksRoutes.get(
  '/conduct-marks/students/:studentId/deductions',
  requireAnyPermissions([PERMISSIONS.CONDUCT_READ, PERMISSIONS.CONDUCT_MANAGE]),
  asyncHandler((req, res) => controller.listStudentDeductions(req, res)),
);

conductMarksRoutes.get(
  '/conduct-marks/students/:studentId/summary',
  requireAnyPermissions([PERMISSIONS.CONDUCT_READ, PERMISSIONS.CONDUCT_MANAGE, PERMISSIONS.STUDENTS_READ]),
  asyncHandler((req, res) => controller.getStudentConductSummary(req, res)),
);
