jest.mock('../../src/db/prisma', () => {
  const section = {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    aggregate: jest.fn(),
    count: jest.fn(),
  };
  const lesson = {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    aggregate: jest.fn(),
  };
  const course = { findFirst: jest.fn() };
  return { prisma: { section, lesson, course, $transaction: jest.fn() } };
});

const logMock = jest.fn();
jest.mock('../../src/modules/audit/audit.service', () => ({
  AuditService: jest.fn().mockImplementation(() => ({ log: logMock })),
}));

import { prisma } from '../../src/db/prisma';
import { LmsService } from '../../src/modules/lms/lms.service';
import { JwtUser } from '../../src/common/types/auth.types';

const mockedPrisma = prisma as unknown as {
  section: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    aggregate: jest.Mock;
    count: jest.Mock;
  };
  lesson: { findFirst: jest.Mock };
  course: { findFirst: jest.Mock };
};

function actor(overrides: Partial<JwtUser> = {}): JwtUser {
  return {
    sub: 'admin-1',
    tenantId: 'tenant-1',
    email: 'admin@example.com',
    roles: ['SCHOOL_ADMIN'],
    permissions: [],
    ...overrides,
  } as JwtUser;
}

const context = { requestId: 'req-1', ipAddress: '127.0.0.1', userAgent: 'jest' } as never;

const teacherOwner = actor({ sub: 'teacher-1', roles: ['TEACHER'] });
const teacherOther = actor({ sub: 'teacher-2', roles: ['TEACHER'] });

describe('LmsService sections (D1)', () => {
  let service: LmsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LmsService();
  });

  it('createSection 404s when the course does not exist', async () => {
    mockedPrisma.course.findFirst.mockResolvedValue(null);

    await expect(
      service.createSection('tenant-1', 'course-1', { title: 'Unit 1' }, teacherOwner, context)
    ).rejects.toMatchObject({ code: 'COURSE_NOT_FOUND' });
  });

  it('createSection 403s for a teacher who does not own the course', async () => {
    mockedPrisma.course.findFirst.mockResolvedValue({ id: 'course-1', teacherUserId: 'teacher-1' });

    await expect(
      service.createSection('tenant-1', 'course-1', { title: 'Unit 1' }, teacherOther, context)
    ).rejects.toMatchObject({ code: 'COURSE_MANAGE_FORBIDDEN' });
  });

  it('createSection appends sortOrder and audits creation', async () => {
    mockedPrisma.course.findFirst.mockResolvedValue({ id: 'course-1', teacherUserId: 'teacher-1' });
    mockedPrisma.section.aggregate.mockResolvedValue({ _max: { sortOrder: 2 } });
    mockedPrisma.section.create.mockResolvedValue({
      id: 'section-1',
      title: 'Unit 1',
      sortOrder: 3,
      isPublished: false,
      publishedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.createSection(
      'tenant-1',
      'course-1',
      { title: 'Unit 1' },
      teacherOwner,
      context
    );

    expect(mockedPrisma.section.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sortOrder: 3 }) })
    );
    expect(result).toMatchObject({ id: 'section-1', lessonCount: 0 });
    expect(logMock).toHaveBeenCalledWith(expect.objectContaining({ event: 'SECTION_CREATED' }));
  });

  it('updateLesson rejects a section from another course', async () => {
    mockedPrisma.lesson.findFirst.mockResolvedValue({
      id: 'lesson-1',
      courseId: 'course-1',
      course: { teacherUserId: 'teacher-1' },
    });
    mockedPrisma.section.findFirst.mockResolvedValue(null);

    await expect(
      service.updateLesson(
        'tenant-1',
        'lesson-1',
        { sectionId: 'section-foreign' },
        teacherOwner,
        context
      )
    ).rejects.toMatchObject({ code: 'SECTION_NOT_FOUND' });
  });

  it('reorderSections rejects an incomplete order list', async () => {
    mockedPrisma.course.findFirst.mockResolvedValue({ id: 'course-1', teacherUserId: 'teacher-1' });
    mockedPrisma.section.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);

    await expect(
      service.reorderSections('tenant-1', 'course-1', { order: ['s1'] }, teacherOwner)
    ).rejects.toMatchObject({ code: 'SECTION_REORDER_MISMATCH' });
  });

  it('publishSection audits publish but not unpublish', async () => {
    mockedPrisma.section.findFirst.mockResolvedValue({
      id: 'section-1',
      courseId: 'course-1',
      course: { teacherUserId: 'teacher-1' },
    });
    mockedPrisma.section.count.mockResolvedValue(4);

    mockedPrisma.section.update.mockResolvedValue({
      id: 'section-1',
      title: 'Unit 1',
      sortOrder: 0,
      isPublished: true,
      publishedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await service.publishSection('tenant-1', 'section-1', { isPublished: true }, teacherOwner, context);
    expect(logMock).toHaveBeenCalledWith(expect.objectContaining({ event: 'SECTION_PUBLISHED' }));

    logMock.mockClear();
    mockedPrisma.section.update.mockResolvedValue({
      id: 'section-1',
      title: 'Unit 1',
      sortOrder: 0,
      isPublished: false,
      publishedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const result = await service.publishSection(
      'tenant-1',
      'section-1',
      { isPublished: false },
      teacherOwner,
      context
    );
    expect(result.isPublished).toBe(false);
    expect(logMock).not.toHaveBeenCalled();
  });

  it('student lesson access 404s inside an unpublished section', async () => {
    mockedPrisma.lesson.findFirst.mockResolvedValue({
      id: 'lesson-1',
      courseId: 'course-1',
      title: 'L1',
      sequence: 1,
      sectionId: 'section-1',
      section: { isPublished: false },
    });

    await expect(
      (service as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)
        .assertStudentPublishedLessonAccess('tenant-1', 'lesson-1', teacherOwner)
    ).rejects.toMatchObject({ code: 'LESSON_NOT_FOUND' });
    expect(mockedPrisma.course.findFirst).not.toHaveBeenCalled();
  });
});
