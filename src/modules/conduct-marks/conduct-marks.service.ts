import { AppError } from '../../common/errors/app-error';
import { JwtUser, RequestAuditContext } from '../../common/types/auth.types';
import { buildPagination } from '../../common/utils/pagination';
import { AUDIT_EVENT } from '../../constants/audit-events';
import { prisma } from '../../db/prisma';
import { AuditService } from '../audit/audit.service';
import { loadTermConductNumbersMap } from './conduct-marks.helpers';
import type {
  CreateDeductionBodyInput,
  ListStudentDeductionsQueryInput,
  StudentConductSummaryQueryInput,
  TermSettingsQueryInput,
} from './conduct-marks.schemas';

export class ConductMarksService {
  private readonly auditService = new AuditService();

  private isTeacherOnly(actor: JwtUser) {
    return actor.roles.includes('TEACHER') && !actor.roles.includes('SUPER_ADMIN') && !actor.roles.includes('SCHOOL_ADMIN');
  }

  private async assertTeachesClass(
    tenantId: string,
    academicYearId: string,
    classRoomId: string,
    actor: JwtUser,
  ) {
    if (actor.roles.includes('SUPER_ADMIN') || actor.roles.includes('SCHOOL_ADMIN')) {
      return;
    }
    const course = await prisma.course.findFirst({
      where: {
        tenantId,
        academicYearId,
        classRoomId,
        teacherUserId: actor.sub,
        isActive: true,
      },
      select: { id: true },
    });
    if (!course) {
      throw new AppError(
        403,
        'CONDUCT_CLASS_FORBIDDEN',
        'You are not assigned to teach this class for this academic year',
      );
    }
  }

  private async assertResultsUnlocked(tenantId: string, termId: string, classRoomId: string) {
    const existing = await prisma.resultSnapshot.findFirst({
      where: { tenantId, termId, classRoomId },
      select: { id: true },
    });
    if (existing) {
      throw new AppError(
        409,
        'RESULTS_LOCKED',
        'Results are locked for this term and class. Unlock before recording conduct deductions',
      );
    }
  }

  async listTermSettings(tenantId: string, query: TermSettingsQueryInput) {
    const year = await prisma.academicYear.findFirst({
      where: { id: query.academicYearId, tenantId, isActive: true },
      select: { id: true, name: true },
    });
    if (!year) {
      throw new AppError(404, 'ACADEMIC_YEAR_NOT_FOUND', 'Academic year not found');
    }

    const terms = await prisma.term.findMany({
      where: { tenantId, academicYearId: query.academicYearId, isActive: true },
      orderBy: { sequence: 'asc' },
      select: { id: true, name: true, sequence: true },
    });

    const settings = await prisma.conductTermSetting.findMany({
      where: { tenantId, termId: { in: terms.map((t) => t.id) } },
      select: { termId: true, totalMarks: true, updatedAt: true },
    });
    const byTerm = new Map(settings.map((s) => [s.termId, s]));

    return {
      academicYear: year,
      terms: terms.map((t) => ({
        ...t,
        totalMarks: byTerm.get(t.id)?.totalMarks ?? null,
        settingUpdatedAt: byTerm.get(t.id)?.updatedAt ?? null,
      })),
    };
  }

  async upsertTermSetting(
    tenantId: string,
    termId: string,
    totalMarks: number,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const term = await prisma.term.findFirst({
      where: { id: termId, tenantId, isActive: true },
      select: { id: true, name: true, academicYearId: true },
    });
    if (!term) {
      throw new AppError(404, 'TERM_NOT_FOUND', 'Term not found');
    }

    const row = await prisma.conductTermSetting.upsert({
      where: { tenantId_termId: { tenantId, termId } },
      create: {
        tenantId,
        termId,
        totalMarks,
        updatedByUserId: actor.sub,
      },
      update: {
        totalMarks,
        updatedByUserId: actor.sub,
      },
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.CONDUCT_TERM_SETTING_UPDATED,
      entity: 'ConductTermSetting',
      entityId: row.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: { termId, totalMarks },
    });

    return { termId: row.termId, totalMarks: row.totalMarks, updatedAt: row.updatedAt };
  }

