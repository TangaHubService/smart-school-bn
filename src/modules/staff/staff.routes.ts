import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { StaffController } from './staff.controller';
import { acceptInviteSchema, inviteStaffSchema } from './staff.schemas';

const staffController = new StaffController();

export const staffRoutes = Router();

staffRoutes.post(
  '/accept-invite',
  validateBody(acceptInviteSchema),
  asyncHandler((req, res) => staffController.acceptInvite(req, res)),
);

staffRoutes.post(
  '/invite',
  authenticate,
  enforceTenant,
  requirePermissions([PERMISSIONS.STAFF_INVITE]),
  validateBody(inviteStaffSchema),
  asyncHandler((req, res) => staffController.invite(req, res)),
);

staffRoutes.get(
  '/invites',
  authenticate,
  enforceTenant,
  requirePermissions([PERMISSIONS.STAFF_INVITE]),
  asyncHandler((req, res) => staffController.listInvites(req, res)),
);

staffRoutes.delete(
  '/invites/:id',
  authenticate,
  enforceTenant,
  requirePermissions([PERMISSIONS.STAFF_INVITE]),
  asyncHandler((req, res) => staffController.revokeInvite(req, res)),
);
