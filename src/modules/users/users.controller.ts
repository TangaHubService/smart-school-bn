import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import { UsersService } from './users.service';

const usersService = new UsersService();

export class UsersController {
  async getMe(req: Request, res: Response): Promise<Response> {
    const result = await usersService.getMe(req.user!);
    return sendSuccess(req, res, result);
  }

  async listUsers(req: Request, res: Response): Promise<Response> {
    const result = await usersService.listUsers(req.user!);
    return sendSuccess(req, res, result);
  }
}