  async createDeduction(
    tenantId: string,
    input: CreateDeductionBodyInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    await this.assertResultsUnlocked(tenantId, input.termId, input.classRoomId);
    await this.assertTeachesClass(tenantId, input.academicYearId, input.classRoomId, actor);

    const [term, enrollment] = await Promise.all([
      prisma.term.findFirst({
        where: { id: input.termId, tenantId, isActive: true },
        select: { id: true, academicYearId: true },
      }),
      prisma.studentEnrollment.findFirst({
        where: {
          tenantId,
          academicYearId: input.academicYearId,
          classRoomId: input.classRoomId,
          studentId: input.studentId,
          isActive: true,
          student: { deletedAt: null, isActive: true },
        },
        select: { id: true },
      }),
    ]);

    if (!term || term.academicYearId !== input.academicYearId) {
      throw new AppError(400, 'CONDUCT_TERM_YEAR_MISMATCH', 'Term does not belong to the given academic year');
    }
    if (!enrollment) {
      throw new AppError(400, 'CONDUCT_STUDENT_NOT_IN_CLASS', 'Student is not actively enrolled in this class');
    }

    const classRoom = await prisma.classRoom.findFirst({
      where: { id: input.classRoomId, tenantId, isActive: true },
      select: { id: true },
    });
    if (!classRoom) {
      throw new AppError(404, 'CLASS_ROOM_NOT_FOUND', 'Class not found');
    }

    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();

    const created = await prisma.conductDeduction.create({
      data: {
        tenantId,
        academicYearId: input.academicYearId,
        termId: input.termId,
        classRoomId: input.classRoomId,
        studentId: input.studentId,
        pointsDeducted: input.pointsDeducted,
        reason: input.reason.trim(),
        occurredAt,
        recordedByUserId: actor.sub,
      },
      include: {
        term: { select: { id: true, name: true } },
        classRoom: { select: { id: true, code: true, name: true } },
        student: { select: { id: true, studentCode: true, firstName: true, lastName: true } },
        recordedByUser: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.CONDUCT_DEDUCTION_CREATED,
      entity: 'ConductDeduction',
      entityId: created.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        studentId: input.studentId,
        classRoomId: input.classRoomId,
        academicYearId: input.academicYearId,
        termId: input.termId,
        pointsDeducted: input.pointsDeducted,
        reason: input.reason.trim(),
        occurredAt: occurredAt.toISOString(),
      },
    });

    return created;
  }

  private async assertTeacherCanAccessStudent(tenantId: string, studentId: string, actor: JwtUser) {
    if (!this.isTeacherOnly(actor)) {
      return;
    }
    const shared = await prisma.studentEnrollment.findFirst({
      where: {
        tenantId,
        studentId,
        isActive: true,
        classRoom: {
          courses: { some: { tenantId, teacherUserId: actor.sub, isActive: true } },
        },
      },
      select: { id: true },
    });
    if (!shared) {
      throw new AppError(
        403,
        'CONDUCT_HISTORY_FORBIDDEN',
        'You can only view conduct data for students in your classes',
      );
    }
  }

  async listDeductionsForStudent(
    tenantId: string,
    studentId: string,
    query: ListStudentDeductionsQueryInput,
    actor: JwtUser,
  ) {
    const student = await prisma.student.findFirst({
      where: { id: studentId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!student) {
      throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student not found');
    }

    await this.assertTeacherCanAccessStudent(tenantId, studentId, actor);

    const where = {
      tenantId,
      studentId,
      ...(query.termId ? { termId: query.termId } : {}),
    };

    const [total, rows] = await prisma.$transaction([
      prisma.conductDeduction.count({ where }),
      prisma.conductDeduction.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          term: { select: { id: true, name: true, sequence: true } },
          academicYear: { select: { id: true, name: true } },
          classRoom: { select: { id: true, code: true, name: true } },
          recordedByUser: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        pointsDeducted: r.pointsDeducted,
        reason: r.reason,
        occurredAt: r.occurredAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
        term: r.term,
        academicYear: r.academicYear,
        classRoom: r.classRoom,
        recordedBy: r.recordedByUser,
      })),
      pagination: buildPagination(query.page, query.pageSize, total),
    };
  }

  /** Snapshot of computed conduct per term for profile / admin UI. */
  async getStudentConductSummaryByTerm(
    tenantId: string,
    studentId: string,
    query: StudentConductSummaryQueryInput,
    actor: JwtUser,
  ) {
    const { academicYearId } = query;
    const student = await prisma.student.findFirst({
      where: { id: studentId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!student) {
      throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student not found');
    }

    await this.assertTeacherCanAccessStudent(tenantId, studentId, actor);

    const enrollment = await prisma.studentEnrollment.findFirst({
      where: {
        tenantId,
        studentId,
        academicYearId,
        isActive: true,
        ...(this.isTeacherOnly(actor)
          ? {
              classRoom: {
                courses: {
                  some: {
                    tenantId,
                    academicYearId,
                    teacherUserId: actor.sub,
                    isActive: true,
                  },
                },
              },
            }
          : {}),
      },
      select: { classRoomId: true },
      orderBy: { createdAt: 'asc' },
    });
    const classRoomId = enrollment?.classRoomId;
    if (!classRoomId) {
      return {
        academicYearId,
        classRoomId: null as string | null,
        terms: [] as Array<{ termId: string; termName: string; finalScore: number; totalMarks: number; grade: string }>,
      };
    }

    const terms = await prisma.term.findMany({
      where: { tenantId, academicYearId, isActive: true },
      orderBy: { sequence: 'asc' },
      select: { id: true, name: true },
    });

    const nums = await Promise.all(
      terms.map(async (t) => {
        const m = await loadTermConductNumbersMap({
          tenantId,
          academicYearId,
          termId: t.id,
          classRoomId,
          studentIds: [studentId],
        });
        const n = m.get(studentId);
        return {
          termId: t.id,
          termName: t.name,
          finalScore: n?.finalScore ?? 0,
          totalMarks: n?.totalMarks ?? 0,
          grade: n ? `${n.finalScore}/${n.totalMarks}` : '0/0',
        };
      }),
    );

    return { academicYearId, classRoomId, terms: nums };
  }
}
