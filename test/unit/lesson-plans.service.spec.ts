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
});
