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
  createGroupSchema,
  updateGroupSchema,
  directChatSchema,
  addMembersSchema,
  contactsQuerySchema,
} from './chat.schemas';

const service = new ChatService();

function chatRoom(chatId: string) {
  return `chat-${chatId}`;
}

function userRoom(userId: string) {
  return `user-${userId}`;
}

/** Tell each participant's chat list to refresh (new message, new chat, member change). */
async function notifyInbox(tenantId: string, chatId: string, extraUserIds: string[] = []) {
  const ids = new Set([...(await service.listParticipantUserIds(tenantId, chatId)), ...extraUserIds]);
  const io = getIO();
  for (const id of ids) io.to(userRoom(id)).emit('chat:inbox', { chatId });
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
    void notifyInbox(req.tenantId!, req.params.chatId);
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
    getIO().to(userRoom(req.user!.sub)).emit('chat:inbox', { chatId: req.params.chatId });
    return sendSuccess(req, res, result);
  }

  async getReadReceipts(req: Request, res: Response) {
    const result = await service.getReadReceipts(req.tenantId!, req.params.chatId, req.user!);
    return sendSuccess(req, res, result);
  }

  async listMyChats(req: Request, res: Response) {
    const result = await service.listMyChats(req.tenantId!, req.user!);
    return sendSuccess(req, res, result);
  }

  async listContacts(req: Request, res: Response) {
    const query = contactsQuerySchema.parse(req.query);
    const result = await service.listContacts(req.tenantId!, query, req.user!);
    return sendSuccess(req, res, result);
  }

  async getChat(req: Request, res: Response) {
    const result = await service.getChat(req.tenantId!, req.params.chatId, req.user!);
    return sendSuccess(req, res, result);
  }

  async createGroup(req: Request, res: Response) {
    const input = createGroupSchema.parse(req.body);
    const result = await service.createGroup(req.tenantId!, input, req.user!);
    void notifyInbox(req.tenantId!, result.id);
    return sendSuccess(req, res, result, 201);
  }

  async openDirectChat(req: Request, res: Response) {
    const input = directChatSchema.parse(req.body);
    const result = await service.getOrCreateDirectChat(req.tenantId!, input.userId, req.user!);
    if (result.created) void notifyInbox(req.tenantId!, result.id);
    return sendSuccess(req, res, result, result.created ? 201 : 200);
  }

  async updateGroup(req: Request, res: Response) {
    const input = updateGroupSchema.parse(req.body);
    const result = await service.updateGroup(req.tenantId!, req.params.chatId, input, req.user!);
    void notifyInbox(req.tenantId!, req.params.chatId);
    getIO().to(chatRoom(req.params.chatId)).emit('chat:updated', { chatId: req.params.chatId });
    return sendSuccess(req, res, result);
  }

  async addMembers(req: Request, res: Response) {
    const input = addMembersSchema.parse(req.body);
    const result = await service.addMembers(req.tenantId!, req.params.chatId, input.userIds, req.user!);
    void notifyInbox(req.tenantId!, req.params.chatId);
    getIO().to(chatRoom(req.params.chatId)).emit('chat:updated', { chatId: req.params.chatId });
    return sendSuccess(req, res, result);
  }

  async removeMember(req: Request, res: Response) {
    const result = await service.removeMember(req.tenantId!, req.params.chatId, req.params.userId, req.user!);
    // The removed person also needs their list refreshed (they are no longer a participant).
    void notifyInbox(req.tenantId!, req.params.chatId, [req.params.userId]);
    getIO().to(chatRoom(req.params.chatId)).emit('chat:updated', { chatId: req.params.chatId });
    return sendSuccess(req, res, result);
  }
}
