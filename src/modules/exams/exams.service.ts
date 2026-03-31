import { MarkStatus, Prisma, ResultSnapshotStatus } from '@prisma/client';

import { env } from '../../config/env';
import { AppError } from '../../common/errors/app-error';
import { JwtUser, RequestAuditContext } from '../../common/types/auth.types';
import { buildPagination } from '../../common/utils/pagination';
import { AUDIT_EVENT } from '../../constants/audit-events';
import { prisma } from '../../db/prisma';
import { AuditService } from '../audit/audit.service';
import {
  BulkConductGradesInput,
  BulkExamMarksInput,
  ConductGradesQueryInput,
  CreateExamInput,
  CreateGradingSchemeInput,
  ListExamsQueryInput,
  MarksGridQueryInput,
  MarksGridSaveInput,
  ParentReportCardsQueryInput,
  MyExamScheduleQueryInput,
  ReportCardsQueryInput,
  ResultsActionInput,
} from './exams.schemas';
import { buildReportCardPdfBuffer, type ReportCardPayload } from './report-card-pdf';
import {
  buildYearlyReportCardSubjects,
  isYearlyAggregationTerm,
  type ExamForTermRollup,
} from './yearly-report-payload';

type GradingBand = {
  min: number;
  max: number;
  grade: string;
  remark?: string;
};

export class ExamsService {
  private readonly auditService = new AuditService();

