import { Router } from 'express';

import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { UsersController } from './users.controller';

const usersController = new UsersController();

export const usersRoutes = Router();

usersRoutes.get(
  '/me',
  authenticate,
  enforceTenant,
  asyncHandler((req, res) => usersController.getMe(req, res)),
);

usersRoutes.get(
  '/users',
  authenticate,
  enforceTenant,
  requirePermissions([PERMISSIONS.USERS_READ]),
  asyncHandler((req, res) => usersController.listUsers(req, res)),
);
