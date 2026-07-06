import { JwtUser } from '../../common/types/auth.types';
import { AppError } from '../../common/errors/app-error';
import { buildPagination } from '../../common/utils/pagination';
import { prisma } from '../../db/prisma';
import {
  CreateLessonPlanInput,
  UpdateLessonPlanInput,
  ReviewLessonPlanInput,
  LessonPlanFeedbackInput,
  ListLessonPlansQueryInput,
} from './lesson-plans.schemas';

const EDITABLE_STATUSES = ['DRAFT', 'REJECTED'];

export class LessonPlansService {
  async create(tenantId: string, input: CreateLessonPlanInput, actor: JwtUser) {
    if (!actor.roles?.includes('TEACHER')) {
      throw new AppError(403, 'FORBIDDEN', 'Only teachers can create lesson plans');
    }

    const created = await prisma.teacherLessonPlan.create({
      data: {
        tenantId,
        teacherUserId: actor.sub,
        academicYearId: input.academicYearId,
        classRoomId: input.classRoomId,
        subjectId: input.subjectId,
        title: input.title,
        objectives: input.objectives ?? null,
        materials: input.materials ?? null,
        activities: input.activities ?? null,
        assessment: input.assessment ?? null,
        weekNumber: input.weekNumber ?? null,
        durationMinutes: input.durationMinutes ?? null,
      },
      include: this.planInclude,
    });

    await this.recordRevision(tenantId, created.id, actor.sub, 'CREATED', created);

    return this.mapPlan(created);
  }

