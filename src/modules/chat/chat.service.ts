import { JwtUser } from '../../common/types/auth.types';
import { AppError } from '../../common/errors/app-error';
import { buildPagination } from '../../common/utils/pagination';
import { isProtectedPdfAsset } from '../../common/utils/protected-attachment';
import { upsertFileAsset } from '../../common/services/file-asset-upsert.service';
import { prisma } from '../../db/prisma';
import { SendMessageInput, ListMessagesQueryInput, ReactionInput } from './chat.schemas';

const messageInclude = {
  sender: { select: { id: true, firstName: true, lastName: true } },
  fileAsset: true,
  reactions: { select: { userId: true, emoji: true } },
  replyTo: {
    select: {
      id: true,
      content: true,
      deletedAt: true,
      sender: { select: { id: true, firstName: true, lastName: true } },
    },
  },
} as const;

export class ChatService {
  async getOrCreateChat(
    tenantId: string,
    classRoomId: string,
    actor: JwtUser,
    fallbackAcademicYearId?: string
  ) {
    const roles = actor.roles ?? [];
    const isStudent = roles.includes('STUDENT');
    const isStaff = roles.includes('TEACHER') || roles.includes('SCHOOL_ADMIN') || roles.includes('SUPER_ADMIN');

    let academicYearId: string | undefined;

    if (isStudent) {
      const enrollment = await prisma.studentEnrollment.findFirst({
        where: { tenantId, classRoomId, student: { userId: actor.sub }, isActive: true },
        select: { academicYearId: true },
      });
      if (!enrollment) {
        throw new AppError(403, 'FORBIDDEN', 'You are not enrolled in this class');
      }
      academicYearId = enrollment.academicYearId;
    } else if (isStaff) {
      academicYearId = fallbackAcademicYearId;
      if (!academicYearId) {
        const currentYear = await prisma.academicYear.findFirst({
          where: { tenantId, isCurrent: true, isActive: true },
          select: { id: true },
        });
        academicYearId = currentYear?.id;
      }
      if (!academicYearId) {
        throw new AppError(404, 'ACADEMIC_YEAR_NOT_FOUND', 'No academic year is set as current');
      }

      if (roles.includes('TEACHER') && !roles.includes('SCHOOL_ADMIN') && !roles.includes('SUPER_ADMIN')) {
        const teaches = await prisma.course.findFirst({
          where: { tenantId, classRoomId, academicYearId, teacherUserId: actor.sub, isActive: true },
          select: { id: true },
        });
        if (!teaches) {
          throw new AppError(403, 'FORBIDDEN', 'You do not teach this class');
        }
      }
    } else {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to class chats');
    }

    const chat = await prisma.studentGroupChat.upsert({
      where: { tenantId_classRoomId_academicYearId: { tenantId, classRoomId, academicYearId } },
      create: {
        tenantId,
        classRoomId,
        academicYearId,
        title: 'Class Chat',
      },
      update: {},
      include: {
        classRoom: { select: { id: true, code: true, name: true } },
        academicYear: { select: { id: true, name: true } },
      },
    });

    const roster = await this.listRoster(tenantId, classRoomId, academicYearId);

    return {
      id: chat.id,
      classRoom: chat.classRoom,
      academicYear: chat.academicYear,
      title: chat.title,
      createdAt: chat.createdAt,
      roster,
      permissions: {
        canSend: isStudent || roles.includes('TEACHER'),
        canModerate: roles.includes('TEACHER') || roles.includes('SCHOOL_ADMIN') || roles.includes('SUPER_ADMIN'),
        canPin: roles.includes('TEACHER'),
      },
    };
  }

  async listRoster(tenantId: string, classRoomId: string, academicYearId: string) {
    const [students, courses] = await Promise.all([
      prisma.student.findMany({
        where: {
          tenantId,
          isActive: true,
          userId: { not: null },
          enrollments: { some: { isActive: true, classRoomId, academicYearId } },
        },
        select: { userId: true, firstName: true, lastName: true },
      }),
      prisma.course.findMany({
        where: { tenantId, classRoomId, academicYearId, isActive: true },
        select: { teacherUser: { select: { id: true, firstName: true, lastName: true } } },
        distinct: ['teacherUserId'],
      }),
    ]);

    const roster = new Map<string, { id: string; firstName: string; lastName: string; role: 'STUDENT' | 'TEACHER' }>();
    for (const s of students) {
      if (s.userId) roster.set(s.userId, { id: s.userId, firstName: s.firstName, lastName: s.lastName, role: 'STUDENT' });
    }
    for (const c of courses) {
      roster.set(c.teacherUser.id, { ...c.teacherUser, role: 'TEACHER' });
    }
    return [...roster.values()];
  }

