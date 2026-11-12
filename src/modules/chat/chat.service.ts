import { JwtUser } from '../../common/types/auth.types';
import { AppError } from '../../common/errors/app-error';
import { buildPagination } from '../../common/utils/pagination';
import { isProtectedPdfAsset } from '../../common/utils/protected-attachment';
import { upsertFileAsset } from '../../common/services/file-asset-upsert.service';
import { prisma } from '../../db/prisma';
import { ChatMemberRole, ChatType, Prisma } from '@prisma/client';
import {
  SendMessageInput,
  ListMessagesQueryInput,
  ReactionInput,
  CreateGroupInput,
  UpdateGroupInput,
  ContactsQueryInput,
} from './chat.schemas';

type ChatRecord = {
  id: string;
  tenantId: string;
  type: ChatType;
  classRoomId: string | null;
  academicYearId: string | null;
};

type Person = { id: string; firstName: string; lastName: string };

const MAX_GROUP_MEMBERS = 256;

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
  private async assertParticipant(chat: ChatRecord, actor: JwtUser) {
    // Groups and direct messages are private to their members — not even admins read them.
    if (chat.type !== ChatType.CLASS) {
      const member = await prisma.chatMember.findUnique({
        where: { chatId_userId: { chatId: chat.id, userId: actor.sub } },
        select: { id: true },
      });
      if (!member) throw new AppError(403, 'FORBIDDEN', 'You are not a member of this chat');
      return;
    }

    if (!chat.classRoomId || !chat.academicYearId) {
      throw new AppError(404, 'CHAT_NOT_FOUND', 'Chat not found');
    }
    const classChat = { ...chat, classRoomId: chat.classRoomId, academicYearId: chat.academicYearId };

    const roles = actor.roles ?? [];
    if (roles.includes('SCHOOL_ADMIN') || roles.includes('SUPER_ADMIN')) {
      return;
    }

    if (roles.includes('STUDENT')) {
      const enrollment = await prisma.studentEnrollment.findFirst({
        where: {
          tenantId: classChat.tenantId,
          classRoomId: classChat.classRoomId,
          academicYearId: classChat.academicYearId,
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
          tenantId: classChat.tenantId,
          classRoomId: classChat.classRoomId,
          academicYearId: classChat.academicYearId,
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

    await prisma.$transaction([
      prisma.studentGroupChatRead.upsert({
        where: { chatId_userId: { chatId, userId: actor.sub } },
        update: { lastReadAt: new Date() },
        create: { tenantId, chatId, userId: actor.sub },
      }),
      prisma.studentGroupChat.update({
        where: { id: chatId },
        data: { lastMessageAt: message.createdAt },
      }),
    ]);

    return this.mapMessage(message, actor.sub);
  }

  async listMessages(tenantId: string, chatId: string, query: ListMessagesQueryInput, actor: JwtUser) {
    await this.loadChatOrThrow(tenantId, chatId, actor);

    const where: Record<string, unknown> = { chatId };
    if (query.q) {
      where.content = { contains: query.q, mode: 'insensitive' };
      where.deletedAt = null;
    }

    // Page 1 is the newest messages (like any chat app); higher pages go further back.
    // Items are returned oldest-first so they render top-to-bottom.
    const skip = (query.page - 1) * query.pageSize;
    const [totalItems, items] = await prisma.$transaction([
      prisma.groupChatMessage.count({ where: where as never }),
      prisma.groupChatMessage.findMany({
        where: where as never,
        skip,
        take: query.pageSize,
        include: messageInclude,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      items: items.reverse().map(m => this.mapMessage(m, actor.sub)),
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
    const chat = await this.loadChatOrThrow(tenantId, chatId, actor);
    const message = await prisma.groupChatMessage.findFirst({ where: { id: messageId, chatId } });
    if (!message) throw new AppError(404, 'MESSAGE_NOT_FOUND', 'Message not found');

    // Anyone can delete their own message. Class chat moderators and group admins can
    // delete anyone's.
    const isOwn = message.senderId === actor.sub;
    if (!isOwn) {
      const canModerate =
        chat.type === ChatType.CLASS
          ? (actor.permissions ?? []).includes('chat.moderate')
          : chat.type === ChatType.GROUP && (await this.isGroupAdmin(chatId, actor.sub));
      if (!canModerate) {
        throw new AppError(403, 'FORBIDDEN', 'You can only delete your own messages');
      }
    }

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

  // ---------------------------------------------------------------------------
  // Conversations: chat list, groups and direct messages
  // ---------------------------------------------------------------------------

  private async isGroupAdmin(chatId: string, userId: string) {
    const member = await prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
      select: { role: true },
    });
    return member?.role === ChatMemberRole.ADMIN;
  }

  /** User ids of every participant, used to push chat-list updates over sockets. */
  async listParticipantUserIds(tenantId: string, chatId: string): Promise<string[]> {
    const chat = await prisma.studentGroupChat.findFirst({ where: { id: chatId, tenantId } });
    if (!chat) return [];
    if (chat.type !== ChatType.CLASS) {
      const members = await prisma.chatMember.findMany({ where: { chatId }, select: { userId: true } });
      return members.map(m => m.userId);
    }
    if (!chat.classRoomId || !chat.academicYearId) return [];
    const roster = await this.listRoster(tenantId, chat.classRoomId, chat.academicYearId);
    return roster.map(r => r.id);
  }

  /** Students in this school that the actor can start a chat with (excludes the actor). */
  async listContacts(tenantId: string, query: ContactsQueryInput, actor: JwtUser) {
    const q = query.q?.trim();
    const students = await prisma.student.findMany({
      where: {
        tenantId,
        deletedAt: null,
        isActive: true,
        userId: { not: null, notIn: [actor.sub] },
        ...(q
          ? {
              OR: [
                { firstName: { contains: q, mode: 'insensitive' } },
                { lastName: { contains: q, mode: 'insensitive' } },
                { studentCode: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        userId: true,
        firstName: true,
        lastName: true,
        enrollments: {
          where: { isActive: true },
          select: { classRoom: { select: { name: true } } },
          take: 1,
          orderBy: { enrolledAt: 'desc' },
        },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 50,
    });
    return students.map(s => ({
      id: s.userId!,
      firstName: s.firstName,
      lastName: s.lastName,
      className: s.enrollments[0]?.classRoom.name ?? null,
    }));
  }

  /** Ensures a class chat exists for each class the actor belongs to (students) or teaches. */
  private async ensureClassChats(tenantId: string, actor: JwtUser) {
    const roles = actor.roles ?? [];
    const pairs = new Map<string, { classRoomId: string; academicYearId: string }>();

    if (roles.includes('STUDENT')) {
      const enrollments = await prisma.studentEnrollment.findMany({
        where: { tenantId, isActive: true, student: { userId: actor.sub, deletedAt: null } },
        select: { classRoomId: true, academicYearId: true },
      });
      for (const e of enrollments) pairs.set(`${e.classRoomId}:${e.academicYearId}`, e);
    }
    if (roles.includes('TEACHER')) {
      const courses = await prisma.course.findMany({
        where: { tenantId, teacherUserId: actor.sub, isActive: true, academicYear: { isCurrent: true } },
        select: { classRoomId: true, academicYearId: true },
        distinct: ['classRoomId', 'academicYearId'],
      });
      for (const c of courses) pairs.set(`${c.classRoomId}:${c.academicYearId}`, c);
    }

    const ids: string[] = [];
    for (const { classRoomId, academicYearId } of pairs.values()) {
      const chat = await prisma.studentGroupChat.upsert({
        where: { tenantId_classRoomId_academicYearId: { tenantId, classRoomId, academicYearId } },
        create: { tenantId, classRoomId, academicYearId, title: 'Class Chat', type: ChatType.CLASS },
        update: {},
        select: { id: true },
      });
      ids.push(chat.id);
    }
    return ids;
  }

  /** WhatsApp-style chat list: class chats, groups and direct messages, newest first. */
  async listMyChats(tenantId: string, actor: JwtUser) {
    const classChatIds = await this.ensureClassChats(tenantId, actor);
    const memberships = await prisma.chatMember.findMany({
      where: { tenantId, userId: actor.sub, chat: { isActive: true } },
      select: { chatId: true },
    });
    const chatIds = [...new Set([...classChatIds, ...memberships.map(m => m.chatId)])];
    if (!chatIds.length) return [];

    const [chats, reads] = await Promise.all([
      prisma.studentGroupChat.findMany({
        where: { id: { in: chatIds }, tenantId },
        include: {
          classRoom: { select: { name: true } },
          members: {
            select: { userId: true, user: { select: { id: true, firstName: true, lastName: true } } },
          },
        },
      }),
      prisma.studentGroupChatRead.findMany({
        where: { chatId: { in: chatIds }, userId: actor.sub },
        select: { chatId: true, lastReadAt: true },
      }),
    ]);
    const lastReadByChat = new Map(reads.map(r => [r.chatId, r.lastReadAt]));

    const items = await Promise.all(
      chats.map(async chat => {
        const lastReadAt = lastReadByChat.get(chat.id);
        const [lastMessage, unreadCount] = await Promise.all([
          prisma.groupChatMessage.findFirst({
            where: { chatId: chat.id },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              content: true,
              createdAt: true,
              deletedAt: true,
              fileAssetId: true,
              sender: { select: { id: true, firstName: true, lastName: true } },
            },
          }),
          prisma.groupChatMessage.count({
            where: {
              chatId: chat.id,
              deletedAt: null,
              senderId: { not: actor.sub },
              ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
            },
          }),
        ]);

        const other =
          chat.type === ChatType.DIRECT
            ? (chat.members.find(m => m.userId !== actor.sub)?.user ?? null)
            : null;

        return {
          id: chat.id,
          type: chat.type,
          title: this.chatTitle(chat, other),
          memberCount: chat.type === ChatType.CLASS ? null : chat.members.length,
          otherUser: other,
          lastMessage: lastMessage
            ? {
                id: lastMessage.id,
                preview: lastMessage.deletedAt
                  ? 'Message deleted'
                  : lastMessage.content || (lastMessage.fileAssetId ? '📎 Attachment' : ''),
                createdAt: lastMessage.createdAt,
                sender: lastMessage.sender,
              }
            : null,
          unreadCount,
          sortAt: (lastMessage?.createdAt ?? chat.createdAt).toISOString(),
        };
      })
    );

    return items.sort((a, b) => b.sortAt.localeCompare(a.sortAt));
  }

  private chatTitle(
    chat: { type: ChatType; title: string; classRoom?: { name: string } | null },
    other: Person | null
  ) {
    if (chat.type === ChatType.CLASS) return chat.classRoom?.name ?? chat.title;
    if (chat.type === ChatType.DIRECT) return other ? `${other.firstName} ${other.lastName}` : 'Chat';
    return chat.title;
  }

  /** Full details for one chat (any type): members and what the viewer can do. */
  async getChat(tenantId: string, chatId: string, actor: JwtUser) {
    const chat = await this.loadChatOrThrow(tenantId, chatId, actor);
    if (chat.type === ChatType.CLASS) {
      if (!chat.classRoomId) throw new AppError(404, 'CHAT_NOT_FOUND', 'Chat not found');
      const result = await this.getOrCreateChat(tenantId, chat.classRoomId, actor, chat.academicYearId ?? undefined);
      return { ...result, type: chat.type, description: null, members: result.roster.map(r => ({ ...r, isAdmin: false })) };
    }

    const members = await prisma.chatMember.findMany({
      where: { chatId },
      select: { role: true, user: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    const me = members.find(m => m.user.id === actor.sub);
    const isAdmin = me?.role === ChatMemberRole.ADMIN;
    const other = chat.type === ChatType.DIRECT ? (members.find(m => m.user.id !== actor.sub)?.user ?? null) : null;
    const roster = members.map(m => ({ ...m.user, role: 'STUDENT' as const }));

    return {
      id: chat.id,
      type: chat.type,
      title: this.chatTitle(chat, other),
      description: chat.description,
      classRoom: null,
      academicYear: null,
      createdAt: chat.createdAt,
      roster,
      members: members.map(m => ({ ...m.user, role: 'STUDENT' as const, isAdmin: m.role === ChatMemberRole.ADMIN })),
      permissions: {
        canSend: true,
        canModerate: chat.type === ChatType.GROUP && isAdmin,
        canPin: false,
        canManageMembers: chat.type === ChatType.GROUP && isAdmin,
        canLeave: chat.type === ChatType.GROUP,
      },
    };
  }

  /** Only students can be added to student groups and direct chats. */
  private async assertStudentsInSchool(tenantId: string, userIds: string[]) {
    if (!userIds.length) return;
    const found = await prisma.student.findMany({
      where: { tenantId, deletedAt: null, isActive: true, userId: { in: userIds } },
      select: { userId: true },
    });
    const ok = new Set(found.map(f => f.userId));
    const missing = userIds.filter(id => !ok.has(id));
    if (missing.length) {
      throw new AppError(400, 'CHAT_MEMBER_INVALID', 'Only students from your school can be added to this chat');
    }
  }

  async createGroup(tenantId: string, input: CreateGroupInput, actor: JwtUser) {
    const memberIds = [...new Set(input.memberUserIds.filter(id => id !== actor.sub))];
    if (!memberIds.length) {
      throw new AppError(400, 'CHAT_MEMBERS_REQUIRED', 'Add at least one classmate to the group');
    }
    if (memberIds.length + 1 > MAX_GROUP_MEMBERS) {
      throw new AppError(400, 'CHAT_TOO_MANY_MEMBERS', `A group can have at most ${MAX_GROUP_MEMBERS} members`);
    }
    await this.assertStudentsInSchool(tenantId, memberIds);

    const chat = await prisma.studentGroupChat.create({
      data: {
        tenantId,
        type: ChatType.GROUP,
        title: input.title,
        description: input.description,
        createdByUserId: actor.sub,
        members: {
          create: [
            { tenantId, userId: actor.sub, role: ChatMemberRole.ADMIN },
            ...memberIds.map(userId => ({ tenantId, userId, role: ChatMemberRole.MEMBER })),
          ],
        },
      },
      select: { id: true },
    });
    return { id: chat.id, memberUserIds: [actor.sub, ...memberIds] };
  }

  async getOrCreateDirectChat(tenantId: string, otherUserId: string, actor: JwtUser) {
    if (otherUserId === actor.sub) {
      throw new AppError(400, 'CHAT_SELF', 'You cannot start a chat with yourself');
    }
    await this.assertStudentsInSchool(tenantId, [otherUserId]);
    const [a, b] = [actor.sub, otherUserId].sort();
    const directKey = `${tenantId}:${a}:${b}`;

    const existing = await prisma.studentGroupChat.findUnique({ where: { directKey }, select: { id: true } });
    if (existing) return { id: existing.id, memberUserIds: [a, b], created: false };

    try {
      const chat = await prisma.studentGroupChat.create({
        data: {
          tenantId,
          type: ChatType.DIRECT,
          title: 'Direct message',
          directKey,
          createdByUserId: actor.sub,
          members: {
            create: [
              { tenantId, userId: a, role: ChatMemberRole.MEMBER },
              { tenantId, userId: b, role: ChatMemberRole.MEMBER },
            ],
          },
        },
        select: { id: true },
      });
      return { id: chat.id, memberUserIds: [a, b], created: true };
    } catch (e) {
      // Both people opened the chat at the same moment.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const chat = await prisma.studentGroupChat.findUniqueOrThrow({ where: { directKey }, select: { id: true } });
        return { id: chat.id, memberUserIds: [a, b], created: false };
      }
      throw e;
    }
  }

  private async loadGroupForAdmin(tenantId: string, chatId: string, actor: JwtUser) {
    const chat = await this.loadChatOrThrow(tenantId, chatId, actor);
    if (chat.type !== ChatType.GROUP) throw new AppError(400, 'CHAT_NOT_GROUP', 'Only groups can be changed');
    if (!(await this.isGroupAdmin(chatId, actor.sub))) {
      throw new AppError(403, 'FORBIDDEN', 'Only group admins can do this');
    }
    return chat;
  }

  async updateGroup(tenantId: string, chatId: string, input: UpdateGroupInput, actor: JwtUser) {
    await this.loadGroupForAdmin(tenantId, chatId, actor);
    await prisma.studentGroupChat.update({
      where: { id: chatId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      },
    });
    return this.getChat(tenantId, chatId, actor);
  }

  async addMembers(tenantId: string, chatId: string, userIds: string[], actor: JwtUser) {
    await this.loadGroupForAdmin(tenantId, chatId, actor);
    const ids = [...new Set(userIds)];
    await this.assertStudentsInSchool(tenantId, ids);
    const current = await prisma.chatMember.count({ where: { chatId } });
    if (current + ids.length > MAX_GROUP_MEMBERS) {
      throw new AppError(400, 'CHAT_TOO_MANY_MEMBERS', `A group can have at most ${MAX_GROUP_MEMBERS} members`);
    }
    await prisma.chatMember.createMany({
      data: ids.map(userId => ({ tenantId, chatId, userId, role: ChatMemberRole.MEMBER })),
      skipDuplicates: true,
    });
    return this.getChat(tenantId, chatId, actor);
  }

  /** Admins remove someone, or a member leaves (userId === actor). */
  async removeMember(tenantId: string, chatId: string, userId: string, actor: JwtUser) {
    const chat = await this.loadChatOrThrow(tenantId, chatId, actor);
    if (chat.type !== ChatType.GROUP) throw new AppError(400, 'CHAT_NOT_GROUP', 'Only groups can be changed');
    const leaving = userId === actor.sub;
    if (!leaving && !(await this.isGroupAdmin(chatId, actor.sub))) {
      throw new AppError(403, 'FORBIDDEN', 'Only group admins can remove members');
    }

    await prisma.$transaction(async tx => {
      await tx.chatMember.deleteMany({ where: { chatId, userId } });
      // Never leave a group without an admin: promote the longest-standing member.
      const admins = await tx.chatMember.count({ where: { chatId, role: ChatMemberRole.ADMIN } });
      if (admins === 0) {
        const next = await tx.chatMember.findFirst({ where: { chatId }, orderBy: { joinedAt: 'asc' } });
        if (next) await tx.chatMember.update({ where: { id: next.id }, data: { role: ChatMemberRole.ADMIN } });
        else await tx.studentGroupChat.update({ where: { id: chatId }, data: { isActive: false } });
      }
    });
    return { removed: true, userId };
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