  async update(tenantId: string, planId: string, input: UpdateLessonPlanInput, actor: JwtUser) {
    const plan = await prisma.teacherLessonPlan.findFirst({ where: { id: planId, tenantId } });
    if (!plan) throw new AppError(404, 'LESSON_PLAN_NOT_FOUND', 'Lesson plan not found');

    this.ensureTeacherOwnsPlan(plan.teacherUserId, actor);

    if (!EDITABLE_STATUSES.includes(plan.status)) {
      throw new AppError(
        409,
        'LESSON_PLAN_NOT_EDITABLE',
        'This lesson plan is under review or already decided. Content can only be edited while in draft or after a rejection.'
      );
    }

    const updated = await prisma.teacherLessonPlan.update({
      where: { id: planId },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.objectives !== undefined && { objectives: input.objectives }),
        ...(input.materials !== undefined && { materials: input.materials }),
        ...(input.activities !== undefined && { activities: input.activities }),
        ...(input.assessment !== undefined && { assessment: input.assessment }),
        ...(input.weekNumber !== undefined && { weekNumber: input.weekNumber }),
        ...(input.durationMinutes !== undefined && { durationMinutes: input.durationMinutes }),
      },
      include: this.planInclude,
    });

    await this.recordRevision(tenantId, planId, actor.sub, 'UPDATED', updated);

    return this.mapPlan(updated);
  }

  async submit(tenantId: string, planId: string, actor: JwtUser) {
    const plan = await prisma.teacherLessonPlan.findFirst({ where: { id: planId, tenantId } });
    if (!plan) throw new AppError(404, 'LESSON_PLAN_NOT_FOUND', 'Lesson plan not found');

    if (!actor.roles?.includes('TEACHER') || actor.sub !== plan.teacherUserId) {
      throw new AppError(403, 'FORBIDDEN', 'Only the owning teacher can submit this lesson plan');
    }

    if (!EDITABLE_STATUSES.includes(plan.status)) {
      throw new AppError(
        409,
        'LESSON_PLAN_NOT_SUBMITTABLE',
        'Only draft or rejected lesson plans can be submitted for review'
      );
    }

    const updated = await prisma.teacherLessonPlan.update({
      where: { id: planId },
      data: { status: 'SUBMITTED' },
      include: this.planInclude,
    });

    await this.recordRevision(tenantId, planId, actor.sub, 'SUBMITTED', updated);

    return this.mapPlan(updated);
  }

  async review(tenantId: string, planId: string, input: ReviewLessonPlanInput, actor: JwtUser) {
    if (!actor.roles?.includes('SCHOOL_ADMIN') && !actor.roles?.includes('SUPER_ADMIN')) {
      throw new AppError(403, 'FORBIDDEN', 'Only school admins can approve or reject lesson plans');
    }

    const plan = await prisma.teacherLessonPlan.findFirst({ where: { id: planId, tenantId } });
    if (!plan) throw new AppError(404, 'LESSON_PLAN_NOT_FOUND', 'Lesson plan not found');

    if (plan.status !== 'SUBMITTED') {
      throw new AppError(409, 'LESSON_PLAN_NOT_UNDER_REVIEW', 'This lesson plan is not awaiting review');
    }

    const updated = await prisma.teacherLessonPlan.update({
      where: { id: planId },
      data: {
        status: input.decision,
        ...(input.note !== undefined && { feedback: input.note }),
      },
      include: this.planInclude,
    });

    await this.recordRevision(tenantId, planId, actor.sub, input.decision, updated, input.note);

    return this.mapPlan(updated);
  }

  async delete(tenantId: string, planId: string, actor: JwtUser) {
    const plan = await prisma.teacherLessonPlan.findFirst({ where: { id: planId, tenantId } });
    if (!plan) throw new AppError(404, 'LESSON_PLAN_NOT_FOUND', 'Lesson plan not found');

    this.ensureTeacherOwnsPlan(plan.teacherUserId, actor);

    if (plan.status !== 'DRAFT') {
      throw new AppError(
        409,
        'LESSON_PLAN_NOT_DELETABLE',
        'Only draft lesson plans can be deleted. Submitted plans are kept for the review record.'
      );
    }

    await prisma.teacherLessonPlan.delete({ where: { id: planId } });
    return { deleted: true };
  }

  async addFeedback(tenantId: string, planId: string, input: LessonPlanFeedbackInput, actor: JwtUser) {
    if (!actor.roles?.includes('SCHOOL_ADMIN') && !actor.roles?.includes('SUPER_ADMIN')) {
      throw new AppError(403, 'FORBIDDEN', 'Only school admins can add feedback');
    }

    const plan = await prisma.teacherLessonPlan.findFirst({ where: { id: planId, tenantId } });
    if (!plan) throw new AppError(404, 'LESSON_PLAN_NOT_FOUND', 'Lesson plan not found');

    const updated = await prisma.teacherLessonPlan.update({
      where: { id: planId },
      data: { feedback: input.feedback },
      include: this.planInclude,
    });

    await this.recordRevision(tenantId, planId, actor.sub, 'RECOMMENDATION', updated, input.feedback);

    return this.mapPlan(updated);
  }

  async listRevisions(tenantId: string, planId: string, actor: JwtUser) {
    const plan = await prisma.teacherLessonPlan.findFirst({ where: { id: planId, tenantId } });
    if (!plan) throw new AppError(404, 'LESSON_PLAN_NOT_FOUND', 'Lesson plan not found');

    this.ensureCanViewPlan(plan.teacherUserId, actor);

    const revisions = await prisma.teacherLessonPlanRevision.findMany({
      where: { tenantId, planId },
      include: {
        actor: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return revisions.map(r => ({
      id: r.id,
      action: r.action,
      note: r.note,
      snapshot: r.snapshot,
      createdAt: r.createdAt,
      actor: r.actor,
    }));
  }

  async list(tenantId: string, query: ListLessonPlansQueryInput, actor: JwtUser) {
    const where: any = { tenantId };

    if (actor.roles?.includes('TEACHER') && !actor.roles?.includes('SCHOOL_ADMIN') && !actor.roles?.includes('SUPER_ADMIN')) {
      where.teacherUserId = actor.sub;
    }
    if (query.academicYearId) where.academicYearId = query.academicYearId;
    if (query.classRoomId) where.classRoomId = query.classRoomId;
    if (query.subjectId) where.subjectId = query.subjectId;
    if (query.teacherUserId) where.teacherUserId = query.teacherUserId;
    if (query.status) where.status = query.status;

    const skip = (query.page - 1) * query.pageSize;
    const [totalItems, items] = await prisma.$transaction([
      prisma.teacherLessonPlan.count({ where }),
      prisma.teacherLessonPlan.findMany({
        where,
        skip,
        take: query.pageSize,
        include: this.planInclude,
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    return {
      items: items.map(p => this.mapPlan(p)),
      pagination: buildPagination(query.page, query.pageSize, totalItems),
    };
  }

  private ensureTeacherOwnsPlan(teacherUserId: string, actor: JwtUser) {
    if (actor.roles?.includes('TEACHER') && actor.sub === teacherUserId) return;
    throw new AppError(403, 'FORBIDDEN', 'You can only manage your own lesson plans');
  }

  private ensureCanViewPlan(teacherUserId: string, actor: JwtUser) {
    if (actor.roles?.includes('SCHOOL_ADMIN') || actor.roles?.includes('SUPER_ADMIN')) return;
    if (actor.roles?.includes('TEACHER') && actor.sub === teacherUserId) return;
    throw new AppError(403, 'FORBIDDEN', 'You do not have access to this lesson plan');
  }

  private async recordRevision(
    tenantId: string,
    planId: string,
    actorUserId: string,
    action: 'CREATED' | 'UPDATED' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'RECOMMENDATION',
    snapshotSource: {
      title: string;
      objectives: string | null;
      materials: string | null;
      activities: string | null;
      assessment: string | null;
      feedback: string | null;
      status: string;
      weekNumber: number | null;
      durationMinutes: number | null;
    },
    note?: string
  ) {
    await prisma.teacherLessonPlanRevision.create({
      data: {
        tenantId,
        planId,
        actorUserId,
        action,
        note: note ?? null,
        snapshot: {
          title: snapshotSource.title,
          objectives: snapshotSource.objectives,
          materials: snapshotSource.materials,
          activities: snapshotSource.activities,
          assessment: snapshotSource.assessment,
          feedback: snapshotSource.feedback,
          status: snapshotSource.status,
          weekNumber: snapshotSource.weekNumber,
          durationMinutes: snapshotSource.durationMinutes,
        },
      },
    });
  }

  private planInclude = {
    teacherUser: { select: { id: true, firstName: true, lastName: true, email: true } },
    academicYear: { select: { id: true, name: true } },
    classRoom: { select: { id: true, code: true, name: true } },
    subject: { select: { id: true, code: true, name: true } },
  } as const;

  private mapPlan(p: any) {
    return {
      id: p.id,
      title: p.title,
      objectives: p.objectives,
      materials: p.materials,
      activities: p.activities,
      assessment: p.assessment,
      feedback: p.feedback,
      status: p.status,
      weekNumber: p.weekNumber,
      durationMinutes: p.durationMinutes,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      teacher: p.teacherUser,
      academicYear: p.academicYear,
      classRoom: p.classRoom,
      subject: p.subject,
    };
  }
}
