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
import { AnnouncementsController } from './announcements.controller';
import { createAnnouncementSchema, updateAnnouncementSchema } from './announcements.schemas';

const controller = new AnnouncementsController();

export const announcementsRoutes = Router();

announcementsRoutes.use(authenticate);

announcementsRoutes.get(
  '/announcements/me',
  requireAnyPermissions([
    PERMISSIONS.ANNOUNCEMENTS_READ,
    PERMISSIONS.ANNOUNCEMENTS_MANAGE,
    PERMISSIONS.ANNOUNCEMENTS_MY_READ,
  ]),
  enforceTenant,
  asyncHandler((req, res) => controller.listForStudent(req, res)),
);

announcementsRoutes.get(
  '/announcements',
  requireAnyPermissions([PERMISSIONS.ANNOUNCEMENTS_READ, PERMISSIONS.ANNOUNCEMENTS_MANAGE]),
  enforceTenant,
  asyncHandler((req, res) => controller.list(req, res)),
);

announcementsRoutes.get(
  '/announcements/:id',
  requireAnyPermissions([PERMISSIONS.ANNOUNCEMENTS_READ, PERMISSIONS.ANNOUNCEMENTS_MANAGE]),
  enforceTenant,
  asyncHandler((req, res) => controller.getById(req, res)),
);

announcementsRoutes.post(
  '/announcements',
  requirePermissions([PERMISSIONS.ANNOUNCEMENTS_MANAGE]),
  enforceTenant,
  validateBody(createAnnouncementSchema),
  asyncHandler((req, res) => controller.create(req, res)),
);

announcementsRoutes.patch(
  '/announcements/:id',
  requirePermissions([PERMISSIONS.ANNOUNCEMENTS_MANAGE]),
  enforceTenant,
  validateBody(updateAnnouncementSchema),
  asyncHandler((req, res) => controller.update(req, res)),
);

announcementsRoutes.delete(
  '/announcements/:id',
  requirePermissions([PERMISSIONS.ANNOUNCEMENTS_MANAGE]),
  enforceTenant,
  asyncHandler((req, res) => controller.delete(req, res)),
);
