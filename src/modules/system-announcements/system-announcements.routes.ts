import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { SystemAnnouncementsController } from './system-announcements.controller';
import {
  createSystemAnnouncementSchema,
  updateSystemAnnouncementSchema,
} from './system-announcements.schemas';

const controller = new SystemAnnouncementsController();

export const systemAnnouncementsRoutes = Router();

systemAnnouncementsRoutes.use(authenticate);

systemAnnouncementsRoutes.get(
  '/system-announcements',
  requirePermissions([PERMISSIONS.TENANTS_READ]),
  asyncHandler((req, res) => controller.list(req, res)),
);

systemAnnouncementsRoutes.post(
  '/system-announcements',
  requirePermissions([PERMISSIONS.TENANTS_MANAGE]),
  validateBody(createSystemAnnouncementSchema),
  asyncHandler((req, res) => controller.create(req, res)),
);

systemAnnouncementsRoutes.patch(
  '/system-announcements/:id',
  requirePermissions([PERMISSIONS.TENANTS_MANAGE]),
  validateBody(updateSystemAnnouncementSchema),
  asyncHandler((req, res) => controller.update(req, res)),
);
