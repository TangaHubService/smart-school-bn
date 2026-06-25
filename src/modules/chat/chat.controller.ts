import { Request, Response } from 'express';
import { sendSuccess } from '../../common/utils/response';
import { ChatService } from './chat.service';
import { sendMessageSchema, listMessagesQuerySchema } from './chat.schemas';

const service = new ChatService();

export class ChatController {
  async getOrCreateChat(req: Request, res: Response) {
    const result = await service.getOrCreateChat(req.tenantId!, req.params.classRoomId, req.user!);
    return sendSuccess(req, res, result);
  }

  async sendMessage(req: Request, res: Response) {
    const input = sendMessageSchema.parse(req.body);
    const result = await service.sendMessage(req.tenantId!, req.params.chatId, input, req.user!);
    return sendSuccess(req, res, result, 201);
  }

  async listMessages(req: Request, res: Response) {
    const query = listMessagesQuerySchema.parse(req.query);
    const result = await service.listMessages(req.tenantId!, req.params.chatId, query);
    return sendSuccess(req, res, result);
  }
}
