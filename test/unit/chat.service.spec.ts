jest.mock('../../src/db/prisma', () => {
  const prisma = {
    studentEnrollment: { findFirst: jest.fn() },
    academicYear: { findFirst: jest.fn() },
    course: { findFirst: jest.fn(), findMany: jest.fn() },
    student: { findMany: jest.fn() },
    studentGroupChat: { upsert: jest.fn(), findFirst: jest.fn() },
    groupChatMessage: { create: jest.fn(), findFirst: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
    groupChatReaction: { upsert: jest.fn(), deleteMany: jest.fn() },
    studentGroupChatRead: { upsert: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  return { prisma };
});

import { prisma } from '../../src/db/prisma';
import { ChatService } from '../../src/modules/chat/chat.service';
import { JwtUser } from '../../src/common/types/auth.types';

const mockedPrisma = prisma as unknown as {
  studentEnrollment: { findFirst: jest.Mock };
  academicYear: { findFirst: jest.Mock };
  course: { findFirst: jest.Mock; findMany: jest.Mock };
  student: { findMany: jest.Mock };
  studentGroupChat: { upsert: jest.Mock; findFirst: jest.Mock };
  groupChatMessage: { create: jest.Mock };
  studentGroupChatRead: { upsert: jest.Mock };
};

function actor(overrides: Partial<JwtUser> = {}): JwtUser {
  return {
    sub: 'user-1',
    tenantId: 'tenant-1',
    email: 'user@example.com',
    roles: [],
    permissions: [],
    ...overrides,
  } as JwtUser;
}

describe('ChatService.getOrCreateChat', () => {
  let service: ChatService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ChatService();
    mockedPrisma.student.findMany.mockResolvedValue([]);
    mockedPrisma.course.findMany.mockResolvedValue([]);
    mockedPrisma.studentGroupChat.upsert.mockResolvedValue({
      id: 'chat-1',
      classRoomId: 'class-1',
      academicYearId: 'year-1',
      title: 'Class Chat',
      createdAt: new Date(),
      classRoom: { id: 'class-1', code: 'C1', name: 'Class 1' },
      academicYear: { id: 'year-1', name: '2026' },
    });
  });

  it('blocks a student who is not actively enrolled in the class', async () => {
    mockedPrisma.studentEnrollment.findFirst.mockResolvedValue(null);

    await expect(
      service.getOrCreateChat('tenant-1', 'class-1', actor({ roles: ['STUDENT'] }))
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });

    expect(mockedPrisma.studentGroupChat.upsert).not.toHaveBeenCalled();
  });

  it('scopes an enrolled student to their enrollment academic year', async () => {
    mockedPrisma.studentEnrollment.findFirst.mockResolvedValue({ academicYearId: 'year-1' });

    const result = await service.getOrCreateChat('tenant-1', 'class-1', actor({ roles: ['STUDENT'] }));

    expect(mockedPrisma.studentGroupChat.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_classRoomId_academicYearId: { tenantId: 'tenant-1', classRoomId: 'class-1', academicYearId: 'year-1' } },
      })
    );
    expect(result.permissions).toEqual({ canSend: true, canModerate: false, canPin: false });
  });

  it('blocks a teacher who does not teach the class', async () => {
    mockedPrisma.academicYear.findFirst.mockResolvedValue({ id: 'year-1' });
    mockedPrisma.course.findFirst.mockResolvedValue(null);

    await expect(
      service.getOrCreateChat('tenant-1', 'class-1', actor({ roles: ['TEACHER'] }))
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });

    expect(mockedPrisma.studentGroupChat.upsert).not.toHaveBeenCalled();
  });

  it('lets a teacher who teaches the class in, with moderate and pin permissions', async () => {
    mockedPrisma.academicYear.findFirst.mockResolvedValue({ id: 'year-1' });
    mockedPrisma.course.findFirst.mockResolvedValue({ id: 'course-1' });

    const result = await service.getOrCreateChat('tenant-1', 'class-1', actor({ roles: ['TEACHER'] }));

    expect(result.permissions).toEqual({ canSend: true, canModerate: true, canPin: true });
  });

  it('lets a SCHOOL_ADMIN in without a teaching-assignment check, view/moderate only', async () => {
    mockedPrisma.academicYear.findFirst.mockResolvedValue({ id: 'year-1' });

    const result = await service.getOrCreateChat('tenant-1', 'class-1', actor({ roles: ['SCHOOL_ADMIN'] }));

    expect(mockedPrisma.course.findFirst).not.toHaveBeenCalled();
    expect(result.permissions).toEqual({ canSend: false, canModerate: true, canPin: false });
  });

  it('blocks a role with no chat access (e.g. PARENT)', async () => {
    await expect(
      service.getOrCreateChat('tenant-1', 'class-1', actor({ roles: ['PARENT'] }))
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
  });
});

describe('ChatService participant re-check on existing chats', () => {
  let service: ChatService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ChatService();
    mockedPrisma.studentGroupChat.findFirst.mockResolvedValue({
      id: 'chat-1',
      tenantId: 'tenant-1',
      classRoomId: 'class-1',
      academicYearId: 'year-1',
    });
  });

  it('rejects sendMessage from a student not enrolled in this chat\'s class, even though the route-level permission check already passed', async () => {
    mockedPrisma.studentEnrollment.findFirst.mockResolvedValue(null);

    await expect(
      service.sendMessage('tenant-1', 'chat-1', { content: 'hi', mentionedUserIds: [], isAnnouncement: false }, actor({ roles: ['STUDENT'] }))
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });

    expect(mockedPrisma.groupChatMessage.create).not.toHaveBeenCalled();
  });

  it('rejects sendMessage from a teacher who does not teach this specific class', async () => {
    mockedPrisma.course.findFirst.mockResolvedValue(null);

    await expect(
      service.sendMessage('tenant-1', 'chat-1', { content: 'hi', mentionedUserIds: [], isAnnouncement: false }, actor({ roles: ['TEACHER'] }))
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });

    expect(mockedPrisma.groupChatMessage.create).not.toHaveBeenCalled();
  });

  it('allows sendMessage from a student who is enrolled in this chat\'s class', async () => {
    mockedPrisma.studentEnrollment.findFirst.mockResolvedValue({ id: 'enrollment-1' });
    mockedPrisma.groupChatMessage.create.mockResolvedValue({
      id: 'msg-1',
      content: 'hi',
      createdAt: new Date(),
      deletedAt: null,
      deletedByUserId: null,
      isPinned: false,
      pinnedAt: null,
      pinnedByUserId: null,
      isAnnouncement: false,
      mentionedUserIds: [],
      sender: { id: 'user-1', firstName: 'A', lastName: 'B' },
      fileAsset: null,
      reactions: [],
      replyTo: null,
    });

    await service.sendMessage('tenant-1', 'chat-1', { content: 'hi', mentionedUserIds: [], isAnnouncement: false }, actor({ roles: ['STUDENT'] }));

    expect(mockedPrisma.groupChatMessage.create).toHaveBeenCalled();
  });
});
