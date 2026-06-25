import { JwtUser, RequestAuditContext } from '../../common/types/auth.types';
import { AppError } from '../../common/errors/app-error';
import { buildPagination } from '../../common/utils/pagination';
import { prisma } from '../../db/prisma';
import { CreateLessonPlanInput, UpdateLessonPlanInput, LessonPlanFeedbackInput, ListLessonPlansQueryInput } from './lesson-plans.schemas';

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

    return this.mapPlan(created);
  }

  async update(tenantId: string, planId: string, input: UpdateLessonPlanInput, actor: JwtUser) {
    const plan = await prisma.teacherLessonPlan.findFirst({ where: { id: planId, tenantId } });
    if (!plan) throw new AppError(404, 'LESSON_PLAN_NOT_FOUND', 'Lesson plan not found');

    this.ensureTeacherOwnsPlan(plan.teacherUserId, actor);

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
        ...(input.status !== undefined && { status: input.status }),
      },
      include: this.planInclude,
    });

    return this.mapPlan(updated);
  }

  async delete(tenantId: string, planId: string, actor: JwtUser) {
    const plan = await prisma.teacherLessonPlan.findFirst({ where: { id: planId, tenantId } });
    if (!plan) throw new AppError(404, 'LESSON_PLAN_NOT_FOUND', 'Lesson plan not found');

    this.ensureTeacherOwnsPlan(plan.teacherUserId, actor);

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

    return this.mapPlan(updated);
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
    if (actor.roles?.includes('SCHOOL_ADMIN') || actor.roles?.includes('SUPER_ADMIN')) return;
    if (actor.roles?.includes('TEACHER') && actor.sub === teacherUserId) return;
    throw new AppError(403, 'FORBIDDEN', 'You can only manage your own lesson plans');
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