  /**
   * Every action past the initial getOrCreateChat call is looked up by chatId alone, so
   * without this check any user holding the route-level CHAT_SEND/CHAT_READ permission
   * could act on a class chat they don't belong to just by knowing (or guessing) its id.
   */
  private async assertParticipant(
    chat: { tenantId: string; classRoomId: string; academicYearId: string },
    actor: JwtUser
  ) {
    const roles = actor.roles ?? [];
    if (roles.includes('SCHOOL_ADMIN') || roles.includes('SUPER_ADMIN')) {
      return;
    }

    if (roles.includes('STUDENT')) {
      const enrollment = await prisma.studentEnrollment.findFirst({
        where: {
          tenantId: chat.tenantId,
          classRoomId: chat.classRoomId,
          academicYearId: chat.academicYearId,
          student: { userId: actor.sub },
          isActive: true,
        },
        select: { id: true },
      });
      if (!enrollment) throw new AppError(403, 'FORBIDDEN', 'You are not a participant in this chat');
      return;
    }

    if (roles.includes('TEACHER')) {
      const teaches = await prisma.course.findFirst({
        where: {
          tenantId: chat.tenantId,
          classRoomId: chat.classRoomId,
          academicYearId: chat.academicYearId,
          teacherUserId: actor.sub,
          isActive: true,
        },
        select: { id: true },
      });
      if (!teaches) throw new AppError(403, 'FORBIDDEN', 'You are not a participant in this chat');
      return;
    }

    throw new AppError(403, 'FORBIDDEN', 'You do not have access to class chats');
  }

  private async loadChatOrThrow(tenantId: string, chatId: string, actor: JwtUser) {
    const chat = await prisma.studentGroupChat.findFirst({ where: { id: chatId, tenantId } });
    if (!chat) throw new AppError(404, 'CHAT_NOT_FOUND', 'Chat not found');
    await this.assertParticipant(chat, actor);
    return chat;
  }

  async sendMessage(tenantId: string, chatId: string, input: SendMessageInput, actor: JwtUser) {
    await this.loadChatOrThrow(tenantId, chatId, actor);

    if (input.replyToId) {
      const replyTarget = await prisma.groupChatMessage.findFirst({
        where: { id: input.replyToId, chatId },
        select: { id: true },
      });
      if (!replyTarget) {
        throw new AppError(404, 'REPLY_TARGET_NOT_FOUND', 'The message you are replying to was not found');
      }
    }

    let fileAssetId: string | undefined;
    if (input.attachment) {
      const asset = await upsertFileAsset(tenantId, input.attachment, actor.sub);
      fileAssetId = asset.id;
    }

    const isTeacher = actor.roles?.includes('TEACHER') ?? false;

    const message = await prisma.groupChatMessage.create({
      data: {
        chatId,
        tenantId,
        senderId: actor.sub,
        content: input.content,
        fileAssetId,
        replyToId: input.replyToId,
        mentionedUserIds: input.mentionedUserIds,
        isAnnouncement: isTeacher && input.isAnnouncement,
      },
      include: messageInclude,
    });

    await prisma.studentGroupChatRead.upsert({
      where: { chatId_userId: { chatId, userId: actor.sub } },
      update: { lastReadAt: new Date() },
      create: { tenantId, chatId, userId: actor.sub },
    });

    return this.mapMessage(message, actor.sub);
  }

