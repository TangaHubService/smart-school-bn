import { JwtUser } from '../../common/types/auth.types';
import { AppError } from '../../common/errors/app-error';
import { buildPagination } from '../../common/utils/pagination';
import { prisma } from '../../db/prisma';
import { SendMessageInput, ListMessagesQueryInput } from './chat.schemas';

export class ChatService {
  async getOrCreateChat(tenantId: string, classRoomId: string, actor: JwtUser) {
    const enrollment = await prisma.studentEnrollment.findFirst({
      where: { tenantId, classRoomId, student: { userId: actor.sub }, isActive: true },
      select: { id: true },
    });
    if (!enrollment && !actor.roles?.includes('SCHOOL_ADMIN') && !actor.roles?.includes('SUPER_ADMIN')) {
      throw new AppError(403, 'FORBIDDEN', 'You are not enrolled in this class');
    }

    const chat = await prisma.studentGroupChat.upsert({
      where: { tenantId_classRoomId: { tenantId, classRoomId } },
      create: {
        tenantId,
        classRoomId,
        title: `Class Chat`,
      },
      update: {},
      include: {
        classRoom: { select: { id: true, code: true, name: true } },
      },
    });

    return {
      id: chat.id,
      classRoom: chat.classRoom,
      title: chat.title,
      createdAt: chat.createdAt,
    };
  }

  async sendMessage(tenantId: string, chatId: string, input: SendMessageInput, actor: JwtUser) {
    const chat = await prisma.studentGroupChat.findFirst({ where: { id: chatId, tenantId } });
    if (!chat) throw new AppError(404, 'CHAT_NOT_FOUND', 'Chat not found');

    const message = await prisma.groupChatMessage.create({
      data: {
        chatId,
        senderId: actor.sub,
        content: input.content,
        fileUrl: input.fileUrl ?? null,
      },
      include: {
        sender: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    return {
      id: message.id,
      content: message.content,
      fileUrl: message.fileUrl,
      sender: message.sender,
      createdAt: message.createdAt,
    };
  }

  async listMessages(tenantId: string, chatId: string, query: ListMessagesQueryInput) {
    const chat = await prisma.studentGroupChat.findFirst({ where: { id: chatId, tenantId } });
    if (!chat) throw new AppError(404, 'CHAT_NOT_FOUND', 'Chat not found');

    const skip = (query.page - 1) * query.pageSize;
    const [totalItems, items] = await prisma.$transaction([
      prisma.groupChatMessage.count({ where: { chatId } }),
      prisma.groupChatMessage.findMany({
        where: { chatId },
        skip,
        take: query.pageSize,
        include: {
          sender: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      items: items.map(m => ({
        id: m.id,
        content: m.content,
        fileUrl: m.fileUrl,
        sender: m.sender,
        createdAt: m.createdAt,
      })),
      pagination: buildPagination(query.page, query.pageSize, totalItems),
    };
  }
}
