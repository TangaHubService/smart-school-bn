import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import { AuthService } from './auth.service';
import { LoginInput, LogoutInput, RefreshInput } from './auth.schemas';

const authService = new AuthService();

function buildContext(req: Request) {
  return {
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  };
}

export class AuthController {
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
}
