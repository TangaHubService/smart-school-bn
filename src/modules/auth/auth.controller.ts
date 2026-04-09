import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import { StaffService } from '../staff/staff.service';
import { AuthService } from './auth.service';
import { ForgotPasswordInput, LoginInput, LogoutInput, RefreshInput, RegisterInput, ResetPasswordInput, VerifyOtpInput } from './auth.schemas';

const authService = new AuthService();
const staffService = new StaffService();

function buildContext(req: Request) {
  return {
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  };
}

export class AuthController {
  async acceptInvite(req: Request, res: Response): Promise<Response> {
    const result = await staffService.acceptInvite(req.body, buildContext(req));
    return sendSuccess(req, res, result);
  }

  async login(req: Request, res: Response): Promise<Response> {
    const result = await authService.login(req.body as LoginInput, buildContext(req));
    return sendSuccess(req, res, result);
  }

  async refresh(req: Request, res: Response): Promise<Response> {
    const result = await authService.refresh(
      req.body as RefreshInput,
      buildContext(req),
    );
    return sendSuccess(req, res, result);
  }

  async logout(req: Request, res: Response): Promise<Response> {
    const result = await authService.logout(
      req.body as LogoutInput,
      req.user!,
      buildContext(req),
    );
    return sendSuccess(req, res, result);
  }

  async register(req: Request, res: Response): Promise<Response> {
    const result = await authService.register(
      req.body as RegisterInput,
      buildContext(req),
    );
    return sendSuccess(req, res, result);
  }

  async forgotPassword(req: Request, res: Response): Promise<Response> {
    const result = await authService.forgotPassword(req.body as ForgotPasswordInput, buildContext(req));
    return sendSuccess(req, res, result);
  }

  async verifyOtp(req: Request, res: Response): Promise<Response> {
    const result = await authService.verifyOtp(req.body as VerifyOtpInput, buildContext(req));
    return sendSuccess(req, res, result);
  }

  async resetPassword(req: Request, res: Response): Promise<Response> {
    const result = await authService.resetPassword(req.body as ResetPasswordInput, buildContext(req));
    return sendSuccess(req, res, result);
  }
}
