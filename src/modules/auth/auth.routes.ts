import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import {
  codeAttemptLimiter,
  loginAttemptLimiter,
  loginNetworkLimiter,
  publicFormLimiter,
} from '../../common/middleware/rate-limit.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { acceptInviteSchema } from '../staff/staff.schemas';
import { AuthController } from './auth.controller';
import {
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  selectSchoolSchema,
  verifyOtpSchema,
  verifyTwoFactorSchema,
  resendTwoFactorOtpSchema,
  completePasswordChangeSchema,
} from './auth.schemas';

const authController = new AuthController();

export const authRoutes = Router();

authRoutes.post(
  '/register',
  publicFormLimiter,
  validateBody(registerSchema),
  asyncHandler((req, res) => authController.register(req, res))
);

authRoutes.post(
  '/login',
  loginNetworkLimiter,
  loginAttemptLimiter,
  validateBody(loginSchema),
  asyncHandler((req, res) => authController.login(req, res))
);

authRoutes.post(
  '/accept-invite',
  codeAttemptLimiter,
  validateBody(acceptInviteSchema),
  asyncHandler((req, res) => authController.acceptInvite(req, res))
);

authRoutes.post(
  '/refresh',
  validateBody(refreshSchema),
  asyncHandler((req, res) => authController.refresh(req, res))
);
authRoutes.post(
  '/logout',
  authenticate,
  enforceTenant,
  validateBody(logoutSchema),
  asyncHandler((req, res) => authController.logout(req, res))
);

authRoutes.post(
  '/forgot-password',
  codeAttemptLimiter,
  validateBody(forgotPasswordSchema),
  asyncHandler((req, res) => authController.forgotPassword(req, res))
);

authRoutes.post(
  '/verify-otp',
  codeAttemptLimiter,
  validateBody(verifyOtpSchema),
  asyncHandler((req, res) => authController.verifyOtp(req, res))
);

authRoutes.post(
  '/reset-password',
  codeAttemptLimiter,
  validateBody(resetPasswordSchema),
  asyncHandler((req, res) => authController.resetPassword(req, res))
);

authRoutes.post(
  '/verify-two-factor',
  codeAttemptLimiter,
  validateBody(verifyTwoFactorSchema),
  asyncHandler((req, res) => authController.verifyTwoFactor(req, res))
);

authRoutes.post(
  '/resend-two-factor-otp',
  codeAttemptLimiter,
  validateBody(resendTwoFactorOtpSchema),
  asyncHandler((req, res) => authController.resendTwoFactorOtp(req, res))
);

authRoutes.post(
  '/complete-password-change',
  codeAttemptLimiter,
  validateBody(completePasswordChangeSchema),
  asyncHandler((req, res) => authController.completePasswordChange(req, res))
);

authRoutes.post(
  '/select-school',
  loginNetworkLimiter,
  loginAttemptLimiter,
  validateBody(selectSchoolSchema),
  asyncHandler((req, res) => authController.selectSchool(req, res))
);