  async listMessages(tenantId: string, chatId: string, query: ListMessagesQueryInput, actor: JwtUser) {
    await this.loadChatOrThrow(tenantId, chatId, actor);

    const where: Record<string, unknown> = { chatId };
    if (query.q) {
      where.content = { contains: query.q, mode: 'insensitive' };
      where.deletedAt = null;
    }

    const skip = (query.page - 1) * query.pageSize;
    const [totalItems, items] = await prisma.$transaction([
      prisma.groupChatMessage.count({ where: where as never }),
      prisma.groupChatMessage.findMany({
        where: where as never,
        skip,
        take: query.pageSize,
        include: messageInclude,
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      items: items.map(m => this.mapMessage(m, actor.sub)),
      pagination: buildPagination(query.page, query.pageSize, totalItems),
    };
  }

  async listPinnedMessages(tenantId: string, chatId: string, actor: JwtUser) {
    await this.loadChatOrThrow(tenantId, chatId, actor);
    const items = await prisma.groupChatMessage.findMany({
      where: { chatId, isPinned: true, deletedAt: null },
      include: messageInclude,
      orderBy: { pinnedAt: 'desc' },
    });
    return items.map(m => this.mapMessage(m, actor.sub));
  }

  async react(tenantId: string, chatId: string, messageId: string, input: ReactionInput, actor: JwtUser) {
    await this.loadChatOrThrow(tenantId, chatId, actor);
    const message = await prisma.groupChatMessage.findFirst({ where: { id: messageId, chatId }, select: { id: true } });
    if (!message) throw new AppError(404, 'MESSAGE_NOT_FOUND', 'Message not found');

    await prisma.groupChatReaction.upsert({
      where: { messageId_userId_emoji: { messageId, userId: actor.sub, emoji: input.emoji } },
      update: {},
      create: { tenantId, messageId, userId: actor.sub, emoji: input.emoji },
    });

    const updated = await prisma.groupChatMessage.findUniqueOrThrow({ where: { id: messageId }, include: messageInclude });
    return this.mapMessage(updated, actor.sub);
  }

  async removeReaction(tenantId: string, chatId: string, messageId: string, emoji: string, actor: JwtUser) {
    await this.loadChatOrThrow(tenantId, chatId, actor);
    await prisma.groupChatReaction.deleteMany({
      where: { messageId, userId: actor.sub, emoji, message: { chatId } },
    });
    const updated = await prisma.groupChatMessage.findUniqueOrThrow({ where: { id: messageId }, include: messageInclude });
    return this.mapMessage(updated, actor.sub);
  }

  async pinMessage(tenantId: string, chatId: string, messageId: string, actor: JwtUser, pinned: boolean) {
    await this.loadChatOrThrow(tenantId, chatId, actor);
    const message = await prisma.groupChatMessage.findFirst({ where: { id: messageId, chatId } });
    if (!message) throw new AppError(404, 'MESSAGE_NOT_FOUND', 'Message not found');

    const updated = await prisma.groupChatMessage.update({
      where: { id: messageId },
      data: pinned
        ? { isPinned: true, pinnedAt: new Date(), pinnedByUserId: actor.sub }
        : { isPinned: false, pinnedAt: null, pinnedByUserId: null },
      include: messageInclude,
    });
    return this.mapMessage(updated, actor.sub);
  }

  async deleteMessage(tenantId: string, chatId: string, messageId: string, actor: JwtUser) {
    await this.loadChatOrThrow(tenantId, chatId, actor);
    const message = await prisma.groupChatMessage.findFirst({ where: { id: messageId, chatId } });
    if (!message) throw new AppError(404, 'MESSAGE_NOT_FOUND', 'Message not found');

    const updated = await prisma.groupChatMessage.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), deletedByUserId: actor.sub, isPinned: false, pinnedAt: null, pinnedByUserId: null },
      include: messageInclude,
    });
    return this.mapMessage(updated, actor.sub);
  }

  async markRead(tenantId: string, chatId: string, actor: JwtUser) {
    await this.loadChatOrThrow(tenantId, chatId, actor);
    await prisma.studentGroupChatRead.upsert({
      where: { chatId_userId: { chatId, userId: actor.sub } },
      update: { lastReadAt: new Date() },
      create: { tenantId, chatId, userId: actor.sub },
    });
    return { read: true };
  }

  async getReadReceipts(tenantId: string, chatId: string, actor: JwtUser) {
    await this.loadChatOrThrow(tenantId, chatId, actor);
    const reads = await prisma.studentGroupChatRead.findMany({
      where: { chatId },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { lastReadAt: 'desc' },
    });
    return reads.map(r => ({
      user: r.user,
      lastReadAt: r.lastReadAt,
    }));
  }

  private mapMessage(
    m: {
      id: string;
      content: string;
      createdAt: Date;
      deletedAt: Date | null;
      deletedByUserId: string | null;
      isPinned: boolean;
      pinnedAt: Date | null;
      pinnedByUserId: string | null;
      isAnnouncement: boolean;
      mentionedUserIds: string[];
      sender: { id: string; firstName: string; lastName: string };
      fileAsset: {
        id: string;
        originalName: string;
        mimeType: string | null;
        bytes: number | null;
        resourceType: string;
        secureUrl: string;
      } | null;
      reactions: Array<{ userId: string; emoji: string }>;
      replyTo: {
        id: string;
        content: string;
        deletedAt: Date | null;
        sender: { id: string; firstName: string; lastName: string };
      } | null;
    },
    viewerUserId?: string
  ) {
    const reactionSummary = new Map<string, { emoji: string; count: number; reactedByMe: boolean }>();
    for (const r of m.reactions) {
      const current = reactionSummary.get(r.emoji) ?? { emoji: r.emoji, count: 0, reactedByMe: false };
      current.count += 1;
      if (viewerUserId && r.userId === viewerUserId) current.reactedByMe = true;
      reactionSummary.set(r.emoji, current);
    }

    const isDeleted = Boolean(m.deletedAt);

    return {
      id: m.id,
      content: isDeleted ? null : m.content,
      isDeleted,
      deletedByUserId: m.deletedByUserId,
      isPinned: m.isPinned,
      pinnedAt: m.pinnedAt,
      pinnedByUserId: m.pinnedByUserId,
      isAnnouncement: m.isAnnouncement,
      mentionedUserIds: m.mentionedUserIds,
      sender: m.sender,
      createdAt: m.createdAt,
      attachment:
        !isDeleted && m.fileAsset
          ? {
              id: m.fileAsset.id,
              originalName: m.fileAsset.originalName,
              mimeType: m.fileAsset.mimeType,
              bytes: m.fileAsset.bytes,
              resourceType: m.fileAsset.resourceType,
              secureUrl: isProtectedPdfAsset(m.fileAsset.mimeType) ? null : m.fileAsset.secureUrl,
            }
          : null,
      reactions: [...reactionSummary.values()],
      replyTo: m.replyTo
        ? {
            id: m.replyTo.id,
            content: m.replyTo.deletedAt ? null : m.replyTo.content,
            sender: m.replyTo.sender,
          }
        : null,
    };
  }
}
