import { Request, Response } from 'express';

import { getIO } from '../../common/utils/socket-server';
import { sendSuccess } from '../../common/utils/response';
import { resolveAcademicYearId } from '../../common/utils/academic-year-scope';
import { ChatService } from './chat.service';
import {
  sendMessageSchema,
  listMessagesQuerySchema,
  reactionSchema,
  getOrCreateChatQuerySchema,
} from './chat.schemas';

const service = new ChatService();

function chatRoom(chatId: string) {
  return `chat-${chatId}`;
}

export class ChatController {
  async getOrCreateChat(req: Request, res: Response) {
    const query = getOrCreateChatQuerySchema.parse(req.query);
    const academicYearId = await resolveAcademicYearId(req, query.academicYearId);
    const result = await service.getOrCreateChat(req.tenantId!, req.params.classRoomId, req.user!, academicYearId);
    return sendSuccess(req, res, result);
  }

  async sendMessage(req: Request, res: Response) {
    const input = sendMessageSchema.parse(req.body);
    const result = await service.sendMessage(req.tenantId!, req.params.chatId, input, req.user!);
    getIO().to(chatRoom(req.params.chatId)).emit('chat:newMessage', result);
    return sendSuccess(req, res, result, 201);
  }

  async listMessages(req: Request, res: Response) {
    const query = listMessagesQuerySchema.parse(req.query);
    const result = await service.listMessages(req.tenantId!, req.params.chatId, query, req.user!);
    return sendSuccess(req, res, result);
  }

  async listPinnedMessages(req: Request, res: Response) {
    const result = await service.listPinnedMessages(req.tenantId!, req.params.chatId, req.user!);
    return sendSuccess(req, res, result);
  }

  async react(req: Request, res: Response) {
    const input = reactionSchema.parse(req.body);
    const result = await service.react(req.tenantId!, req.params.chatId, req.params.messageId, input, req.user!);
    getIO().to(chatRoom(req.params.chatId)).emit('chat:messageUpdated', result);
    return sendSuccess(req, res, result);
  }

  async removeReaction(req: Request, res: Response) {
    const emoji = String(req.query.emoji ?? '');
    const result = await service.removeReaction(req.tenantId!, req.params.chatId, req.params.messageId, emoji, req.user!);
    getIO().to(chatRoom(req.params.chatId)).emit('chat:messageUpdated', result);
    return sendSuccess(req, res, result);
  }

  async pinMessage(req: Request, res: Response) {
    const result = await service.pinMessage(req.tenantId!, req.params.chatId, req.params.messageId, req.user!, true);
    getIO().to(chatRoom(req.params.chatId)).emit('chat:messageUpdated', result);
    return sendSuccess(req, res, result);
  }

  async unpinMessage(req: Request, res: Response) {
    const result = await service.pinMessage(req.tenantId!, req.params.chatId, req.params.messageId, req.user!, false);
    getIO().to(chatRoom(req.params.chatId)).emit('chat:messageUpdated', result);
    return sendSuccess(req, res, result);
  }

  async deleteMessage(req: Request, res: Response) {
    const result = await service.deleteMessage(req.tenantId!, req.params.chatId, req.params.messageId, req.user!);
    getIO().to(chatRoom(req.params.chatId)).emit('chat:messageUpdated', result);
    return sendSuccess(req, res, result);
  }

  async markRead(req: Request, res: Response) {
    const result = await service.markRead(req.tenantId!, req.params.chatId, req.user!);
    getIO().to(chatRoom(req.params.chatId)).emit('chat:read', { userId: req.user!.sub, chatId: req.params.chatId });
    return sendSuccess(req, res, result);
  }

  async getReadReceipts(req: Request, res: Response) {
    const result = await service.getReadReceipts(req.tenantId!, req.params.chatId, req.user!);
    return sendSuccess(req, res, result);
  }
}
