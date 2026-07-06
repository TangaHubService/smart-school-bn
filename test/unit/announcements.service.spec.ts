jest.mock('../../src/db/prisma', () => {
  const prisma = {
    announcement: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    announcementRead: {
      upsert: jest.fn(),
    },
    student: {
      findFirst: jest.fn(),
    },
    studentEnrollment: {
      findFirst: jest.fn(),
    },
    course: {
      findMany: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  return { prisma };
});

jest.mock('../../src/modules/audit/audit.service', () => ({
  AuditService: jest.fn().mockImplementation(() => ({ logActivity: jest.fn() })),
}));

jest.mock('../../src/modules/system-announcements/system-announcements.service', () => ({
  SystemAnnouncementsService: jest.fn().mockImplementation(() => ({
    listVisibleForViewer: jest.fn().mockResolvedValue([]),
  })),
}));

jest.mock('../../src/modules/notifications/email.service', () => ({
  EmailService: jest.fn().mockImplementation(() => ({
    sendAnnouncementNotification: jest.fn(),
  })),
}));

import { prisma } from '../../src/db/prisma';
import { AnnouncementsService } from '../../src/modules/announcements/announcements.service';
import { JwtUser } from '../../src/common/types/auth.types';

const mockedPrisma = prisma as unknown as {
  announcement: { findFirst: jest.Mock; findMany: jest.Mock; count: jest.Mock };
  student: { findFirst: jest.Mock };
  studentEnrollment: { findFirst: jest.Mock };
  course: { findMany: jest.Mock };
  $transaction: jest.Mock;
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

describe('AnnouncementsService.listForViewer', () => {
  let service: AnnouncementsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AnnouncementsService();
    mockedPrisma.$transaction.mockImplementation(async (ops: Promise<unknown>[]) =>
      Promise.all(ops)
    );
    mockedPrisma.announcement.count.mockResolvedValue(0);
    mockedPrisma.announcement.findMany.mockResolvedValue([]);
  });

  it('does not crash for a PARENT viewer and never looks up a Student record for them', async () => {
    await expect(
      service.listForViewer('tenant-1', actor({ roles: ['PARENT'] }), {
        page: 1,
        pageSize: 20,
        unreadOnly: false,
      })
    ).resolves.toBeDefined();

    expect(mockedPrisma.student.findFirst).not.toHaveBeenCalled();

    const where = mockedPrisma.announcement.findMany.mock.calls[0][0].where;
    const conditions = where.AND[0].OR;
    expect(conditions).toContainEqual(
      expect.objectContaining({ audience: 'SPECIFIC_ROLES', targetRoleNames: { hasSome: ['PARENT'] } })
    );
    expect(conditions).toContainEqual(
      expect.objectContaining({ audience: 'INDIVIDUAL_USERS', targetUserIds: { has: 'user-1' } })
    );
  });

  it('does not crash for a TEACHER viewer and adds class/subject conditions from their taught courses', async () => {
    mockedPrisma.course.findMany.mockResolvedValue([
      { classRoomId: 'class-1', subjectId: 'subj-1', classRoom: { gradeLevelId: 'grade-1' } },
    ]);

    await service.listForViewer('tenant-1', actor({ roles: ['TEACHER'] }), {
      page: 1,
      pageSize: 20,
      unreadOnly: false,
    });

    expect(mockedPrisma.student.findFirst).not.toHaveBeenCalled();

    const where = mockedPrisma.announcement.findMany.mock.calls[0][0].where;
    const conditions = where.AND[0].OR;
    expect(conditions).toContainEqual(
      expect.objectContaining({ audience: 'CLASS_ROOM', targetClassRoomIds: { hasSome: ['class-1'] } })
    );
    expect(conditions).toContainEqual(
      expect.objectContaining({ audience: 'GRADE_LEVEL', targetGradeLevelIds: { hasSome: ['grade-1'] } })
    );
    expect(conditions).toContainEqual(
      expect.objectContaining({ audience: 'SUBJECT', targetSubjectIds: { hasSome: ['subj-1'] } })
    );
  });

  it('scopes a STUDENT viewer to their active enrollment class/grade/subjects', async () => {
    mockedPrisma.student.findFirst.mockResolvedValue({
      id: 'student-1',
      enrollments: [{ classRoomId: 'class-2', classRoom: { gradeLevelId: 'grade-2' } }],
    });
    mockedPrisma.course.findMany.mockResolvedValue([{ subjectId: 'subj-2' }]);

    await service.listForViewer('tenant-1', actor({ roles: ['STUDENT'] }), {
      page: 1,
      pageSize: 20,
      unreadOnly: false,
    });

    const where = mockedPrisma.announcement.findMany.mock.calls[0][0].where;
    const conditions = where.AND[0].OR;
    expect(conditions).toContainEqual(
      expect.objectContaining({ audience: 'CLASS_ROOM', targetClassRoomIds: { has: 'class-2' } })
    );
    expect(conditions).toContainEqual(
      expect.objectContaining({ audience: 'GRADE_LEVEL', targetGradeLevelIds: { has: 'grade-2' } })
    );
    expect(conditions).toContainEqual(
      expect.objectContaining({ audience: 'SUBJECT', targetSubjectIds: { hasSome: ['subj-2'] } })
    );
  });

  it('only shows announcements whose publishedAt has already arrived (scheduling)', async () => {
    await service.listForViewer('tenant-1', actor({ roles: ['STUDENT'] }), {
      page: 1,
      pageSize: 20,
      unreadOnly: false,
    });

    const where = mockedPrisma.announcement.findMany.mock.calls[0][0].where;
    expect(where.publishedAt).toEqual({ lte: expect.any(Date) });
  });
});
