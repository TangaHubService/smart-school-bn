import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { UsersController } from './users.controller';

const usersController = new UsersController();

export const usersRoutes = Router();

usersRoutes.get(
  '/me',
  authenticate,
  enforceTenant,
  asyncHandler((req, res) => usersController.getMe(req, res)),
);
