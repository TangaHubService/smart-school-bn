import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { acceptInviteSchema } from '../staff/staff.schemas';
import { AuthController } from './auth.controller';
import { forgotPasswordSchema, loginSchema, logoutSchema, refreshSchema, registerSchema, resetPasswordSchema, verifyOtpSchema } from './auth.schemas';

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
  '/accept-invite',
  validateBody(acceptInviteSchema),
  asyncHandler((req, res) => authController.acceptInvite(req, res)),
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

authRoutes.post(
  '/forgot-password',
  validateBody(forgotPasswordSchema),
  asyncHandler((req, res) => authController.forgotPassword(req, res)),
);

authRoutes.post(
  '/verify-otp',
  validateBody(verifyOtpSchema),
  asyncHandler((req, res) => authController.verifyOtp(req, res)),
);

authRoutes.post(
  '/reset-password',
  validateBody(resetPasswordSchema),
  asyncHandler((req, res) => authController.resetPassword(req, res)),
);
