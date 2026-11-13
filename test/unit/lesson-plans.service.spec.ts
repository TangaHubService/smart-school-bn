jest.mock('../../src/db/prisma', () => {
  const prisma = {
    teacherLessonPlan: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    teacherLessonPlanRevision: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    course: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  return { prisma };
});

import { prisma } from '../../src/db/prisma';
import { LessonPlansService } from '../../src/modules/lesson-plans/lesson-plans.service';
import { JwtUser } from '../../src/common/types/auth.types';

const mockedPrisma = prisma as unknown as {
  teacherLessonPlan: {
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
  };
  teacherLessonPlanRevision: { create: jest.Mock; findMany: jest.Mock };
  course: { findFirst: jest.Mock; findMany: jest.Mock };
  $transaction: jest.Mock;
};

function actor(overrides: Partial<JwtUser> = {}): JwtUser {
  return {
    sub: 'teacher-1',
    tenantId: 'tenant-1',
    email: 'teacher@example.com',
    roles: ['TEACHER'],
    permissions: [],
    ...overrides,
  } as JwtUser;
}

const basePlan = {
  id: 'plan-1',
  tenantId: 'tenant-1',
  teacherUserId: 'teacher-1',
  title: 'Fractions week 1',
  objectives: null,
  materials: null,
  activities: null,
  assessment: null,
  feedback: null,
  status: 'DRAFT',
  weekNumber: 1,
  durationMinutes: 40,
};

describe('LessonPlansService', () => {
  let service: LessonPlansService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LessonPlansService();
  });

  it('blocks a school admin from editing a teacher-owned lesson plan', async () => {
    mockedPrisma.teacherLessonPlan.findFirst.mockResolvedValue({ ...basePlan });

    await expect(
      service.update(
        'tenant-1',
        'plan-1',
        { title: 'Rewritten by admin' },
        actor({ sub: 'admin-1', roles: ['SCHOOL_ADMIN'] })
      )
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });

    expect(mockedPrisma.teacherLessonPlan.update).not.toHaveBeenCalled();
  });

  it('blocks editing a plan that is submitted or approved, even by its owner', async () => {
    mockedPrisma.teacherLessonPlan.findFirst.mockResolvedValue({ ...basePlan, status: 'SUBMITTED' });

    await expect(
      service.update('tenant-1', 'plan-1', { title: 'Edited' }, actor())
    ).rejects.toMatchObject({ code: 'LESSON_PLAN_NOT_EDITABLE', statusCode: 409 });
  });

  it('lets the owning teacher submit a draft for review and records a revision', async () => {
    mockedPrisma.teacherLessonPlan.findFirst.mockResolvedValue({ ...basePlan });
    mockedPrisma.teacherLessonPlan.update.mockResolvedValue({
      ...basePlan,
      status: 'SUBMITTED',
      teacherUser: { id: 'teacher-1', firstName: 'A', lastName: 'B', email: 'a@b.com' },
      academicYear: { id: 'ay-1', name: '2026' },
      classRoom: { id: 'cr-1', code: 'C1', name: 'Class 1' },
      subject: { id: 'sub-1', code: 'MATH', name: 'Math' },
    });

    const result = await service.submit('tenant-1', 'plan-1', actor());

    expect(result.status).toBe('SUBMITTED');
    expect(mockedPrisma.teacherLessonPlanRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ planId: 'plan-1', actorUserId: 'teacher-1', action: 'SUBMITTED' }),
      })
    );
  });

  it('blocks a non-admin from reviewing a submitted plan', async () => {
    mockedPrisma.teacherLessonPlan.findFirst.mockResolvedValue({ ...basePlan, status: 'SUBMITTED' });

    await expect(
      service.review('tenant-1', 'plan-1', { decision: 'APPROVED' }, actor())
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
  });

  it('blocks reviewing a plan that is not currently submitted', async () => {
    mockedPrisma.teacherLessonPlan.findFirst.mockResolvedValue({ ...basePlan, status: 'DRAFT' });

    await expect(
      service.review(
        'tenant-1',
        'plan-1',
        { decision: 'APPROVED' },
        actor({ sub: 'admin-1', roles: ['SCHOOL_ADMIN'] })
      )
    ).rejects.toMatchObject({ code: 'LESSON_PLAN_NOT_UNDER_REVIEW', statusCode: 409 });
  });

  it('lets a school admin approve a submitted plan and records the decision as a revision', async () => {
    mockedPrisma.teacherLessonPlan.findFirst.mockResolvedValue({ ...basePlan, status: 'SUBMITTED' });
    mockedPrisma.teacherLessonPlan.update.mockResolvedValue({
      ...basePlan,
      status: 'APPROVED',
      teacherUser: { id: 'teacher-1', firstName: 'A', lastName: 'B', email: 'a@b.com' },
      academicYear: { id: 'ay-1', name: '2026' },
      classRoom: { id: 'cr-1', code: 'C1', name: 'Class 1' },
      subject: { id: 'sub-1', code: 'MATH', name: 'Math' },
    });

    const result = await service.review(
      'tenant-1',
      'plan-1',
      { decision: 'APPROVED', note: 'Looks good' },
      actor({ sub: 'admin-1', roles: ['SCHOOL_ADMIN'] })
    );

    expect(result.status).toBe('APPROVED');
    expect(mockedPrisma.teacherLessonPlanRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          planId: 'plan-1',
          actorUserId: 'admin-1',
          action: 'APPROVED',
          note: 'Looks good',
        }),
      })
    );
  });

  it('blocks deleting a plan once it has left draft status', async () => {
    mockedPrisma.teacherLessonPlan.findFirst.mockResolvedValue({ ...basePlan, status: 'SUBMITTED' });

    await expect(service.delete('tenant-1', 'plan-1', actor())).rejects.toMatchObject({
      code: 'LESSON_PLAN_NOT_DELETABLE',
      statusCode: 409,
    });
    expect(mockedPrisma.teacherLessonPlan.delete).not.toHaveBeenCalled();
  });

  describe('teacher assignment, auditors and list scope', () => {
    const createInput = {
      title: 'Fractions',
      academicYearId: '11111111-1111-4111-8111-111111111111',
      classRoomId: '22222222-2222-4222-8222-222222222222',
      subjectId: '33333333-3333-4333-8333-333333333333',
    };

    it('blocks a teacher from creating a plan for a class and subject they do not teach', async () => {
      mockedPrisma.course.findFirst.mockResolvedValue(null);
      await expect(new LessonPlansService().create('tenant-1', createInput, actor())).rejects.toMatchObject({
        statusCode: 403,
        code: 'LESSON_PLAN_NOT_ASSIGNED',
      });
      expect(mockedPrisma.course.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            teacherUserId: 'teacher-1',
            classRoomId: createInput.classRoomId,
            subjectId: createInput.subjectId,
            academicYearId: createInput.academicYearId,
            isActive: true,
          }),
        })
      );
      expect(mockedPrisma.teacherLessonPlan.create).not.toHaveBeenCalled();
    });

    it('lets a teacher create a plan for a class and subject they teach', async () => {
      mockedPrisma.course.findFirst.mockResolvedValue({ id: 'course-1' });
      mockedPrisma.teacherLessonPlan.create.mockResolvedValue({ ...basePlan, title: 'Fractions' });
      mockedPrisma.teacherLessonPlanRevision.create.mockResolvedValue({});
      await new LessonPlansService().create('tenant-1', createInput, actor());
      expect(mockedPrisma.teacherLessonPlan.create).toHaveBeenCalled();
    });

    it('lets a government auditor read the revision history of any plan', async () => {
      mockedPrisma.teacherLessonPlan.findFirst.mockResolvedValue(basePlan);
      mockedPrisma.teacherLessonPlanRevision.findMany.mockResolvedValue([]);
      await expect(
        new LessonPlansService().listRevisions('tenant-1', 'plan-1', actor({ sub: 'auditor-1', roles: ['GOV_AUDITOR'] }))
      ).resolves.toEqual([]);
    });

    it('still blocks another teacher from reading a plan history', async () => {
      mockedPrisma.teacherLessonPlan.findFirst.mockResolvedValue(basePlan);
      await expect(
        new LessonPlansService().listRevisions('tenant-1', 'plan-1', actor({ sub: 'teacher-2' }))
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it.each([
      ['a teacher', ['TEACHER'], true],
      ['a user with no school-wide role', ['PARENT'], true],
      ['a school admin', ['SCHOOL_ADMIN'], false],
      ['a government auditor', ['GOV_AUDITOR'], false],
    ])('scopes the list to own plans for %s: %s', async (_label, roles, ownOnly) => {
      mockedPrisma.$transaction.mockResolvedValue([0, []]);
      await new LessonPlansService().list(
        'tenant-1',
        { page: 1, pageSize: 20 } as any,
        actor({ sub: 'user-1', roles: roles as string[] })
      );
      const where = mockedPrisma.teacherLessonPlan.count.mock.calls.at(-1)?.[0]?.where;
      if (ownOnly) {
        expect(where).toMatchObject({ teacherUserId: 'user-1' });
      } else {
        expect(where?.teacherUserId).toBeUndefined();
      }
    });
  });
});
