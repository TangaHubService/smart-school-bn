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
import { TimetableController } from './timetable.controller';
import { bulkUpsertTimetableSlotsSchema, createTimetableSlotSchema } from './timetable.schemas';

const controller = new TimetableController();

export const timetableRoutes = Router();

timetableRoutes.use(authenticate, enforceTenant);

timetableRoutes.get(
  '/timetable',
  requireAnyPermissions([PERMISSIONS.TIMETABLE_READ, PERMISSIONS.TIMETABLE_MANAGE]),
  asyncHandler((req, res) => controller.listSlots(req, res)),
);

timetableRoutes.post(
  '/timetable',
  requirePermissions([PERMISSIONS.TIMETABLE_MANAGE]),
  validateBody(createTimetableSlotSchema),
  asyncHandler((req, res) => controller.createSlot(req, res)),
);

timetableRoutes.patch(
  '/timetable/:id',
  requirePermissions([PERMISSIONS.TIMETABLE_MANAGE]),
  asyncHandler((req, res) => controller.updateSlot(req, res)),
);

timetableRoutes.delete(
  '/timetable/:id',
  requirePermissions([PERMISSIONS.TIMETABLE_MANAGE]),
  asyncHandler((req, res) => controller.deleteSlot(req, res)),
);

timetableRoutes.post(
  '/timetable/bulk',
  requirePermissions([PERMISSIONS.TIMETABLE_MANAGE]),
  validateBody(bulkUpsertTimetableSlotsSchema),
  asyncHandler((req, res) => controller.bulkUpsertSlots(req, res)),
);