  async listGradingSchemes(tenantId: string) {
    const items = await prisma.gradingScheme.findMany({
      where: {
        tenantId,
        isActive: true,
      },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }, { version: 'desc' }],
    });

    return items.map((item) => this.mapGradingScheme(item));
  }

  async createGradingScheme(
    tenantId: string,
    input: CreateGradingSchemeInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const rules = this.normalizeGradingRules(input.rules as GradingBand[]);
    const current = await prisma.gradingScheme.findFirst({
      where: {
        tenantId,
        name: input.name,
      },
      orderBy: [{ version: 'desc' }],
      select: { version: true },
    });

    const created = await prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.gradingScheme.updateMany({
          where: { tenantId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.gradingScheme.create({
        data: {
          tenantId,
          name: input.name,
          version: (current?.version ?? 0) + 1,
          description: input.description,
          rules,
          isDefault: input.isDefault,
          createdByUserId: actor.sub,
          updatedByUserId: actor.sub,
        },
      });
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.GRADING_SCHEME_CREATED,
      entity: 'GradingScheme',
      entityId: created.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: { name: created.name, version: created.version, isDefault: created.isDefault },
    });

    return this.mapGradingScheme(created);
  }

  async createExam(
    tenantId: string,
    input: CreateExamInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const term = await prisma.term.findFirst({
      where: { id: input.termId, tenantId, isActive: true },
      include: { academicYear: { select: { id: true, name: true } } },
    });

    if (!term) {
      throw new AppError(404, 'TERM_NOT_FOUND', 'Term not found');
    }

    const classRoom = await prisma.classRoom.findFirst({
      where: { id: input.classRoomId, tenantId, isActive: true },
      select: { id: true, code: true, name: true },
    });
    if (!classRoom) {
      throw new AppError(404, 'CLASS_ROOM_NOT_FOUND', 'Class not found');
    }

    const subject = await prisma.subject.findFirst({
      where: { id: input.subjectId, tenantId, isActive: true },
      select: { id: true, code: true, name: true },
    });
    if (!subject) {
      throw new AppError(404, 'SUBJECT_NOT_FOUND', 'Subject not found');
    }

    const gradingScheme = await this.getGradingSchemeForUse(tenantId, input.gradingSchemeId);

    const course = await prisma.course.findFirst({
      where: {
        tenantId,
        academicYearId: term.academicYearId,
        classRoomId: input.classRoomId,
        subjectId: input.subjectId,
        isActive: true,
      },
      orderBy: [{ createdAt: 'asc' }],
      select: { id: true, teacherUserId: true },
    });

    if (!course && actor.roles.includes('TEACHER')) {
      throw new AppError(409, 'EXAM_SCOPE_COURSE_REQUIRED', 'Create the course before creating an exam for this class and subject');
    }

    const teacherUserId = course?.teacherUserId ?? actor.sub;
    this.ensureCanManageTeacherOwnedEntity(teacherUserId, actor);

    try {
      const created = await prisma.exam.create({
        data: {
          tenantId,
          academicYearId: term.academicYearId,
          termId: input.termId,
          classRoomId: input.classRoomId,
          subjectId: input.subjectId,
          gradingSchemeId: gradingScheme.id,
          teacherUserId,
          examType: input.examType ?? 'EXAM',
          name: input.name,
          description: input.description,
          totalMarks: input.totalMarks,
          weight: input.weight,
          examDate: input.examDate ? new Date(input.examDate) : null,
          createdByUserId: actor.sub,
          updatedByUserId: actor.sub,
        },
        include: this.examListInclude,
      });

      await this.auditService.log({
        tenantId,
        actorUserId: actor.sub,
        event: AUDIT_EVENT.EXAM_CREATED,
        entity: 'Exam',
        entityId: created.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        payload: {
          termId: input.termId,
          classRoomId: input.classRoomId,
          subjectId: input.subjectId,
          gradingSchemeId: gradingScheme.id,
        },
      });

      return {
        ...this.mapExamSummary(created),
        resultStatus: 'UNLOCKED' as const,
      };
    } catch (error) {
      this.handleUniqueError(error, 'Exam already exists for this term, class, and subject');
      throw error;
    }
  }

  async listExams(tenantId: string, query: ListExamsQueryInput, actor: JwtUser) {
    const where: Prisma.ExamWhereInput = {
      tenantId,
      isActive: true,
      ...(query.termId ? { termId: query.termId } : {}),
      ...(query.classId ? { classRoomId: query.classId } : {}),
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
    };

    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { subject: { name: { contains: query.q, mode: 'insensitive' } } },
        { classRoom: { name: { contains: query.q, mode: 'insensitive' } } },
      ];
    }

    if (this.isTeacherOnly(actor)) {
      where.teacherUserId = actor.sub;
    }

    const skip = (query.page - 1) * query.pageSize;
    const [totalItems, items] = await prisma.$transaction([
      prisma.exam.count({ where }),
      prisma.exam.findMany({
        where,
        skip,
        take: query.pageSize,
        include: this.examListInclude,
        orderBy: [{ createdAt: 'desc' }, { name: 'asc' }],
      }),
    ]);

    const statusRows = items.length
      ? await prisma.resultSnapshot.findMany({
          where: {
            tenantId,
            OR: items.map((item) => ({ termId: item.termId, classRoomId: item.classRoomId })),
          },
          select: {
            termId: true,
            classRoomId: true,
            status: true,
          },
        })
      : [];

    const statusByScope = new Map<string, 'LOCKED' | 'PUBLISHED'>();
    for (const row of statusRows) {
      const key = `${row.termId}:${row.classRoomId}`;
      const next = row.status === ResultSnapshotStatus.PUBLISHED ? 'PUBLISHED' : 'LOCKED';
      const current = statusByScope.get(key);
      if (!current || next === 'PUBLISHED') {
        statusByScope.set(key, next);
      }
    }

    return {
      items: items.map((item) => ({
        ...this.mapExamSummary(item),
        resultStatus: statusByScope.get(`${item.termId}:${item.classRoomId}`) ?? 'UNLOCKED',
      })),
      pagination: buildPagination(query.page, query.pageSize, totalItems),
    };
  }

  async getExamDetail(tenantId: string, examId: string, actor: JwtUser) {
    const exam = await this.getExamForRead(tenantId, examId, actor);
    const students = await this.getClassStudents(tenantId, exam.academicYearId, exam.classRoomId);
    const lockedSnapshot = await prisma.resultSnapshot.findFirst({
      where: { tenantId, termId: exam.termId, classRoomId: exam.classRoomId },
      select: { status: true },
    });
    const markByStudentId = new Map(exam.marks.map((mark: any) => [mark.studentId, mark]));

    return {
      ...this.mapExamSummary(exam),
      resultStatus: lockedSnapshot?.status === ResultSnapshotStatus.PUBLISHED ? 'PUBLISHED' : lockedSnapshot ? 'LOCKED' : 'UNLOCKED',
      students: students.map((student) => ({
        id: student.id,
        studentCode: student.studentCode,
        firstName: student.firstName,
        lastName: student.lastName,
        marksObtained: markByStudentId.get(student.id)?.marksObtained ?? null,
        status: markByStudentId.get(student.id)?.status ?? null,
      })),
      warnings: {
        missingCount: students.filter((student) => !this.isExamMarkComplete(markByStudentId.get(student.id))).length,
      },
    };
  }

  async bulkSaveMarks(
    tenantId: string,
    examId: string,
    input: BulkExamMarksInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const exam = await this.getExamForManage(tenantId, examId, actor);
    await this.ensureResultsUnlocked(tenantId, exam.termId, exam.classRoomId);

    const students = await this.getClassStudents(tenantId, exam.academicYearId, exam.classRoomId);
    const studentIds = new Set(students.map((student) => student.id));

    for (const entry of input.entries) {
      if (!studentIds.has(entry.studentId)) {
        throw new AppError(400, 'EXAM_MARK_STUDENT_INVALID', 'Student is not enrolled in this class for the exam academic year');
      }

      const status = entry.status ?? MarkStatus.PRESENT;
      if (entry.marksObtained != null && status !== MarkStatus.PRESENT) {
        throw new AppError(400, 'EXAM_MARK_STATUS_CONFLICT', 'Numeric marks require status PRESENT');
      }

      if (entry.marksObtained != null && entry.marksObtained > exam.totalMarks) {
        throw new AppError(400, 'EXAM_MARK_OUT_OF_RANGE', `Marks cannot exceed ${exam.totalMarks}`);
      }
    }

    const existingMarks = await prisma.examMark.findMany({
      where: { tenantId, examId },
      select: { id: true, studentId: true },
    });
    const existingByStudentId = new Map(existingMarks.map((mark) => [mark.studentId, mark]));

    await prisma.$transaction(async (tx) => {
      for (const entry of input.entries) {
        const existing = existingByStudentId.get(entry.studentId);
        const status = entry.status ?? MarkStatus.PRESENT;

        if (entry.marksObtained == null) {
          if (status === MarkStatus.ABSENT || status === MarkStatus.EXCUSED) {
            await tx.examMark.upsert({
              where: {
                tenantId_examId_studentId: {
                  tenantId,
                  examId,
                  studentId: entry.studentId,
                },
              },
              update: {
                marksObtained: null,
                status,
                updatedByUserId: actor.sub,
              },
              create: {
                tenantId,
                examId,
                studentId: entry.studentId,
                marksObtained: null,
                status,
                enteredByUserId: actor.sub,
                updatedByUserId: actor.sub,
              },
            });
          } else if (existing) {
            await tx.examMark.delete({ where: { id: existing.id } });
          }
          continue;
        }

        await tx.examMark.upsert({
          where: {
            tenantId_examId_studentId: {
              tenantId,
              examId,
              studentId: entry.studentId,
            },
          },
          update: {
            marksObtained: entry.marksObtained,
            status: MarkStatus.PRESENT,
            updatedByUserId: actor.sub,
          },
          create: {
            tenantId,
            examId,
            studentId: entry.studentId,
            marksObtained: entry.marksObtained,
            status: MarkStatus.PRESENT,
            enteredByUserId: actor.sub,
            updatedByUserId: actor.sub,
          },
        });
      }

      await tx.exam.update({
        where: { id: exam.id },
        data: { updatedByUserId: actor.sub },
      });
    });

    const refreshedMarks = await prisma.examMark.findMany({
      where: { tenantId, examId },
      select: { studentId: true, marksObtained: true, status: true },
    });
    const markByStudentId = new Map(refreshedMarks.map((mark) => [mark.studentId, mark]));
    const missingStudentIds = students
      .filter((student) => !this.isExamMarkComplete(markByStudentId.get(student.id)))
      .map((student) => student.id);

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.EXAM_MARKS_SAVED,
      entity: 'Exam',
      entityId: exam.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        entriesCount: input.entries.length,
        missingCount: missingStudentIds.length,
      },
    });

    return {
      exam: this.mapExamSummary(exam),
      savedCount: refreshedMarks.length,
      warnings: {
        missingCount: missingStudentIds.length,
        missingStudentIds,
      },
    };
  }

  async getMarksGrid(tenantId: string, query: MarksGridQueryInput, actor: JwtUser) {
    const scope = await this.getResultScope(tenantId, query.termId, query.classRoomId);
    let exams = await prisma.exam.findMany({
      where: {
        tenantId,
        termId: query.termId,
        classRoomId: query.classRoomId,
        isActive: true,
      },
      include: {
        subject: { select: { id: true, code: true, name: true } },
        marks: { select: { studentId: true, marksObtained: true, status: true } },
      },
    });

    if (this.isTeacherOnly(actor)) {
      const courses = await prisma.course.findMany({
        where: {
          tenantId,
          academicYearId: scope.academicYear.id,
          classRoomId: query.classRoomId,
          isActive: true,
          teacherUserId: actor.sub,
        },
        select: { subjectId: true },
      });
      const allowedSubjectIds = new Set(courses.map((c) => c.subjectId).filter(Boolean) as string[]);
      if (allowedSubjectIds.size > 0) {
        exams = exams.filter((e) => allowedSubjectIds.has(e.subjectId));
      }
    }

    const students = await this.getClassStudents(tenantId, scope.academicYear.id, query.classRoomId);

    const policies = await prisma.subjectAssessmentPolicy.findMany({
      where: { tenantId, termId: query.termId, classRoomId: query.classRoomId },
      select: { subjectId: true, continuousWeight: true, examWeight: true, passMark: true },
    });
    const policyBySubjectId = new Map(policies.map((p) => [p.subjectId, p]));

    const subjectMap = new Map<string, { id: string; code: string; name: string }>();
    const examsBySubjectId = new Map<string, typeof exams>();
    for (const exam of exams) {
      if (!subjectMap.has(exam.subjectId)) {
        subjectMap.set(exam.subjectId, { id: exam.subject.id, code: exam.subject.code, name: exam.subject.name });
      }
      if (!examsBySubjectId.has(exam.subjectId)) {
        examsBySubjectId.set(exam.subjectId, []);
      }
      examsBySubjectId.get(exam.subjectId)!.push(exam);
    }

    const subjectIds = Array.from(subjectMap.keys()).sort();
    const subjects = subjectIds.map((id) => subjectMap.get(id)!);

    const defaultPolicy = { continuousWeight: 40, examWeight: 60, passMark: 50 };

    const studentRows = students.map((student, index) => {
      const subjectMarks = subjectIds.map((subjectId) => {
        const list = examsBySubjectId.get(subjectId) ?? [];
        const caExams = list.filter((e) => e.examType === 'CAT').sort((a, b) => a.name.localeCompare(b.name));
        const termExams = list.filter((e) => e.examType === 'EXAM');
        const policy = policyBySubjectId.get(subjectId) ?? defaultPolicy;
        const cw = policy.continuousWeight;
        const ew = policy.examWeight;
        const wSum = cw + ew || 1;

        const pctFor = (exam: (typeof exams)[number], sid: string): number | null => {
          const m = exam.marks.find((mk) => mk.studentId === sid);
          if (!m || m.status !== MarkStatus.PRESENT || m.marksObtained == null) {
            return null;
          }
          return exam.totalMarks > 0 ? (m.marksObtained / exam.totalMarks) * 100 : 0;
        };

        const caParts = caExams.map((e) => pctFor(e, student.id)).filter((p): p is number => p != null);
        const caPct = caParts.length ? caParts.reduce((a, b) => a + b, 0) / caParts.length : null;

        const termParts = termExams.map((e) => pctFor(e, student.id)).filter((p): p is number => p != null);
        const examPct = termParts.length ? termParts.reduce((a, b) => a + b, 0) / termParts.length : null;

        const ca = caPct ?? 0;
        const te = examPct ?? 0;
        const hasCaEx = caExams.length > 0;
        const hasTermEx = termExams.length > 0;
        const hasAny = caPct != null || examPct != null;
        let total = 0;
        if (hasAny) {
          if (hasCaEx && hasTermEx) {
            total = (ca * cw + te * ew) / wSum;
          } else if (hasTermEx) {
            total = te;
          } else {
            total = ca;
          }
        }

        return {
          subjectId,
          testMarks: caPct != null ? Number(caPct.toFixed(2)) : null,
          examMarks: examPct != null ? Number(examPct.toFixed(2)) : null,
          total: hasAny ? Number(total.toFixed(2)) : 0,
        };
      });
      const rowTotal = subjectMarks.reduce((sum, s) => sum + s.total, 0);
      return {
        index: index + 1,
        studentId: student.id,
        studentCode: student.studentCode,
        firstName: student.firstName,
        lastName: student.lastName,
        subjectMarks,
        total: Number(rowTotal.toFixed(2)),
      };
    });

    const withRank = studentRows
      .map((r) => ({ ...r, rank: 0 }))
      .sort((a, b) => b.total - a.total);
    let rank = 1;
    for (const r of withRank) {
      r.rank = rank++;
    }

    const resultsLocked = await prisma.resultSnapshot.findFirst({
      where: {
        tenantId,
        termId: query.termId,
        classRoomId: query.classRoomId,
      },
      select: { id: true },
    });

    return {
      academicYear: scope.academicYear,
      term: scope.term,
      classRoom: scope.classRoom,
      subjects,
      students: withRank,
      marksEditable: !resultsLocked,
    };
  }

  async saveMarksGrid(
    tenantId: string,
    input: MarksGridSaveInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    await this.getResultScope(tenantId, input.termId, input.classRoomId);
    await this.ensureResultsUnlocked(tenantId, input.termId, input.classRoomId);

    const term = await prisma.term.findFirst({
      where: { id: input.termId, tenantId, isActive: true },
      include: { academicYear: true },
    });
    if (!term) throw new AppError(404, 'TERM_NOT_FOUND', 'Term not found');

    const defaultScheme = await this.getGradingSchemeForUse(tenantId);
    const existingExams = await prisma.exam.findMany({
      where: {
        tenantId,
        termId: input.termId,
        classRoomId: input.classRoomId,
        isActive: true,
      },
      select: { id: true, subjectId: true, examType: true, totalMarks: true },
    });
    const examKey = (subjectId: string, type: 'CAT' | 'EXAM') =>
      existingExams.find((e) => e.subjectId === subjectId && e.examType === type)?.id;

    const toUpsert: Array<{ examId: string; studentId: string; marksObtained: number }> = [];
    const needCreate: Array<{ subjectId: string; examType: 'CAT' | 'EXAM' }> = [];
    const createdExamIds: string[] = [];

    for (const entry of input.entries) {
      const testVal = entry.testMarks ?? null;
      const examVal = entry.examMarks ?? null;
      const catExams = existingExams.filter((e) => e.subjectId === entry.subjectId && e.examType === 'CAT');
      const examExamId = examKey(entry.subjectId, 'EXAM');
      if (testVal != null && catExams.length === 0) {
        needCreate.push({ subjectId: entry.subjectId, examType: 'CAT' });
      }
      if (examVal != null && !examExamId) {
        needCreate.push({ subjectId: entry.subjectId, examType: 'EXAM' });
      }
    }

    const uniqueCreate = Array.from(
      new Map(needCreate.map((n) => [`${n.subjectId}:${n.examType}`, n])).values(),
    );
    for (const { subjectId, examType } of uniqueCreate) {
      const subject = await prisma.subject.findFirst({
        where: { id: subjectId, tenantId, isActive: true },
        select: { id: true, name: true },
      });
      if (!subject) continue;
      const created = await prisma.exam.create({
        data: {
          tenantId,
          academicYearId: term.academicYearId,
          termId: input.termId,
          classRoomId: input.classRoomId,
          subjectId,
          gradingSchemeId: defaultScheme.id,
          examType,
          name: examType === 'CAT' ? 'Test' : 'Exam',
          totalMarks: 100,
          weight: 100,
          teacherUserId: actor.sub,
          createdByUserId: actor.sub,
          updatedByUserId: actor.sub,
        },
      });
      createdExamIds.push(created.id);
      if (examType === 'CAT') {
        existingExams.push({ id: created.id, subjectId, examType: 'CAT', totalMarks: 100 });
      } else {
        existingExams.push({ id: created.id, subjectId, examType: 'EXAM', totalMarks: 100 });
      }
    }

    for (const entry of input.entries) {
      const catExams = existingExams.filter((e) => e.subjectId === entry.subjectId && e.examType === 'CAT');
      const examExam = existingExams.find((e) => e.subjectId === entry.subjectId && e.examType === 'EXAM');

      if (entry.testMarks != null) {
        for (const ce of catExams) {
          const scaled = Math.round((entry.testMarks * ce.totalMarks) / 100);
          const marksObtained = Math.min(Math.max(0, scaled), ce.totalMarks);
          toUpsert.push({ examId: ce.id, studentId: entry.studentId, marksObtained });
        }
      }

      if (entry.examMarks != null && examExam) {
        const scaled = Math.round((entry.examMarks * examExam.totalMarks) / 100);
        const marksObtained = Math.min(Math.max(0, scaled), examExam.totalMarks);
        toUpsert.push({ examId: examExam.id, studentId: entry.studentId, marksObtained });
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const u of toUpsert) {
        await tx.examMark.upsert({
          where: {
            tenantId_examId_studentId: {
              tenantId,
              examId: u.examId,
              studentId: u.studentId,
            },
          },
          update: {
            marksObtained: u.marksObtained,
            status: MarkStatus.PRESENT,
            updatedByUserId: actor.sub,
          },
          create: {
            tenantId,
            examId: u.examId,
            studentId: u.studentId,
            marksObtained: u.marksObtained,
            status: MarkStatus.PRESENT,
            enteredByUserId: actor.sub,
            updatedByUserId: actor.sub,
          },
        });
      }
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.EXAM_MARKS_SAVED,
      entity: 'Exam',
      entityId: input.classRoomId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: { termId: input.termId, entriesCount: input.entries.length },
    });

    return { savedCount: toUpsert.length, createdExamsCount: uniqueCreate.length };
  }

  async listConductGradesForEntry(
    tenantId: string,
    query: ConductGradesQueryInput,
    actor: JwtUser,
  ) {
    this.ensureAdmin(actor);
    const scope = await this.getResultScope(tenantId, query.termId, query.classRoomId);
    const students = await this.getClassStudents(tenantId, scope.academicYear.id, query.classRoomId);
    const conductGrades = await prisma.conductGrade.findMany({
      where: {
        tenantId,
        termId: query.termId,
        classRoomId: query.classRoomId,
      },
      select: { studentId: true, grade: true, remark: true },
    });
    const gradeByStudentId = new Map(conductGrades.map((g) => [g.studentId, { grade: g.grade, remark: g.remark }]));
    return {
      students: students.map((s) => ({
        id: s.id,
        studentCode: s.studentCode,
        firstName: s.firstName,
        lastName: s.lastName,
        grade: gradeByStudentId.get(s.id)?.grade ?? '',
        remark: gradeByStudentId.get(s.id)?.remark ?? '',
      })),
    };
  }

  async bulkSaveConductGrades(
    tenantId: string,
    input: BulkConductGradesInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    this.ensureAdmin(actor);
    const scope = await this.getResultScope(tenantId, input.termId, input.classRoomId);

    const existing = await prisma.resultSnapshot.count({
      where: {
        tenantId,
        termId: input.termId,
        classRoomId: input.classRoomId,
      },
    });
    if (existing > 0) {
      throw new AppError(409, 'RESULTS_ALREADY_LOCKED', 'Results are locked. Unlock first to edit conduct grades');
    }

    const students = await this.getClassStudents(tenantId, scope.academicYear.id, input.classRoomId);
    const studentIds = new Set(students.map((s) => s.id));
    for (const entry of input.entries) {
      if (!studentIds.has(entry.studentId)) {
        throw new AppError(400, 'CONDUCT_STUDENT_NOT_IN_CLASS', `Student ${entry.studentId} is not in this class`);
      }
    }

    let savedCount = 0;
    await prisma.$transaction(async (tx) => {
      for (const entry of input.entries) {
        await tx.conductGrade.upsert({
          where: {
            tenantId_termId_classRoomId_studentId: {
              tenantId,
              termId: input.termId,
              classRoomId: input.classRoomId,
              studentId: entry.studentId,
            },
          },
          update: {
            grade: entry.grade,
            remark: entry.remark ?? null,
            updatedByUserId: actor.sub,
          },
          create: {
            tenantId,
            academicYearId: scope.academicYear.id,
            termId: input.termId,
            classRoomId: input.classRoomId,
            studentId: entry.studentId,
            grade: entry.grade,
            remark: entry.remark ?? null,
            createdByUserId: actor.sub,
            updatedByUserId: actor.sub,
          },
        });
        savedCount += 1;
      }
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.EXAM_MARKS_SAVED,
      entity: 'ConductGrade',
      entityId: `${input.termId}:${input.classRoomId}`,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: { entriesCount: input.entries.length },
    });

    return { savedCount };
  }

  async lockResults(
    tenantId: string,
    input: ResultsActionInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    this.ensureAdmin(actor);
    const scope = await this.getResultScope(tenantId, input.termId, input.classRoomId);

    const existing = await prisma.resultSnapshot.count({
      where: {
        tenantId,
        termId: input.termId,
        classRoomId: input.classRoomId,
      },
    });
    if (existing > 0) {
      throw new AppError(409, 'RESULTS_ALREADY_LOCKED', 'Results are already locked for this term and class. Unlock first to make changes');
    }

    const gradingScheme = await this.getGradingSchemeForUse(tenantId, input.gradingSchemeId);

    const termMeta = await prisma.term.findFirst({
      where: { id: input.termId, tenantId },
      select: { id: true, name: true, sequence: true, academicYearId: true },
    });
    if (termMeta && isYearlyAggregationTerm(termMeta)) {
      return this.lockYearlyResults(
        tenantId,
        input,
        actor,
        context,
        scope,
        termMeta,
        gradingScheme,
      );
    }

    const exams = await prisma.exam.findMany({
      where: {
        tenantId,
        termId: input.termId,
        classRoomId: input.classRoomId,
        isActive: true,
      },
      include: {
        subject: { select: { id: true, name: true, code: true } },
        teacherUser: { select: { firstName: true, lastName: true } },
        marks: { select: { studentId: true, marksObtained: true, status: true } },
      },
      orderBy: [{ subject: { name: 'asc' } }, { name: 'asc' }],
    });

    if (!exams.length) {
      throw new AppError(409, 'RESULTS_NO_EXAMS', 'Create at least one exam before locking results');
    }

    const students = await this.getClassStudents(tenantId, scope.academicYear.id, input.classRoomId);
    if (!students.length) {
      throw new AppError(409, 'RESULTS_NO_STUDENTS', 'No active students found in this class and academic year');
    }

    const subjectIds = [...new Set(exams.map((e) => e.subjectId))];
    const policies = await prisma.subjectAssessmentPolicy.findMany({
      where: {
        tenantId,
        termId: input.termId,
        classRoomId: input.classRoomId,
        subjectId: { in: subjectIds },
      },
    });
    const policyBySubjectId = new Map(policies.map((p) => [p.subjectId, p]));

    const missing: Array<{ examId: string; studentId: string }> = [];
    for (const exam of exams) {
      const markByStudent = new Map(exam.marks.map((mark) => [mark.studentId, mark]));
      for (const student of students) {
        if (!this.isExamMarkComplete(markByStudent.get(student.id))) {
          missing.push({ examId: exam.id, studentId: student.id });
        }
      }
    }

    if (missing.length) {
      throw new AppError(409, 'RESULTS_MARKS_INCOMPLETE', 'Some students are still missing marks for one or more exams', {
        missingCount: missing.length,
        missing: missing.slice(0, 20),
      });
    }

    const conductByStudentId = await this.getConductGradesForScope(
      tenantId,
      scope.academicYear.id,
      input.termId,
      input.classRoomId,
    );

    const draftSnapshots = students.map((student) =>
      this.buildStudentSnapshot({
        schoolName: scope.schoolName,
        school: scope.school,
        academicYear: scope.academicYear,
        term: scope.term,
        classRoom: scope.classRoom,
        student,
        exams,
        gradingScheme,
        policyBySubjectId,
        conduct: conductByStudentId.get(student.id),
      }),
    );

    const ranking = draftSnapshots
      .slice()
      .sort((a, b) => b.payload.totals.averagePercentage - a.payload.totals.averagePercentage)
      .map((item, index) => ({ studentId: item.studentId, position: index + 1 }));
    const rankByStudentId = new Map(ranking.map((item) => [item.studentId, item.position]));
    const classSize = draftSnapshots.length;

    const lockedAt = new Date();
    const created = await prisma.$transaction(async (tx) => {
      for (const item of draftSnapshots) {
        const payload: ReportCardPayload = {
          ...item.payload,
          totals: {
            ...item.payload.totals,
            position: rankByStudentId.get(item.studentId) ?? classSize,
            classSize,
          },
        };

        await tx.resultSnapshot.create({
          data: {
            tenantId,
            academicYearId: scope.academicYear.id,
            termId: scope.term.id,
            classRoomId: scope.classRoom.id,
            studentId: item.studentId,
            gradingSchemeId: gradingScheme.id,
            gradingSchemeVersion: gradingScheme.version,
            status: ResultSnapshotStatus.LOCKED,
            payload: payload as unknown as Prisma.InputJsonValue,
            lockedAt,
            lockedByUserId: actor.sub,
          },
        });
      }

      return draftSnapshots.length;
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.RESULTS_LOCKED,
      entity: 'ResultSnapshot',
      entityId: `${input.termId}:${input.classRoomId}`,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        termId: input.termId,
        classRoomId: input.classRoomId,
        createdSnapshots: created,
      },
    });

    return {
      status: 'LOCKED' as const,
      snapshotsCreated: created,
      classSize,
    };
  }

  /**
   * Yearly report cards: aggregate Term 1–3 (sequences 1–3) for the same class; snapshot is stored on the yearly term.
   */
  private async lockYearlyResults(
    tenantId: string,
    input: ResultsActionInput,
    actor: JwtUser,
    context: RequestAuditContext,
    scope: {
      term: { id: string; name: string };
      academicYear: { id: string; name: string };
      classRoom: { id: string; code: string; name: string };
      school: {
        displayName: string;
        code: string | null;
        registrationNumber: string | null;
        email: string | null;
        phone: string | null;
        district: string | null;
        country: string | null;
        logoUrl?: string | null;
      };
      schoolName: string;
    },
    termMeta: { id: string; name: string; sequence: number; academicYearId: string },
    gradingScheme: {
      id: string;
      name: string;
      version: number;
      rules: Prisma.JsonValue;
    },
  ) {
    const teachingTerms = await prisma.term.findMany({
      where: {
        tenantId,
        academicYearId: termMeta.academicYearId,
        sequence: { in: [1, 2, 3] },
        isActive: true,
      },
      orderBy: { sequence: 'asc' },
      select: { id: true, name: true, sequence: true },
    });

    if (teachingTerms.length < 3) {
      throw new AppError(
        409,
        'RESULTS_YEARLY_TERMS_INCOMPLETE',
        'Yearly aggregation requires Term 1, Term 2, and Term 3 (sequences 1–3) in the same academic year.',
      );
    }

    const examsByTerm = await Promise.all(
      teachingTerms.map((t) =>
        prisma.exam.findMany({
          where: {
            tenantId,
            termId: t.id,
            classRoomId: input.classRoomId,
            isActive: true,
          },
          include: {
            subject: { select: { id: true, name: true, code: true } },
            teacherUser: { select: { firstName: true, lastName: true } },
            marks: { select: { studentId: true, marksObtained: true, status: true } },
          },
          orderBy: [{ subject: { name: 'asc' } }, { name: 'asc' }],
        }),
      ),
    );

    for (let i = 0; i < examsByTerm.length; i += 1) {
      if (!examsByTerm[i].length) {
        throw new AppError(
          409,
          'RESULTS_YEARLY_NO_EXAMS',
          `Teaching term ${teachingTerms[i].name} (sequence ${teachingTerms[i].sequence}) has no exams for this class. Create exams for all three teaching terms before locking yearly results.`,
        );
      }
    }

    const students = await this.getClassStudents(tenantId, scope.academicYear.id, input.classRoomId);
    if (!students.length) {
      throw new AppError(409, 'RESULTS_NO_STUDENTS', 'No active students found in this class and academic year');
    }

    const subjectIds = new Set<string>();
    for (const list of examsByTerm) {
      for (const e of list) {
        subjectIds.add(e.subjectId);
      }
    }

    const policies = await prisma.subjectAssessmentPolicy.findMany({
      where: {
        tenantId,
        classRoomId: input.classRoomId,
        termId: { in: teachingTerms.map((t) => t.id) },
        subjectId: { in: [...subjectIds] },
      },
    });
    const policyByTermAndSubject = new Map(
      policies.map((p) => [
        `${p.termId}:${p.subjectId}`,
        {
          continuousWeight: p.continuousWeight,
          examWeight: p.examWeight,
          passMark: p.passMark,
        },
      ]),
    );

    const missing: Array<{ examId: string; studentId: string }> = [];
    for (const exam of examsByTerm.flat()) {
      const markByStudent = new Map(exam.marks.map((mark) => [mark.studentId, mark]));
      for (const student of students) {
        if (!this.isExamMarkComplete(markByStudent.get(student.id))) {
          missing.push({ examId: exam.id, studentId: student.id });
        }
      }
    }
    if (missing.length) {
      throw new AppError(409, 'RESULTS_MARKS_INCOMPLETE', 'Some students are still missing marks for one or more exams', {
        missingCount: missing.length,
        missing: missing.slice(0, 20),
      });
    }

    const conductByStudentId = await this.getConductGradesForScope(
      tenantId,
      scope.academicYear.id,
      input.termId,
      input.classRoomId,
    );

    const toRollup = (exams: (typeof examsByTerm)[number]): ExamForTermRollup[] =>
      exams.map((e) => ({
        subjectId: e.subjectId,
        examType: e.examType ?? null,
        name: e.name,
        totalMarks: e.totalMarks,
        weight: e.weight,
        marks: e.marks,
        subject: e.subject,
        teacherUser: e.teacherUser,
      }));

    const teachingTermBundles = teachingTerms.map((t, i) => ({
      termId: t.id,
      termName: t.name,
      exams: toRollup(examsByTerm[i]),
    }));

    const draftSnapshots = students.map((student) =>
      this.buildYearlyStudentSnapshot({
        schoolName: scope.schoolName,
        school: scope.school,
        academicYear: scope.academicYear,
        term: scope.term,
        classRoom: scope.classRoom,
        student,
        teachingTerms: teachingTermBundles,
        gradingScheme,
        policyByTermAndSubject,
        conduct: conductByStudentId.get(student.id),
      }),
    );

    const ranking = draftSnapshots
      .slice()
      .sort((a, b) => b.payload.totals.averagePercentage - a.payload.totals.averagePercentage)
      .map((item, index) => ({ studentId: item.studentId, position: index + 1 }));
    const rankByStudentId = new Map(ranking.map((item) => [item.studentId, item.position]));
    const classSize = draftSnapshots.length;

    const lockedAt = new Date();
    const created = await prisma.$transaction(async (tx) => {
      for (const item of draftSnapshots) {
        const payload: ReportCardPayload = {
          ...item.payload,
          totals: {
            ...item.payload.totals,
            position: rankByStudentId.get(item.studentId) ?? classSize,
            classSize,
          },
        };

        await tx.resultSnapshot.create({
          data: {
            tenantId,
            academicYearId: scope.academicYear.id,
            termId: scope.term.id,
            classRoomId: scope.classRoom.id,
            studentId: item.studentId,
            gradingSchemeId: gradingScheme.id,
            gradingSchemeVersion: gradingScheme.version,
            status: ResultSnapshotStatus.LOCKED,
            payload: payload as unknown as Prisma.InputJsonValue,
            lockedAt,
            lockedByUserId: actor.sub,
          },
        });
      }

      return draftSnapshots.length;
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.RESULTS_LOCKED,
      entity: 'ResultSnapshot',
      entityId: `${input.termId}:${input.classRoomId}`,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        termId: input.termId,
        classRoomId: input.classRoomId,
        createdSnapshots: created,
        yearlyAggregation: true,
      },
    });

    return {
      status: 'LOCKED' as const,
      snapshotsCreated: created,
      classSize,
    };
  }

  async unlockResults(
    tenantId: string,
    input: ResultsActionInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    this.ensureAdmin(actor);

    const deleted = await prisma.resultSnapshot.deleteMany({
      where: {
        tenantId,
        termId: input.termId,
        classRoomId: input.classRoomId,
      },
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.RESULTS_UNLOCKED,
      entity: 'ResultSnapshot',
      entityId: `${input.termId}:${input.classRoomId}`,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        deletedCount: deleted.count,
      },
    });

    return {
      deleted: true,
      snapshotsRemoved: deleted.count,
    };
  }

  async publishResults(
    tenantId: string,
    input: ResultsActionInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    this.ensureAdmin(actor);

    const snapshots = await prisma.resultSnapshot.findMany({
      where: {
        tenantId,
        termId: input.termId,
        classRoomId: input.classRoomId,
      },
      select: { id: true },
    });

    if (!snapshots.length) {
      throw new AppError(409, 'RESULTS_NOT_LOCKED', 'Lock results before publishing');
    }

    const publishedAt = new Date();
    const updated = await prisma.resultSnapshot.updateMany({
      where: {
        tenantId,
        termId: input.termId,
        classRoomId: input.classRoomId,
      },
      data: {
        status: ResultSnapshotStatus.PUBLISHED,
        publishedAt,
        publishedByUserId: actor.sub,
      },
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.RESULTS_PUBLISHED,
      entity: 'ResultSnapshot',
      entityId: `${input.termId}:${input.classRoomId}`,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        publishedCount: updated.count,
      },
    });

    return {
      status: 'PUBLISHED' as const,
      snapshotsUpdated: updated.count,
      publishedAt,
    };
  }

  async getStudentReportCards(
    tenantId: string,
    studentId: string,
    actor: JwtUser,
    query: ReportCardsQueryInput,
  ) {
    const student = await prisma.student.findFirst({
      where: { id: studentId, tenantId, deletedAt: null, isActive: true },
      select: { id: true, studentCode: true, firstName: true, lastName: true },
    });
    if (!student) {
      throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student not found');
    }

    const snapshots = await prisma.resultSnapshot.findMany({
      where: {
        tenantId,
        studentId,
        ...(query.termId ? { termId: query.termId } : {}),
        ...(query.academicYearId ? { academicYearId: query.academicYearId } : {}),
      },
      include: this.resultSnapshotInclude,
      orderBy: [{ term: { startDate: 'desc' } }, { createdAt: 'desc' }],
    });

    if (this.isTeacherOnly(actor) && snapshots.length) {
      const allowedScopes = await prisma.course.findMany({
        where: {
          tenantId,
          teacherUserId: actor.sub,
          isActive: true,
        },
        select: {
          academicYearId: true,
          classRoomId: true,
        },
      });
      const allowed = new Set(allowedScopes.map((item) => `${item.academicYearId}:${item.classRoomId}`));
      const hasBlockedSnapshot = snapshots.some(
        (snapshot) => !allowed.has(`${snapshot.academicYearId}:${snapshot.classRoomId}`),
      );
      if (hasBlockedSnapshot) {
        throw new AppError(403, 'REPORT_CARD_FORBIDDEN', 'You cannot access this student report card');
      }
    }

    return {
      student,
      items: snapshots.map((snapshot) => this.mapReportCardSummary(snapshot)),
    };
  }

  async getMyReportCards(tenantId: string, actor: JwtUser, query: ReportCardsQueryInput) {
    const student = await prisma.student.findFirst({
      where: { tenantId, userId: actor.sub, deletedAt: null, isActive: true },
      select: { id: true, studentCode: true, firstName: true, lastName: true },
    });
    if (!student) {
      throw new AppError(403, 'STUDENT_PROFILE_NOT_FOUND', 'Student profile not found');
    }

    const snapshots = await prisma.resultSnapshot.findMany({
      where: {
        tenantId,
        studentId: student.id,
        status: ResultSnapshotStatus.PUBLISHED,
        ...(query.termId ? { termId: query.termId } : {}),
      },
      include: this.resultSnapshotInclude,
      orderBy: [{ term: { startDate: 'desc' } }, { createdAt: 'desc' }],
    });

    return {
      student,
      items: snapshots.map((snapshot) => this.mapReportCardSummary(snapshot)),
    };
  }

  async listMyExamSchedule(tenantId: string, actor: JwtUser, query: MyExamScheduleQueryInput) {
    const student = await prisma.student.findFirst({
      where: { tenantId, userId: actor.sub, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!student) {
      throw new AppError(403, 'STUDENT_PROFILE_NOT_FOUND', 'Student profile not found');
    }

    const currentYear = await prisma.academicYear.findFirst({
      where: { tenantId, isCurrent: true, isActive: true },
      select: { id: true },
    });

    const enrollmentScope = currentYear ? { academicYearId: currentYear.id } : {};

    const classRows = await prisma.studentEnrollment.findMany({
      where: {
        tenantId,
        studentId: student.id,
        isActive: true,
        ...enrollmentScope,
      },
      select: { classRoomId: true },
      distinct: ['classRoomId'],
    });
    const classIds = classRows.map((r) => r.classRoomId).filter(Boolean) as string[];

    if (!classIds.length) {
      return { items: [] };
    }

    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const where: Prisma.ExamWhereInput = {
      tenantId,
      isActive: true,
      classRoomId: { in: classIds },
      ...(currentYear ? { academicYearId: currentYear.id } : {}),
      ...(query.upcomingOnly ? { examDate: { gte: startOfToday } } : {}),
    };

    const items = await prisma.exam.findMany({
      where,
      include: this.examListInclude,
      orderBy: [{ examDate: 'asc' }, { name: 'asc' }],
      take: 200,
    });

    return {
      items: items.map((item) => this.mapExamSummary(item)),
    };
  }

  async getParentReportCards(
    tenantId: string,
    actor: JwtUser,
    query: ParentReportCardsQueryInput,
  ) {
    const parent = await prisma.parent.findFirst({
      where: { tenantId, userId: actor.sub, deletedAt: null, isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        students: {
          where: { deletedAt: null },
          select: { studentId: true },
        },
      },
    });

    if (!parent) {
      throw new AppError(403, 'PARENT_PROFILE_NOT_FOUND', 'Parent profile not found');
    }

    const linkedStudentIds = parent.students.map((link) => link.studentId);
    if (query.studentId && !linkedStudentIds.includes(query.studentId)) {
      throw new AppError(403, 'REPORT_CARD_FORBIDDEN', 'You cannot access this student report card');
    }

    const snapshots = await prisma.resultSnapshot.findMany({
      where: {
        tenantId,
        status: ResultSnapshotStatus.PUBLISHED,
        studentId: query.studentId ?? { in: linkedStudentIds },
        ...(query.termId ? { termId: query.termId } : {}),
      },
      include: this.resultSnapshotInclude,
      orderBy: [{ term: { startDate: 'desc' } }, { createdAt: 'desc' }],
    });

    return {
      parent: { id: parent.id, firstName: parent.firstName, lastName: parent.lastName },
      items: snapshots.map((snapshot) => this.mapReportCardSummary(snapshot)),
    };
  }

  async verifyPublishedReportCard(snapshotId: string) {
    const snapshot = await prisma.resultSnapshot.findFirst({
      where: {
        id: snapshotId,
        status: ResultSnapshotStatus.PUBLISHED,
      },
      include: this.resultSnapshotInclude,
    });

    if (!snapshot) {
      throw new AppError(404, 'REPORT_CARD_NOT_FOUND', 'Report card not found');
    }

    const payload = snapshot.payload as unknown as ReportCardPayload;

    return {
      valid: true,
      verificationCode: this.buildVerificationCode(snapshot.id),
      verificationUrl: this.buildVerificationUrl(snapshot.id),
      school: {
        name: payload.school?.displayName ?? payload.schoolName,
        code: payload.school?.registrationNumber ?? payload.school?.code ?? null,
        district: payload.school?.district ?? null,
      },
      student: {
        name: `${snapshot.student.firstName} ${snapshot.student.lastName}`,
        studentCode: snapshot.student.studentCode,
      },
      classRoom: snapshot.classRoom,
      term: snapshot.term,
      academicYear: snapshot.academicYear,
      totals: payload.totals,
      issuedAt: snapshot.publishedAt ?? snapshot.lockedAt,
      message: 'This report card is valid and was published by Smart School Rwanda.',
    };
  }

  async getAdminReportCardPdf(
    tenantId: string,
    studentId: string,
    actor: JwtUser,
    query: ReportCardsQueryInput,
    context: RequestAuditContext,
  ) {
    const snapshot = await prisma.resultSnapshot.findFirst({
      where: {
        tenantId,
        studentId,
        ...(query.termId ? { termId: query.termId } : {}),
      },
      include: this.resultSnapshotInclude,
      orderBy: [{ term: { startDate: 'desc' } }, { createdAt: 'desc' }],
    });

    if (!snapshot) {
      throw new AppError(404, 'REPORT_CARD_NOT_FOUND', 'Report card not found');
    }

    if (this.isTeacherOnly(actor)) {
      const allowed = await prisma.course.findFirst({
        where: {
          tenantId,
          teacherUserId: actor.sub,
          academicYearId: snapshot.academicYearId,
          classRoomId: snapshot.classRoomId,
          isActive: true,
        },
        select: { id: true },
      });

      if (!allowed) {
        throw new AppError(403, 'REPORT_CARD_FORBIDDEN', 'You cannot access this report card');
      }
    }

    await this.logReportCardViewed(tenantId, actor.sub, snapshot.id, context);

    return {
      fileName: this.buildReportFileName(snapshot),
      buffer: await buildReportCardPdfBuffer(snapshot.payload as unknown as ReportCardPayload),
    };
  }

  async getMyReportCardPdf(
    tenantId: string,
    snapshotId: string,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const snapshot = await prisma.resultSnapshot.findFirst({
      where: {
        id: snapshotId,
        tenantId,
        status: ResultSnapshotStatus.PUBLISHED,
        student: { userId: actor.sub },
      },
      include: this.resultSnapshotInclude,
    });

    if (!snapshot) {
      throw new AppError(404, 'REPORT_CARD_NOT_FOUND', 'Report card not found');
    }

    await this.logReportCardViewed(tenantId, actor.sub, snapshot.id, context);

    return {
      fileName: this.buildReportFileName(snapshot),
      buffer: await buildReportCardPdfBuffer(snapshot.payload as unknown as ReportCardPayload),
    };
  }

  async getParentReportCardPdf(
    tenantId: string,
    snapshotId: string,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const parent = await prisma.parent.findFirst({
      where: { tenantId, userId: actor.sub, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!parent) {
      throw new AppError(403, 'PARENT_PROFILE_NOT_FOUND', 'Parent profile not found');
    }

    const snapshot = await prisma.resultSnapshot.findFirst({
      where: {
        id: snapshotId,
        tenantId,
        status: ResultSnapshotStatus.PUBLISHED,
        student: {
          parentLinks: {
            some: {
              parentId: parent.id,
              deletedAt: null,
            },
          },
        },
      },
      include: this.resultSnapshotInclude,
    });

    if (!snapshot) {
      throw new AppError(404, 'REPORT_CARD_NOT_FOUND', 'Report card not found');
    }

    await this.logReportCardViewed(tenantId, actor.sub, snapshot.id, context);

    return {
      fileName: this.buildReportFileName(snapshot),
      buffer: await buildReportCardPdfBuffer(snapshot.payload as unknown as ReportCardPayload),
    };
  }

  private readonly examListInclude = {
    term: { select: { id: true, name: true, sequence: true, academicYearId: true } },
    academicYear: { select: { id: true, name: true } },
    classRoom: { select: { id: true, code: true, name: true } },
    subject: { select: { id: true, code: true, name: true } },
    gradingScheme: { select: { id: true, name: true, version: true } },
    teacherUser: { select: { id: true, firstName: true, lastName: true } },
    _count: { select: { marks: true } },
  } satisfies Prisma.ExamInclude;

  private readonly examDetailInclude = {
    ...this.examListInclude,
    marks: {
      include: {
        student: { select: { id: true, studentCode: true, firstName: true, lastName: true } },
      },
      orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
    },
  } satisfies Prisma.ExamInclude;

  private readonly resultSnapshotInclude = {
    academicYear: { select: { id: true, name: true } },
    term: { select: { id: true, name: true, sequence: true, startDate: true, endDate: true } },
    classRoom: { select: { id: true, code: true, name: true } },
    student: { select: { id: true, studentCode: true, firstName: true, lastName: true } },
    gradingScheme: { select: { id: true, name: true, version: true } },
  } satisfies Prisma.ResultSnapshotInclude;

  private normalizeGradingRules(rules: GradingBand[]) {
    const sorted = [...rules].sort((a, b) => b.max - a.max || b.min - a.min);
    for (let index = 0; index < sorted.length; index += 1) {
      const current = sorted[index];
      const next = sorted[index + 1];
      if (next && next.max >= current.min) {
        throw new AppError(400, 'GRADING_SCHEME_RULES_INVALID', 'Grade bands overlap. Adjust the score ranges');
      }
    }

    return sorted;
  }

  private async getGradingSchemeForUse(tenantId: string, gradingSchemeId?: string) {
    const scheme = await prisma.gradingScheme.findFirst({
      where: {
        tenantId,
        isActive: true,
        ...(gradingSchemeId ? { id: gradingSchemeId } : { isDefault: true }),
      },
    });

    if (!scheme) {
      throw new AppError(409, 'GRADING_SCHEME_NOT_FOUND', 'Create a grading scheme first');
    }

    return scheme;
  }

  private async getClassStudents(tenantId: string, academicYearId: string, classRoomId: string) {
    const students = await prisma.studentEnrollment.findMany({
      where: {
        tenantId,
        academicYearId,
        classRoomId,
        isActive: true,
        student: {
          deletedAt: null,
          isActive: true,
        },
      },
      select: {
        student: {
          select: {
            id: true,
            studentCode: true,
            firstName: true,
            lastName: true,
            dateOfBirth: true,
          },
        },
      },
      orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
    });

    return students.map((row) => row.student);
  }

  private async getExamForRead(tenantId: string, examId: string, actor: JwtUser) {
    const exam = await prisma.exam.findFirst({
      where: { id: examId, tenantId, isActive: true },
      include: this.examDetailInclude,
    });
    if (!exam) {
      throw new AppError(404, 'EXAM_NOT_FOUND', 'Exam not found');
    }

    if (this.isTeacherOnly(actor)) {
      this.ensureCanManageTeacherOwnedEntity(exam.teacherUserId, actor);
    }

    return exam;
  }

  private async getExamForManage(tenantId: string, examId: string, actor: JwtUser) {
    const exam = await this.getExamForRead(tenantId, examId, actor);
    this.ensureCanManageTeacherOwnedEntity(exam.teacherUserId, actor);
    return exam;
  }

  private async getResultScope(tenantId: string, termId: string, classRoomId: string) {
    const [term, classRoom, school] = await prisma.$transaction([
      prisma.term.findFirst({
        where: { id: termId, tenantId, isActive: true },
        include: { academicYear: { select: { id: true, name: true } } },
      }),
      prisma.classRoom.findFirst({
        where: { id: classRoomId, tenantId, isActive: true },
        select: { id: true, code: true, name: true },
      }),
      prisma.school.findFirst({
        where: { tenantId },
        select: {
          displayName: true,
          registrationNumber: true,
          email: true,
          phone: true,
          district: true,
          country: true,
          logoUrl: true,
          tenant: {
            select: {
              code: true,
            },
          },
        },
      }),
    ]);

    if (!term) {
      throw new AppError(404, 'TERM_NOT_FOUND', 'Term not found');
    }
    if (!classRoom) {
      throw new AppError(404, 'CLASS_ROOM_NOT_FOUND', 'Class not found');
    }

    return {
      term: { id: term.id, name: term.name },
      academicYear: term.academicYear,
      classRoom,
      school: {
        displayName: school?.displayName ?? 'Smart School Rwanda',
        code: school?.tenant?.code ?? null,
        registrationNumber: school?.registrationNumber ?? null,
        email: school?.email ?? null,
        phone: school?.phone ?? null,
        district: school?.district ?? null,
        country: school?.country ?? null,
        logoUrl: school?.logoUrl ?? null,
      },
      schoolName: school?.displayName ?? 'Smart School Rwanda',
    };
  }

  private async ensureResultsUnlocked(tenantId: string, termId: string, classRoomId: string) {
    const existing = await prisma.resultSnapshot.findFirst({
      where: { tenantId, termId, classRoomId },
      select: { id: true },
    });

    if (existing) {
      throw new AppError(409, 'RESULTS_LOCKED', 'Results are locked for this term and class. Unlock them before editing marks');
    }
  }

  private resolveBand(rules: GradingBand[], percentage: number) {
    const band = rules.find((item) => percentage >= item.min && percentage <= item.max);
    return {
      grade: band?.grade ?? 'N/A',
      remark: band?.remark ?? 'No remark',
    };
  }

  private isExamMarkComplete(
    mark: { marksObtained: number | null; status: MarkStatus } | undefined,
  ): boolean {
    if (!mark) {
      return false;
    }
    if (mark.status === MarkStatus.PRESENT) {
      return mark.marksObtained != null;
    }
    if (mark.status === MarkStatus.ABSENT || mark.status === MarkStatus.EXCUSED) {
      return mark.marksObtained == null;
    }
    return false;
  }

  private async getConductGradesForScope(
    tenantId: string,
    academicYearId: string,
    termId: string,
    classRoomId: string,
  ): Promise<Map<string, { grade: string; remark?: string | null }>> {
    const grades = await prisma.conductGrade.findMany({
      where: {
        tenantId,
        academicYearId,
        termId,
        classRoomId,
      },
      select: { studentId: true, grade: true, remark: true },
    });
    return new Map(grades.map((g) => [g.studentId, { grade: g.grade, remark: g.remark }]));
  }

  private buildStudentSnapshot(params: {
    schoolName: string;
    school: {
      displayName: string;
      code: string | null;
      registrationNumber: string | null;
      email: string | null;
      phone: string | null;
      district: string | null;
      country: string | null;
      logoUrl?: string | null;
    };
    academicYear: { id: string; name: string };
    term: { id: string; name: string };
    classRoom: { id: string; code: string; name: string };
    student: {
      id: string;
      studentCode: string;
      firstName: string;
      lastName: string;
      dateOfBirth?: Date | null;
    };
    exams: Array<any>;
    gradingScheme: { id: string; name: string; version: number; rules: Prisma.JsonValue };
    policyBySubjectId: Map<string, { continuousWeight: number; examWeight: number; passMark: number }>;
    conduct?: { grade: string; remark?: string | null };
  }) {
    const rules = params.gradingScheme.rules as unknown as GradingBand[];
    const defaultPolicy = { continuousWeight: 40, examWeight: 60, passMark: 50 };

    const examsBySubject = new Map<string, any[]>();
    for (const exam of params.exams) {
      if (!examsBySubject.has(exam.subjectId)) {
        examsBySubject.set(exam.subjectId, []);
      }
      examsBySubject.get(exam.subjectId)!.push(exam);
    }

    const pctForStudent = (exam: any, studentId: string): number => {
      const m = exam.marks.find((item: any) => item.studentId === studentId);
      if (!m || m.status !== MarkStatus.PRESENT || m.marksObtained == null) {
        return 0;
      }
      return exam.totalMarks > 0 ? (m.marksObtained / exam.totalMarks) * 100 : 0;
    };

    const weightedPercent = (examList: any[], studentId: string): number => {
      if (!examList.length) {
        return 0;
      }
      const weightTotal = examList.reduce((sum, e) => sum + e.weight, 0) || 1;
      return (
        examList.reduce((sum, e) => sum + pctForStudent(e, studentId) * e.weight, 0) / weightTotal
      );
    };

    const subjects: ReportCardPayload['subjects'] = [];
    let totalMarksObtained = 0;
    let totalMarksPossible = 0;

    for (const [, subjectExams] of examsBySubject) {
      subjectExams.sort((a, b) => a.name.localeCompare(b.name));
      const subjectId = subjectExams[0].subjectId as string;
      const policy = params.policyBySubjectId.get(subjectId) ?? defaultPolicy;
      const caExams = subjectExams.filter((e) => e.examType === 'CAT');
      const termExams = subjectExams.filter((e) => e.examType === 'EXAM');

      const continuousAssessmentPercent = weightedPercent(caExams, params.student.id);
      const examPercent = weightedPercent(termExams, params.student.id);
      const cw = policy.continuousWeight;
      const ew = policy.examWeight;
      const wSum = cw + ew || 1;
      const hasCa = caExams.length > 0;
      const hasTerm = termExams.length > 0;
      let finalPercent: number;
      if (hasCa && hasTerm) {
        finalPercent = (continuousAssessmentPercent * cw + examPercent * ew) / wSum;
      } else if (hasTerm) {
        finalPercent = examPercent;
      } else if (hasCa) {
        finalPercent = continuousAssessmentPercent;
      } else {
        finalPercent = 0;
      }
      const passMark = policy.passMark;
      const decision: 'PASS' | 'FAIL' = finalPercent >= passMark ? 'PASS' : 'FAIL';
      const band = this.resolveBand(rules, finalPercent);

      const examLines: ReportCardPayload['subjects'][number]['exams'] = [];
      for (const exam of subjectExams) {
        const m = exam.marks.find((item: any) => item.studentId === params.student.id);
        const marksObtained = m?.marksObtained ?? null;
        const status = (m?.status ?? MarkStatus.PRESENT) as MarkStatus;
        const pct =
          status === MarkStatus.PRESENT && marksObtained != null && exam.totalMarks > 0
            ? (marksObtained / exam.totalMarks) * 100
            : 0;
        examLines.push({
          examId: exam.id,
          name: exam.name,
          examType: exam.examType ?? 'EXAM',
          marksObtained,
          status,
          totalMarks: exam.totalMarks,
          percentage: Number(pct.toFixed(2)),
          weight: exam.weight,
        });
      }

      totalMarksObtained += finalPercent;
      totalMarksPossible += 100;

      subjects.push({
        subjectId,
        subjectName: subjectExams[0].subject.name,
        averagePercentage: Number(finalPercent.toFixed(2)),
        continuousAssessmentPercent: Number(continuousAssessmentPercent.toFixed(2)),
        examPercent: Number(examPercent.toFixed(2)),
        finalPercent: Number(finalPercent.toFixed(2)),
        passMark,
        decision,
        grade: band.grade,
        remark: band.remark,
        exams: examLines,
      });
    }

    subjects.sort((a, b) => a.subjectName.localeCompare(b.subjectName));

    const averagePercentage = subjects.length ? totalMarksObtained / subjects.length : 0;
    const overallBand = this.resolveBand(rules, averagePercentage);
    const teacherNames = Array.from(
      new Set(
        params.exams
          .map((exam) => {
            const firstName = exam.teacherUser?.firstName ?? '';
            const lastName = exam.teacherUser?.lastName ?? '';
            return `${firstName} ${lastName}`.trim();
          })
          .filter(Boolean),
      ),
    );

    return {
      studentId: params.student.id,
      payload: {
        schoolName: params.schoolName,
        school: params.school,
        academicYear: params.academicYear,
        term: params.term,
        classRoom: params.classRoom,
        student: {
          id: params.student.id,
          studentCode: params.student.studentCode,
          firstName: params.student.firstName,
          lastName: params.student.lastName,
          dateOfBirth: params.student.dateOfBirth
            ? params.student.dateOfBirth.toISOString()
            : null,
        },
        gradingScheme: {
          id: params.gradingScheme.id,
          name: params.gradingScheme.name,
          version: params.gradingScheme.version,
          rules,
        },
        metadata: {
          teacherComment: this.buildTeacherComment(
            Number(averagePercentage.toFixed(2)),
            overallBand.remark,
          ),
          classTeacherName: teacherNames[0] ?? null,
          generatedAt: new Date().toISOString(),
        },
        conduct: params.conduct,
        subjects,
        totals: {
          totalMarksObtained,
          totalMarksPossible,
          averagePercentage: Number(averagePercentage.toFixed(2)),
          grade: overallBand.grade,
          remark: overallBand.remark,
          position: 0,
          classSize: 0,
        },
      } satisfies ReportCardPayload,
    };
  }

  private buildYearlyStudentSnapshot(params: {
    schoolName: string;
    school: {
      displayName: string;
      code: string | null;
      registrationNumber: string | null;
      email: string | null;
      phone: string | null;
      district: string | null;
      country: string | null;
      logoUrl?: string | null;
    };
    academicYear: { id: string; name: string };
    term: { id: string; name: string };
    classRoom: { id: string; code: string; name: string };
    student: {
      id: string;
      studentCode: string;
      firstName: string;
      lastName: string;
      dateOfBirth?: Date | null;
    };
    teachingTerms: Array<{ termId: string; termName: string; exams: ExamForTermRollup[] }>;
    gradingScheme: { id: string; name: string; version: number; rules: Prisma.JsonValue };
    policyByTermAndSubject: Map<string, { continuousWeight: number; examWeight: number; passMark: number }>;
    conduct?: { grade: string; remark?: string | null };
  }) {
    const rules = params.gradingScheme.rules as unknown as GradingBand[];
    const defaultPolicy = { continuousWeight: 40, examWeight: 60, passMark: 50 };

    const unionSubjectIds = new Set<string>();
    const subjectNameById = new Map<string, string>();
    for (const tt of params.teachingTerms) {
      for (const e of tt.exams) {
        unionSubjectIds.add(e.subjectId);
        subjectNameById.set(e.subjectId, e.subject?.name ?? '');
      }
    }

    const { subjects, yearlyReport } = buildYearlyReportCardSubjects({
      unionSubjectIds: [...unionSubjectIds],
      subjectNameById,
      teachingTerms: params.teachingTerms,
      studentId: params.student.id,
      policyByTermAndSubject: params.policyByTermAndSubject,
      defaultPolicy,
      gradingRules: rules,
    });

    const avg = subjects.length
      ? subjects.reduce((s, x) => s + (x.yearlyAveragePercent ?? 0), 0) / subjects.length
      : 0;
    const overallBand = this.resolveBand(rules, avg);

    const teacherNames = Array.from(
      new Set(
        params.teachingTerms
          .flatMap((tt) => tt.exams)
          .map((exam) => {
            const firstName = exam.teacherUser?.firstName ?? '';
            const lastName = exam.teacherUser?.lastName ?? '';
            return `${firstName} ${lastName}`.trim();
          })
          .filter(Boolean),
      ),
    );

    return {
      studentId: params.student.id,
      payload: {
        schoolName: params.schoolName,
        school: params.school,
        academicYear: params.academicYear,
        term: params.term,
        classRoom: params.classRoom,
        student: {
          id: params.student.id,
          studentCode: params.student.studentCode,
          firstName: params.student.firstName,
          lastName: params.student.lastName,
          dateOfBirth: params.student.dateOfBirth
            ? params.student.dateOfBirth.toISOString()
            : null,
        },
        gradingScheme: {
          id: params.gradingScheme.id,
          name: params.gradingScheme.name,
          version: params.gradingScheme.version,
          rules,
        },
        metadata: {
          teacherComment:
            avg >= 70
              ? 'Solid year overall. Year grade = average of term finals; raw total = sum of CA+Exam marks across three terms.'
              : 'Year-end review recommended. Compare term averages and raw totals.',
          classTeacherName: teacherNames[0] ?? null,
          generatedAt: new Date().toISOString(),
        },
        conduct: params.conduct,
        yearlyReport,
        subjects,
        totals: {
          totalMarksObtained: subjects.reduce((s, x) => s + (x.yearlyAveragePercent ?? 0), 0),
          totalMarksPossible: subjects.length * 100,
          averagePercentage: Number(avg.toFixed(2)),
          grade: overallBand.grade,
          remark: overallBand.remark,
          position: 0,
          classSize: 0,
        },
      } satisfies ReportCardPayload,
    };
  }

  private buildReportFileName(snapshot: any) {
    return `${snapshot.student.studentCode}-${snapshot.term.name.replace(/\s+/g, '-')}-report-card.pdf`;
  }

  private buildVerificationCode(snapshotId: string) {
    return `SSR-${snapshotId.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
  }

  private buildVerificationUrl(snapshotId: string) {
    return `${env.APP_WEB_URL.replace(/\/$/, '')}/verify/report-cards/${snapshotId}`;
  }

  private async logReportCardViewed(
    tenantId: string,
    actorUserId: string,
    snapshotId: string,
    context: RequestAuditContext,
  ) {
    await this.auditService.log({
      tenantId,
      actorUserId,
      event: AUDIT_EVENT.REPORT_CARD_VIEWED,
      entity: 'ResultSnapshot',
      entityId: snapshotId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  }

  private mapGradingScheme(scheme: any) {
    return {
      id: scheme.id,
      name: scheme.name,
      version: scheme.version,
      description: scheme.description,
      rules: scheme.rules,
      isDefault: scheme.isDefault,
      isActive: scheme.isActive,
      createdAt: scheme.createdAt,
      updatedAt: scheme.updatedAt,
    };
  }

  private mapExamSummary(exam: any) {
    return {
      id: exam.id,
      name: exam.name,
      description: exam.description,
      examType: exam.examType ?? 'EXAM',
      totalMarks: exam.totalMarks,
      weight: exam.weight,
      examDate: exam.examDate,
      createdAt: exam.createdAt,
      updatedAt: exam.updatedAt,
      marksEnteredCount: exam._count?.marks ?? exam.marks?.length ?? 0,
      term: exam.term,
      academicYear: exam.academicYear,
      classRoom: exam.classRoom,
      subject: exam.subject,
      gradingScheme: exam.gradingScheme,
      teacherUser: exam.teacherUser,
    };
  }

  private mapReportCardSummary(snapshot: any) {
    const payload = snapshot.payload as unknown as ReportCardPayload;
    return {
      id: snapshot.id,
      status: snapshot.status,
      lockedAt: snapshot.lockedAt,
      publishedAt: snapshot.publishedAt,
      student: snapshot.student,
      classRoom: snapshot.classRoom,
      term: snapshot.term,
      academicYear: snapshot.academicYear,
      gradingScheme: snapshot.gradingScheme,
      totals: payload.totals,
      subjects: payload.subjects.map((subject) => ({
        subjectId: subject.subjectId,
        subjectName: subject.subjectName,
        averagePercentage: subject.averagePercentage,
        grade: subject.grade,
        remark: subject.remark,
      })),
    };
  }

  private buildTeacherComment(averagePercentage: number, defaultRemark: string) {
    if (averagePercentage >= 85) {
      return 'Excellent progress. Keep the same focus and consistency.';
    }
    if (averagePercentage >= 70) {
      return 'Good progress. Continue practicing to move to the next level.';
    }
    if (averagePercentage >= 55) {
      return 'Fair progress. More revision and steady practice are needed.';
    }
    return defaultRemark || 'Support is needed with regular practice and close follow-up.';
  }

  private handleUniqueError(error: unknown, message: string) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new AppError(409, 'UNIQUE_CONSTRAINT_VIOLATION', message);
    }
  }

  private ensureAdmin(actor: JwtUser) {
    if (actor.roles.includes('SUPER_ADMIN') || actor.roles.includes('SCHOOL_ADMIN')) {
      return;
    }
    throw new AppError(403, 'RESULTS_FORBIDDEN', 'Only administrators can perform this action');
  }

  private ensureCanManageTeacherOwnedEntity(teacherUserId: string, actor: JwtUser) {
    if (actor.roles.includes('SUPER_ADMIN') || actor.roles.includes('SCHOOL_ADMIN')) {
      return;
    }
    if (actor.roles.includes('TEACHER') && actor.sub === teacherUserId) {
      return;
    }
    throw new AppError(403, 'EXAM_FORBIDDEN', 'You cannot manage this exam');
  }

  private isTeacherOnly(actor: JwtUser) {
    return actor.roles.includes('TEACHER') && !actor.roles.includes('SUPER_ADMIN') && !actor.roles.includes('SCHOOL_ADMIN');
  }
}
