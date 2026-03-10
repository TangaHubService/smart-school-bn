import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { AuthController } from './auth.controller';
import { loginSchema, logoutSchema, refreshSchema, registerSchema } from './auth.schemas';

const authController = new AuthController();

export const authRoutes = Router();

authRoutes.post(
  '/register',
  validateBody(registerSchema),
  asyncHandler((req, res) => authController.register(req, res)),
);

authRoutes.post(
  '/login',
  validateBody(loginSchema),
  asyncHandler((req, res) => authController.login(req, res)),
);
authRoutes.post(
  '/refresh',
  validateBody(refreshSchema),
  asyncHandler((req, res) => authController.refresh(req, res)),
);
authRoutes.post(
  '/logout',
  authenticate,
  enforceTenant,
  validateBody(logoutSchema),
  asyncHandler((req, res) => authController.logout(req, res)),
);
