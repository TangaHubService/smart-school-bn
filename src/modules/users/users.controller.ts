import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import { listUsersQuerySchema, updateUserStatusSchema } from './users.schemas';
import { UsersService } from './users.service';

export class UsersController {
  private usersService = new UsersService();

  async getMe(req: Request, res: Response): Promise<Response> {
    try {
      const result = await this.usersService.getMe(req.user!);
      return sendSuccess(req, res, result);
    } catch (error) {
      console.error('Error in UsersController.getMe:', error);
      throw error;
    }
  }

  async listUsers(req: Request, res: Response): Promise<Response> {
    const query = listUsersQuerySchema.parse(req.query);
    const result = await this.usersService.listUsers(req.user!, query);
    return sendSuccess(req, res, result);
  }

  async getUser(req: Request, res: Response): Promise<Response> {
    const result = await this.usersService.getUserById(req.user!, req.params.id);
    return sendSuccess(req, res, result);
  }

  async updateUserStatus(req: Request, res: Response): Promise<Response> {
    const body = updateUserStatusSchema.parse(req.body);
    const result = await this.usersService.updateUserStatus(req.user!, req.params.id, body.status);
    return sendSuccess(req, res, result);
  }
}
