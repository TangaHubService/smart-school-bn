import {
  AssessmentAttemptStatus,
  AssessmentQuestionType,
  Prisma,
} from '@prisma/client';

import { AppError } from '../../common/errors/app-error';
import { JwtUser, RequestAuditContext } from '../../common/types/auth.types';
import { buildPagination } from '../../common/utils/pagination';
import { AUDIT_EVENT } from '../../constants/audit-events';
import { prisma } from '../../db/prisma';
import { AuditService } from '../audit/audit.service';
import {
  AddQuestionInput,
  CreateAssessmentInput,
  ListAssessmentResultsQueryInput,
  ListAssessmentsQueryInput,
  ListMyAssessmentsQueryInput,
  PublishAssessmentInput,
  RegradeAttemptInput,
  ReplaceAssessmentAssigneesInput,
  SaveAttemptAnswersInput,
  StartAssessmentAttemptInput,
  UpdateAssessmentInput,
  UpdateAssessmentPortalInput,
  UpdateQuestionInput,
} from './assessments.schemas';

type TxClient = Prisma.TransactionClient;

function isOpenEndedQuestionType(type: AssessmentQuestionType): boolean {
  return (
    type === AssessmentQuestionType.OPEN_TEXT ||
    type === AssessmentQuestionType.SHORT_ANSWER ||
    type === AssessmentQuestionType.ESSAY
  );
}

export class AssessmentsService {
  private readonly auditService = new AuditService();

  async createAssessment(
    tenantId: string,
    input: CreateAssessmentInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const course = await this.getCourseForManagement(tenantId, input.courseId);
    this.ensureCanManageCourse(course.teacherUserId, actor);

    if (input.lessonId) {
      await this.ensureLessonInCourse(tenantId, input.lessonId, input.courseId);
    }

    const accessCode =
      input.accessCode && input.accessCode.trim().length > 0 ? input.accessCode.trim() : null;

    const created: any = await prisma.assessment.create({
      data: {
        tenantId,
        courseId: input.courseId,
        lessonId: input.lessonId,
        type: input.type,
        title: input.title,
        instructions: input.instructions,
        dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
        timeLimitMinutes: input.timeLimitMinutes,
        maxAttempts: input.maxAttempts,
        isPublished: input.isPublished,
        publishedAt: input.isPublished ? new Date() : null,
        accessCode,
        portalAssignOnly: input.portalAssignOnly ?? false,
        createdByUserId: actor.sub,
        updatedByUserId: actor.sub,
      },
      include: this.assessmentSummaryInclude,
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.ASSESSMENT_CREATED,
      entity: 'Assessment',
      entityId: created.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        courseId: input.courseId,
        lessonId: input.lessonId ?? null,
      },
    });

    return this.mapAssessmentSummary(created);
  }

  async listAssessments(
    tenantId: string,
    query: ListAssessmentsQueryInput,
    actor: JwtUser,
  ) {
    const courseWhere: Record<string, string> = {};
    if (query.classId) {
      courseWhere.classRoomId = query.classId;
    }
    if (query.academicYearId) {
      courseWhere.academicYearId = query.academicYearId;
    }
    if (this.isTeacherOnly(actor)) {
      courseWhere.teacherUserId = actor.sub;
    }

    const where: any = {
      tenantId,
      ...(query.courseId ? { courseId: query.courseId } : {}),
      ...(Object.keys(courseWhere).length ? { course: courseWhere } : {}),
    };

    if (query.q) {
      where.OR = [
        {
          title: {
            contains: query.q,
            mode: 'insensitive',
          },
        },
        {
          instructions: {
            contains: query.q,
            mode: 'insensitive',
          },
        },
        {
          course: {
            title: {
              contains: query.q,
              mode: 'insensitive',
            },
          },
        },
      ];
    }

    const skip = (query.page - 1) * query.pageSize;
    const [totalItems, items]: [number, any[]] = await prisma.$transaction([
      prisma.assessment.count({ where }),
      prisma.assessment.findMany({
        where,
        skip,
        take: query.pageSize,
        include: this.assessmentSummaryInclude,
        orderBy: [{ updatedAt: 'desc' }, { title: 'asc' }],
      }),
    ]);

    return {
      items: items.map((item) => this.mapAssessmentSummary(item)),
      pagination: buildPagination(query.page, query.pageSize, totalItems),
    };
  }

  async getAssessmentDetail(tenantId: string, assessmentId: string, actor: JwtUser) {
    const assessment = await this.getAssessmentForManagement(tenantId, assessmentId);
    this.ensureCanManageCourse(assessment.course.teacherUserId, actor);

    return this.mapAssessmentDetail(assessment);
  }

  async updateAssessment(
    tenantId: string,
    assessmentId: string,
    input: UpdateAssessmentInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const assessment = await this.getAssessmentForManagement(tenantId, assessmentId);
    this.ensureCanManageCourse(assessment.course.teacherUserId, actor);

    if (assessment._count.attempts > 0) {
      throw new AppError(
        409,
        'ASSESSMENT_ALREADY_HAS_ATTEMPTS',
        'Assessment settings are locked after students start attempting this assessment',
      );
    }

    if (input.lessonId) {
      await this.ensureLessonInCourse(tenantId, input.lessonId, assessment.course.id);
    }

    const instructions =
      input.instructions === undefined
        ? undefined
        : input.instructions && input.instructions.trim().length > 0
          ? input.instructions
          : null;

    const updated: any = await prisma.assessment.update({
      where: {
        id: assessment.id,
      },
      data: {
        ...(input.lessonId !== undefined ? { lessonId: input.lessonId } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(instructions !== undefined ? { instructions } : {}),
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt ? new Date(input.dueAt) : null } : {}),
        ...(input.timeLimitMinutes !== undefined ? { timeLimitMinutes: input.timeLimitMinutes } : {}),
        ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
        updatedByUserId: actor.sub,
      },
      include: this.assessmentSummaryInclude,
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.ASSESSMENT_UPDATED,
      entity: 'Assessment',
      entityId: updated.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        lessonId: updated.lessonId,
        dueAt: updated.dueAt,
        timeLimitMinutes: updated.timeLimitMinutes,
        maxAttempts: updated.maxAttempts,
      },
    });

    return this.mapAssessmentSummary(updated);
  }

  async addQuestion(
    tenantId: string,
    assessmentId: string,
    input: AddQuestionInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const assessment = await this.getAssessmentForManagement(tenantId, assessmentId);
    this.ensureCanManageCourse(assessment.course.teacherUserId, actor);
    this.ensureAssessmentQuestionsEditable(assessment);

    const created: any = await prisma.$transaction(async (tx) => {
      const sequence =
        input.sequence ??
        ((await tx.assessmentQuestion.aggregate({
          where: {
            tenantId,
            assessmentId,
          },
          _max: {
            sequence: true,
          },
        }))._max.sequence ?? 0) + 1;

      return tx.assessmentQuestion.create({
        data: {
          tenantId,
          assessmentId,
          prompt: input.prompt,
          explanation: input.explanation,
          hint: input.hint?.trim() ? input.hint.trim() : null,
          remedialLessonId: input.remedialLessonId ?? null,
          type: input.type,
          sequence,
          points: input.points,
          options:
            input.type === AssessmentQuestionType.MCQ_SINGLE
              ? {
                  create: input.options.map((option, index) => ({
                    tenantId,
                    label: option.label,
                    isCorrect: option.isCorrect,
                    sequence: option.sequence ?? index + 1,
                  })),
                }
              : undefined,
        },
        include: {
          options: {
            orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
          },
        },
      });
    });

    await prisma.assessment.update({
      where: {
        id: assessment.id,
      },
      data: {
        updatedByUserId: actor.sub,
      },
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.ASSESSMENT_CREATED,
      entity: 'AssessmentQuestion',
      entityId: created.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        assessmentId,
        sequence: created.sequence,
      },
    });

    return this.mapQuestionForTeacher(created);
  }

  async updateQuestion(
    tenantId: string,
    questionId: string,
    input: UpdateQuestionInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const question = await this.getQuestionForManagement(tenantId, questionId);
    this.ensureCanManageCourse(question.assessment.course.teacherUserId, actor);
    this.ensureAssessmentQuestionsEditable(question.assessment);

    const normalizedOptions = input.options.map((option, index) => ({
      label: option.label,
      isCorrect: option.isCorrect,
      sequence: option.sequence ?? index + 1,
    }));
    const desiredSequences = normalizedOptions.map((option) => option.sequence);

    const updated: any = await prisma.$transaction(async (tx) => {
      await tx.assessmentQuestion.update({
        where: { id: question.id },
        data: {
          prompt: input.prompt,
          explanation: input.explanation,
          hint: input.hint === undefined ? undefined : input.hint?.trim() ? input.hint.trim() : null,
          remedialLessonId:
            input.remedialLessonId === undefined
              ? undefined
              : input.remedialLessonId === null
                ? null
                : input.remedialLessonId,
          type: input.type,
          sequence: input.sequence ?? question.sequence,
          points: input.points,
        },
      });

      const existingOptionBySequence = new Map<number, any>(
        question.options.map((option: any) => [option.sequence, option]),
      );

      if (isOpenEndedQuestionType(input.type)) {
        await tx.assessmentOption.deleteMany({
          where: {
            tenantId,
            questionId: question.id,
          },
        });
      } else {
        await tx.assessmentOption.deleteMany({
          where: {
            tenantId,
            questionId: question.id,
            sequence: {
              notIn: desiredSequences,
            },
          },
        });

        for (const option of normalizedOptions) {
          const existingOption = existingOptionBySequence.get(option.sequence);
          if (existingOption) {
            await tx.assessmentOption.update({
              where: { id: existingOption.id },
              data: {
                label: option.label,
                isCorrect: option.isCorrect,
                sequence: option.sequence,
              },
            });
          } else {
            await tx.assessmentOption.create({
              data: {
                tenantId,
                questionId: question.id,
                label: option.label,
                isCorrect: option.isCorrect,
                sequence: option.sequence,
              },
            });
          }
        }
      }

      await tx.assessment.update({
        where: { id: question.assessment.id },
        data: { updatedByUserId: actor.sub },
      });

      return tx.assessmentQuestion.findFirst({
        where: {
          id: question.id,
          tenantId,
        },
        include: {
          options: {
            orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
          },
        },
      });
    });

    if (!updated) {
      throw new AppError(404, 'ASSESSMENT_QUESTION_NOT_FOUND', 'Assessment question not found');
    }

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.ASSESSMENT_QUESTION_UPDATED,
      entity: 'AssessmentQuestion',
      entityId: updated.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        assessmentId: question.assessment.id,
        sequence: updated.sequence,
      },
    });

    return this.mapQuestionForTeacher(updated);
  }

  async deleteQuestion(
    tenantId: string,
    questionId: string,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const question = await this.getQuestionForManagement(tenantId, questionId);
    this.ensureCanManageCourse(question.assessment.course.teacherUserId, actor);
    this.ensureAssessmentQuestionsEditable(question.assessment);

    await prisma.$transaction(async (tx) => {
      await tx.assessmentQuestion.delete({
        where: { id: question.id },
      });

      await tx.assessmentQuestion.updateMany({
        where: {
          tenantId,
          assessmentId: question.assessment.id,
          sequence: {
            gt: question.sequence,
          },
        },
        data: {
          sequence: {
            decrement: 1,
          },
        },
      });

      await tx.assessment.update({
        where: { id: question.assessment.id },
        data: { updatedByUserId: actor.sub },
      });
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.ASSESSMENT_QUESTION_DELETED,
      entity: 'AssessmentQuestion',
      entityId: question.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        assessmentId: question.assessment.id,
        sequence: question.sequence,
      },
    });

    return { id: question.id, deleted: true };
  }

  async publishAssessment(
    tenantId: string,
    assessmentId: string,
    input: PublishAssessmentInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const assessment = await this.getAssessmentForManagement(tenantId, assessmentId);
    this.ensureCanManageCourse(assessment.course.teacherUserId, actor);

    if (input.isPublished && assessment.questions.length === 0) {
      throw new AppError(400, 'ASSESSMENT_HAS_NO_QUESTIONS', 'Add at least one question before publishing');
    }

    const updated: any = await prisma.assessment.update({
      where: {
        id: assessment.id,
      },
      data: {
        isPublished: input.isPublished,
        publishedAt: input.isPublished ? new Date() : null,
        updatedByUserId: actor.sub,
      },
      include: this.assessmentSummaryInclude,
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.ASSESSMENT_PUBLISHED,
      entity: 'Assessment',
      entityId: updated.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        isPublished: input.isPublished,
      },
    });

    return this.mapAssessmentSummary(updated);
  }

  async updateAssessmentPortal(
    tenantId: string,
    assessmentId: string,
    input: UpdateAssessmentPortalInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const assessment = await this.getAssessmentForManagement(tenantId, assessmentId);
    this.ensureCanManageCourse(assessment.course.teacherUserId, actor);

    const accessCode =
      input.accessCode === undefined
        ? undefined
        : input.accessCode && input.accessCode.trim().length > 0
          ? input.accessCode.trim()
          : null;

    const updated: any = await prisma.assessment.update({
      where: { id: assessment.id },
      data: {
        ...(accessCode !== undefined ? { accessCode } : {}),
        ...(input.portalAssignOnly !== undefined ? { portalAssignOnly: input.portalAssignOnly } : {}),
        updatedByUserId: actor.sub,
      },
      include: this.assessmentSummaryInclude,
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.ASSESSMENT_UPDATED,
      entity: 'Assessment',
      entityId: updated.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        portal: true,
        hasAccessCode: Boolean(updated.accessCode),
        portalAssignOnly: updated.portalAssignOnly,
      },
    });

    return this.mapAssessmentSummary(updated);
  }

  async replaceAssessmentAssignees(
    tenantId: string,
    assessmentId: string,
    input: ReplaceAssessmentAssigneesInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const assessment = await this.getAssessmentForManagement(tenantId, assessmentId);
    this.ensureCanManageCourse(assessment.course.teacherUserId, actor);

    const course = await prisma.course.findFirst({
      where: { id: assessment.courseId, tenantId, isActive: true },
      select: { classRoomId: true, academicYearId: true },
    });
    if (!course) {
      throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found');
    }

    const studentIds = [...new Set(input.studentIds)];
    if (studentIds.length) {
      const valid = await prisma.studentEnrollment.findMany({
        where: {
          tenantId,
          classRoomId: course.classRoomId,
          academicYearId: course.academicYearId,
          studentId: { in: studentIds },
          isActive: true,
        },
        select: { studentId: true },
      });
      const validSet = new Set(valid.map((v) => v.studentId));
      const missing = studentIds.filter((id) => !validSet.has(id));
      if (missing.length) {
        throw new AppError(
          400,
          'ASSESSMENT_ASSIGNEE_INVALID',
          'Some students are not enrolled in this assessment course class for the current academic year',
          { missingStudentIds: missing.slice(0, 20) },
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.assessmentStudentAssignment.deleteMany({
        where: { tenantId, assessmentId },
      });
      if (studentIds.length) {
        await tx.assessmentStudentAssignment.createMany({
          data: studentIds.map((studentId) => ({
            tenantId,
            assessmentId,
            studentId,
          })),
        });
      }
    });

    const updated: any = await prisma.assessment.findFirst({
      where: { id: assessmentId, tenantId },
      include: this.assessmentSummaryInclude,
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.ASSESSMENT_UPDATED,
      entity: 'Assessment',
      entityId: assessmentId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        assigneesReplaced: studentIds.length,
      },
    });

    return this.mapAssessmentSummary(updated!);
  }

  async listAssessmentResults(
    tenantId: string,
    assessmentId: string,
    query: ListAssessmentResultsQueryInput,
    actor: JwtUser,
  ) {
    const assessment = await this.getAssessmentForManagement(tenantId, assessmentId);
    this.ensureCanManageCourse(assessment.course.teacherUserId, actor);

    const where: any = {
      tenantId,
      assessmentId,
      status: AssessmentAttemptStatus.SUBMITTED,
    };

    const skip = (query.page - 1) * query.pageSize;
    const [totalItems, items]: [number, any[]] = await prisma.$transaction([
      prisma.assessmentAttempt.count({ where }),
      prisma.assessmentAttempt.findMany({
        where,
        skip,
        take: query.pageSize,
        include: {
          student: {
            select: {
              id: true,
              studentCode: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: [{ submittedAt: 'desc' }, { updatedAt: 'desc' }],
      }),
    ]);

    return {
      assessment: this.mapAssessmentSummary(assessment),
      items: items.map((attempt) => this.mapAttemptSummary(attempt)),
      pagination: buildPagination(query.page, query.pageSize, totalItems),
    };
  }

  async listMyAssessments(
    tenantId: string,
    actor: JwtUser,
    query: ListMyAssessmentsQueryInput,
  ) {
    const student = await this.getStudentProfile(tenantId, actor.sub);
    const enrollmentPairs = student.enrollments.map((enrollment) => ({
      classRoomId: enrollment.classRoomId,
      academicYearId: enrollment.academicYearId,
    }));

    if (!enrollmentPairs.length) {
      return {
        student: this.mapStudentProfile(student),
        items: [],
        pagination: buildPagination(query.page, query.pageSize, 0),
      };
    }

    const searchFilter = query.q
      ? {
          OR: [
            {
              title: {
                contains: query.q,
                mode: 'insensitive' as const,
              },
            },
            {
              course: {
                title: {
                  contains: query.q,
                  mode: 'insensitive' as const,
                },
              },
            },
          ],
        }
      : null;

    const where: any = {
      tenantId,
      isPublished: true,
      AND: [
        {
          OR: enrollmentPairs.map((pair) => ({
            course: {
              classRoomId: pair.classRoomId,
              academicYearId: pair.academicYearId,
            },
          })),
        },
        {
          OR: [
            { portalAssignOnly: false },
            {
              studentAssignments: {
                some: {
                  studentId: student.id,
                },
              },
            },
          ],
        },
        ...(searchFilter ? [searchFilter] : []),
      ],
    };

    const skip = (query.page - 1) * query.pageSize;
    const [totalItems, items]: [number, any[]] = await prisma.$transaction([
      prisma.assessment.count({ where }),
      prisma.assessment.findMany({
        where,
        skip,
        take: query.pageSize,
        include: {
          ...this.assessmentSummaryInclude,
          attempts: {
            where: {
              studentId: student.id,
            },
            orderBy: [{ attemptNumber: 'desc' }],
            take: 1,
          },
        },
        orderBy: [{ dueAt: 'asc' }, { updatedAt: 'desc' }],
      }),
    ]);

    return {
      student: this.mapStudentProfile(student),
      items: items.map((assessment) => ({
        ...this.mapAssessmentSummary(assessment, { forStudent: true }),
        latestAttempt: assessment.attempts[0] ? this.mapAttemptSummary(assessment.attempts[0]) : null,
      })),
      pagination: buildPagination(query.page, query.pageSize, totalItems),
    };
  }

  async getMyAssessment(
    tenantId: string,
    assessmentId: string,
    actor: JwtUser,
  ) {
    const student = await this.getStudentProfile(tenantId, actor.sub);
    const enrollmentPairs = student.enrollments.map((enrollment) => ({
      classRoomId: enrollment.classRoomId,
      academicYearId: enrollment.academicYearId,
    }));

    if (!enrollmentPairs.length) {
      throw new AppError(403, 'ASSESSMENT_ACCESS_DENIED', 'Student is not assigned to an active class');
    }

    const assessment: any = await prisma.assessment.findFirst({
      where: {
        id: assessmentId,
        tenantId,
        isPublished: true,
        AND: [
          {
            OR: enrollmentPairs.map((pair) => ({
              course: {
                classRoomId: pair.classRoomId,
                academicYearId: pair.academicYearId,
              },
            })),
          },
          {
            OR: [
              { portalAssignOnly: false },
              {
                studentAssignments: {
                  some: {
                    studentId: student.id,
                  },
                },
              },
            ],
          },
        ],
      },
      include: {
        ...this.assessmentSummaryInclude,
        attempts: {
          where: {
            studentId: student.id,
          },
          orderBy: [{ attemptNumber: 'desc' }],
          take: 1,
        },
      },
    });

    if (!assessment) {
      throw new AppError(404, 'ASSESSMENT_NOT_FOUND', 'Assessment not found');
    }

    return {
      student: this.mapStudentProfile(student),
      ...this.mapAssessmentSummary(assessment, { forStudent: true }),
      latestAttempt: assessment.attempts[0] ? this.mapAttemptSummary(assessment.attempts[0]) : null,
    };
  }

  async startAttempt(
    tenantId: string,
    assessmentId: string,
    input: StartAssessmentAttemptInput | undefined,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const student = await this.getStudentProfile(tenantId, actor.sub);
    const assessment = await this.getAssessmentForStudent(tenantId, assessmentId);
    this.ensureStudentAssignedToCourse(student, assessment.course.classRoomId, assessment.course.academicYearId);
    await this.ensureStudentPortalAccess(tenantId, assessment.id, assessment.portalAssignOnly, student.id);
    this.ensureAccessCode(assessment.accessCode, input?.accessCode);
    this.ensureAssessmentOpen(assessment.dueAt);

    const attempts: any[] = await prisma.assessmentAttempt.findMany({
      where: {
        tenantId,
        assessmentId,
        studentId: student.id,
      },
      include: {
        answers: true,
      },
      orderBy: [{ attemptNumber: 'desc' }],
    });

    const inProgress = attempts.find((attempt) => attempt.status === AssessmentAttemptStatus.IN_PROGRESS);
    if (inProgress) {
      return this.mapAttemptForStudent(assessment, inProgress, false);
    }

    const submittedCount = attempts.filter((attempt) => attempt.status === AssessmentAttemptStatus.SUBMITTED).length;
    if (submittedCount >= assessment.maxAttempts) {
      throw new AppError(409, 'ASSESSMENT_ATTEMPT_LIMIT_REACHED', 'No attempts remaining for this assessment');
    }

    const created: any = await prisma.assessmentAttempt.create({
      data: {
        tenantId,
        assessmentId,
        studentId: student.id,
        studentUserId: actor.sub,
        attemptNumber: attempts.length + 1,
      },
      include: {
        answers: true,
      },
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.ASSESSMENT_ATTEMPT_STARTED,
      entity: 'AssessmentAttempt',
      entityId: created.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        assessmentId,
        attemptNumber: created.attemptNumber,
      },
    });

    return this.mapAttemptForStudent(assessment, created, false);
  }

  async saveAttemptAnswers(
    tenantId: string,
    attemptId: string,
    input: SaveAttemptAnswersInput,
    actor: JwtUser,
  ) {
    const attempt: any = await prisma.assessmentAttempt.findFirst({
      where: {
        id: attemptId,
        tenantId,
      },
      include: this.attemptInclude,
    });

    if (!attempt) {
      throw new AppError(404, 'ASSESSMENT_ATTEMPT_NOT_FOUND', 'Assessment attempt not found');
    }

    this.ensureCanAccessAttempt(attempt, actor);

    if (attempt.status === AssessmentAttemptStatus.SUBMITTED) {
      throw new AppError(409, 'ASSESSMENT_ATTEMPT_SUBMITTED', 'Assessment attempt has already been submitted');
    }

    this.ensureAssessmentOpen(attempt.assessment.dueAt);
    this.ensureAttemptWithinTimeLimit(attempt.startedAt, attempt.assessment.timeLimitMinutes);
    this.validateAnswerSelection(attempt.assessment.questions, input.answers);

    await prisma.$transaction(async (tx) => {
      for (const answer of input.answers) {
        await tx.assessmentAnswer.upsert({
          where: {
            tenantId_attemptId_questionId: {
              tenantId,
              attemptId: attempt.id,
              questionId: answer.questionId,
            },
          },
          update: {
            selectedOptionId: answer.selectedOptionId,
            textResponse: answer.textResponse?.trim() || null,
            isCorrect: null,
            pointsAwarded: null,
            manualPointsAwarded: null,
          },
          create: {
            tenantId,
            attemptId: attempt.id,
            questionId: answer.questionId,
            selectedOptionId: answer.selectedOptionId,
            textResponse: answer.textResponse?.trim() || null,
          },
        });
      }
    });

    const refreshed: any = await prisma.assessmentAttempt.findFirst({
      where: {
        id: attempt.id,
        tenantId,
      },
      include: this.attemptInclude,
    });

    if (!refreshed) {
      throw new AppError(404, 'ASSESSMENT_ATTEMPT_NOT_FOUND', 'Assessment attempt not found');
    }

    return this.mapAttemptForStudent(refreshed.assessment, refreshed, false);
  }

  async submitAttempt(
    tenantId: string,
    attemptId: string,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const attempt: any = await prisma.assessmentAttempt.findFirst({
      where: {
        id: attemptId,
        tenantId,
      },
      include: this.attemptInclude,
    });

    if (!attempt) {
      throw new AppError(404, 'ASSESSMENT_ATTEMPT_NOT_FOUND', 'Assessment attempt not found');
    }

    this.ensureCanAccessAttempt(attempt, actor);

    if (attempt.status === AssessmentAttemptStatus.SUBMITTED) {
      throw new AppError(409, 'ASSESSMENT_ATTEMPT_SUBMITTED', 'Assessment attempt has already been submitted');
    }

    this.ensureAssessmentOpen(attempt.assessment.dueAt);
    this.ensureAttemptWithinTimeLimit(attempt.startedAt, attempt.assessment.timeLimitMinutes);

    const answerByQuestionId = new Map<string, any>(
      attempt.answers.map((answer: any) => [answer.questionId, answer]),
    );
    const grading = attempt.assessment.questions.map((question: any) => {
      if (isOpenEndedQuestionType(question.type)) {
        const answer = answerByQuestionId.get(question.id);

        return {
          questionId: question.id,
          selectedOptionId: null,
          textResponse: answer?.textResponse?.trim() || null,
          isCorrect: null,
          pointsAwarded: null,
        };
      }

      const correctOption = question.options.find((option: any) => option.isCorrect);
      const answer = answerByQuestionId.get(question.id);
      const isCorrect = Boolean(answer?.selectedOptionId && correctOption?.id === answer.selectedOptionId);

      return {
        questionId: question.id,
        selectedOptionId: answer?.selectedOptionId ?? null,
        textResponse: null,
        isCorrect,
        pointsAwarded: isCorrect ? question.points : 0,
      };
    });

    const maxScore = attempt.assessment.questions.reduce(
      (sum: number, question: any) => sum + question.points,
      0,
    );
    const autoScore = grading.reduce((sum: number, answer: any) => sum + (answer.pointsAwarded ?? 0), 0);

    const submitted: any = await prisma.$transaction(async (tx) => {
      for (const answer of grading) {
        await tx.assessmentAnswer.upsert({
          where: {
            tenantId_attemptId_questionId: {
              tenantId,
              attemptId: attempt.id,
              questionId: answer.questionId,
            },
          },
          update: {
            selectedOptionId: answer.selectedOptionId,
            textResponse: answer.textResponse,
            isCorrect: answer.isCorrect,
            pointsAwarded: answer.pointsAwarded,
          },
          create: {
            tenantId,
            attemptId: attempt.id,
            questionId: answer.questionId,
            selectedOptionId: answer.selectedOptionId,
            textResponse: answer.textResponse,
            isCorrect: answer.isCorrect,
            pointsAwarded: answer.pointsAwarded,
          },
        });
      }

      await tx.assessment.update({
        where: {
          id: attempt.assessment.id,
        },
        data: {
          updatedByUserId: actor.sub,
        },
      });

      return tx.assessmentAttempt.update({
        where: {
          id: attempt.id,
        },
        data: {
          status: AssessmentAttemptStatus.SUBMITTED,
          submittedAt: new Date(),
          autoScore,
          maxScore,
        },
        include: this.attemptInclude,
      });
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.ASSESSMENT_ATTEMPT_SUBMITTED,
      entity: 'AssessmentAttempt',
      entityId: submitted.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        assessmentId: submitted.assessmentId,
        autoScore,
        maxScore,
      },
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.ASSESSMENT_AUTO_GRADED,
      entity: 'AssessmentAttempt',
      entityId: submitted.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        autoScore,
        maxScore,
      },
    });

    if (submitted.assessment.lessonId) {
      await prisma.studentLessonProgress.upsert({
        where: {
          tenantId_studentId_lessonId: {
            tenantId,
            studentId: submitted.studentId,
            lessonId: submitted.assessment.lessonId,
          },
        },
        update: {
          isCompleted: true,
          completedAt: new Date(),
        },
        create: {
          tenantId,
          studentId: submitted.studentId,
          lessonId: submitted.assessment.lessonId,
          isCompleted: true,
          completedAt: new Date(),
        },
      });
    }

    await this.upsertExamMarkFromAttempt(tenantId, submitted, actor);

    return this.mapAttemptForStudent(submitted.assessment, submitted, true);
  }

  async getAttempt(tenantId: string, attemptId: string, actor: JwtUser) {
    const attempt: any = await prisma.assessmentAttempt.findFirst({
      where: {
        id: attemptId,
        tenantId,
      },
      include: this.attemptInclude,
    });

    if (!attempt) {
      throw new AppError(404, 'ASSESSMENT_ATTEMPT_NOT_FOUND', 'Assessment attempt not found');
    }

    this.ensureCanAccessAttempt(attempt, actor);

    return this.mapAttemptForStudent(
      attempt.assessment,
      attempt,
      attempt.status === AssessmentAttemptStatus.SUBMITTED,
    );
  }

  async regradeAttempt(
    tenantId: string,
    attemptId: string,
    input: RegradeAttemptInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const attempt: any = await prisma.assessmentAttempt.findFirst({
      where: {
        id: attemptId,
        tenantId,
      },
      include: this.attemptInclude,
    });

    if (!attempt) {
      throw new AppError(404, 'ASSESSMENT_ATTEMPT_NOT_FOUND', 'Assessment attempt not found');
    }

    this.ensureCanManageCourse(attempt.assessment.course.teacherUserId, actor);

    if (attempt.status !== AssessmentAttemptStatus.SUBMITTED) {
      throw new AppError(409, 'ASSESSMENT_ATTEMPT_NOT_SUBMITTED', 'Only submitted attempts can be regraded');
    }

    const questionById = new Map<string, any>(
      attempt.assessment.questions.map((question: any) => [question.id, question]),
    );
    const overrideByQuestionId = new Map<string, number>();

    for (const answer of input.answers) {
      const question = questionById.get(answer.questionId);
      if (!question) {
        throw new AppError(400, 'ASSESSMENT_QUESTION_INVALID', 'Question does not belong to this assessment');
      }

      if (answer.pointsAwarded > question.points) {
        throw new AppError(
          400,
          'ASSESSMENT_MANUAL_POINTS_INVALID',
          `Points for question ${question.sequence} cannot exceed ${question.points}`,
        );
      }

      overrideByQuestionId.set(answer.questionId, answer.pointsAwarded);
    }

    const previousScore = this.getAttemptScore(attempt);
    const nextManualScore = attempt.assessment.questions.reduce((sum: number, question: any) => {
      const answer = attempt.answers.find((item: any) => item.questionId === question.id);
      const awarded =
        overrideByQuestionId.get(question.id) ??
        answer?.manualPointsAwarded ??
        answer?.pointsAwarded ??
        0;
      return sum + awarded;
    }, 0);

    const regraded: any = await prisma.$transaction(async (tx) => {
      for (const [questionId, pointsAwarded] of overrideByQuestionId.entries()) {
        await tx.assessmentAnswer.upsert({
          where: {
            tenantId_attemptId_questionId: {
              tenantId,
              attemptId: attempt.id,
              questionId,
            },
          },
          update: {
            manualPointsAwarded: pointsAwarded,
          },
          create: {
            tenantId,
            attemptId: attempt.id,
            questionId,
            manualPointsAwarded: pointsAwarded,
          },
        });
      }

      return tx.assessmentAttempt.update({
        where: { id: attempt.id },
        data: {
          manualScore: nextManualScore,
          manualFeedback: input.manualFeedback?.trim() ? input.manualFeedback.trim() : null,
          manuallyGradedAt: new Date(),
          manuallyGradedByUserId: actor.sub,
        },
        include: this.attemptInclude,
      });
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.ASSESSMENT_MANUAL_GRADE_OVERRIDDEN,
      entity: 'AssessmentAttempt',
      entityId: regraded.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        assessmentId: regraded.assessmentId,
        previousScore,
        manualScore: nextManualScore,
      },
    });

    await this.upsertExamMarkFromAttempt(tenantId, regraded, actor);

    return this.mapAttemptForStudent(regraded.assessment, regraded, true);
  }

  /**
   * Demo-ready bridge: make submitted quiz scores visible in report cards by mapping an AssessmentAttempt
   * to an Exam(CAT) + ExamMark row for the active term.
   *
   * This is intentionally conservative:
   * - skips if course has no subject (report cards are subject-scoped)
   * - skips if we cannot resolve an active term for the course academic year
   * - stores marks as percentage out of 100 to keep Exam.totalMarks <= 500 and consistent across quizzes
   */
  private async upsertExamMarkFromAttempt(tenantId: string, attempt: any, actor: JwtUser) {
    if (attempt.status !== AssessmentAttemptStatus.SUBMITTED) {
      return;
    }

    const course = attempt.assessment?.course;
    const subjectId: string | undefined = course?.subject?.id;
    const classRoomId: string | undefined = course?.classRoom?.id;
    const academicYearId: string | undefined = course?.academicYear?.id;
    const teacherUserId: string | undefined = course?.teacherUserId;

    if (!subjectId || !classRoomId || !academicYearId || !teacherUserId) {
      return;
    }

    const maxScore: number = attempt.maxScore ?? 0;
    const score: number = attempt.manualScore ?? attempt.autoScore ?? 0;
    if (maxScore <= 0) {
      return;
    }

    const now = new Date();
    const term = await prisma.term.findFirst({
      where: {
        tenantId,
        academicYearId,
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      orderBy: [{ sequence: 'desc' }],
      select: { id: true },
    });
    if (!term) {
      return;
    }

    const scheme = await prisma.gradingScheme.findFirst({
      where: { tenantId, isActive: true, isDefault: true },
      select: { id: true },
    });
    if (!scheme) {
      return;
    }

    const percentage = Math.max(0, Math.min(100, Math.round((score / maxScore) * 100)));
    const examName = `Quiz: ${String(attempt.assessment?.title ?? 'Assessment').trim()}`.slice(0, 120);

    await prisma.$transaction(async (tx) => {
      const exam = await tx.exam.upsert({
        where: {
          tenantId_termId_classRoomId_subjectId_name: {
            tenantId,
            termId: term.id,
            classRoomId,
            subjectId,
            name: examName,
          },
        },
        update: {
          academicYearId,
          gradingSchemeId: scheme.id,
          teacherUserId,
          examType: 'CAT',
          totalMarks: 100,
          weight: 100,
          updatedByUserId: actor.sub,
        },
        create: {
          tenantId,
          academicYearId,
          termId: term.id,
          classRoomId,
          subjectId,
          gradingSchemeId: scheme.id,
          teacherUserId,
          examType: 'CAT',
          name: examName,
          totalMarks: 100,
          weight: 100,
          examDate: attempt.submittedAt ? new Date(attempt.submittedAt) : null,
          createdByUserId: actor.sub,
          updatedByUserId: actor.sub,
        },
        select: { id: true },
      });

      await tx.examMark.upsert({
        where: {
          tenantId_examId_studentId: {
            tenantId,
            examId: exam.id,
            studentId: attempt.studentId,
          },
        },
        update: {
          marksObtained: percentage,
          status: 'PRESENT',
          updatedByUserId: actor.sub,
        },
        create: {
          tenantId,
          examId: exam.id,
          studentId: attempt.studentId,
          marksObtained: percentage,
          status: 'PRESENT',
          enteredByUserId: actor.sub,
          updatedByUserId: actor.sub,
        },
      });
    });
  }

  private readonly assessmentSummaryInclude: any = {
    course: {
      select: {
        id: true,
        title: true,
        teacherUserId: true,
        classRoom: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        academicYear: {
          select: {
            id: true,
            name: true,
          },
        },
        subject: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
    },
    lesson: {
      select: {
        id: true,
        title: true,
        sequence: true,
      },
    },
    _count: {
      select: {
        questions: true,
        attempts: true,
        studentAssignments: true,
      },
    },
  };

  private readonly attemptInclude: any = {
    assessment: {
      include: {
        course: {
          select: {
            id: true,
            title: true,
            teacherUserId: true,
            classRoom: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
            academicYear: {
              select: {
                id: true,
                name: true,
              },
            },
            subject: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
          },
        },
        lesson: {
          select: {
            id: true,
            title: true,
            sequence: true,
          },
        },
        questions: {
          include: {
            options: {
              orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
            },
          },
          orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
        },
      },
    },
    answers: true,
    student: {
      select: {
        id: true,
        studentCode: true,
        firstName: true,
        lastName: true,
      },
    },
    manuallyGradedByUser: {
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
    },
  };

  private async getCourseForManagement(tenantId: string, courseId: string) {
    const course = await prisma.course.findFirst({
      where: {
        id: courseId,
        tenantId,
        isActive: true,
      },
      select: {
        id: true,
        teacherUserId: true,
      },
    });

    if (!course) {
      throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found');
    }

    return course;
  }

  private async ensureLessonInCourse(tenantId: string, lessonId: string, courseId: string) {
    const lesson = await prisma.lesson.findFirst({
      where: {
        id: lessonId,
        tenantId,
        courseId,
      },
      select: {
        id: true,
      },
    });

    if (!lesson) {
      throw new AppError(404, 'LESSON_NOT_FOUND', 'Lesson not found');
    }
  }

  private async getQuestionForManagement(tenantId: string, questionId: string) {
    const question: any = await prisma.assessmentQuestion.findFirst({
      where: {
        id: questionId,
        tenantId,
      },
      include: {
        options: {
          orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
        },
        assessment: {
          include: {
            course: {
              select: {
                id: true,
                title: true,
                teacherUserId: true,
                classRoom: {
                  select: {
                    id: true,
                    code: true,
                    name: true,
                  },
                },
                academicYear: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
                subject: {
                  select: {
                    id: true,
                    code: true,
                    name: true,
                  },
                },
              },
            },
            lesson: {
              select: {
                id: true,
                title: true,
                sequence: true,
              },
            },
            _count: {
              select: {
                questions: true,
                attempts: true,
              },
            },
          },
        },
      },
    });

    if (!question) {
      throw new AppError(404, 'ASSESSMENT_QUESTION_NOT_FOUND', 'Assessment question not found');
    }

    return question;
  }

  private async getAssessmentForManagement(tenantId: string, assessmentId: string) {
    const assessment: any = await prisma.assessment.findFirst({
      where: {
        id: assessmentId,
        tenantId,
      },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            teacherUserId: true,
            classRoom: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
            academicYear: {
              select: {
                id: true,
                name: true,
              },
            },
            subject: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
          },
        },
        lesson: {
          select: {
            id: true,
            title: true,
            sequence: true,
          },
        },
        questions: {
          include: {
            options: {
              orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
            },
          },
          orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
        },
        _count: {
          select: {
            questions: true,
            attempts: true,
            studentAssignments: true,
          },
        },
        studentAssignments: {
          include: {
            student: {
              select: {
                id: true,
                studentCode: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });

    if (!assessment) {
      throw new AppError(404, 'ASSESSMENT_NOT_FOUND', 'Assessment not found');
    }

    return assessment;
  }

  private async getAssessmentForStudent(tenantId: string, assessmentId: string) {
    const assessment: any = await prisma.assessment.findFirst({
      where: {
        id: assessmentId,
        tenantId,
        isPublished: true,
      },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            teacherUserId: true,
            classRoomId: true,
            academicYearId: true,
            classRoom: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
            academicYear: {
              select: {
                id: true,
                name: true,
              },
            },
            subject: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
          },
        },
        lesson: {
          select: {
            id: true,
            title: true,
            sequence: true,
          },
        },
        questions: {
          include: {
            options: {
              orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
            },
          },
          orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });

    if (!assessment) {
      throw new AppError(404, 'ASSESSMENT_NOT_FOUND', 'Assessment not found');
    }

    return assessment;
  }

  private async getStudentProfile(tenantId: string, userId: string) {
    const student = await prisma.student.findFirst({
      where: {
        tenantId,
        userId,
        deletedAt: null,
        isActive: true,
      },
      include: {
        enrollments: {
          where: {
            isActive: true,
          },
          include: {
            academicYear: {
              select: {
                id: true,
                name: true,
              },
            },
            classRoom: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!student) {
      throw new AppError(403, 'STUDENT_PROFILE_NOT_FOUND', 'Student profile not found for current user');
    }

    return student;
  }

  private ensureStudentAssignedToCourse(
    student: Awaited<ReturnType<AssessmentsService['getStudentProfile']>>,
    classRoomId: string,
    academicYearId: string,
  ) {
    const assigned = student.enrollments.some(
      (enrollment) =>
        enrollment.classRoomId === classRoomId &&
        enrollment.academicYearId === academicYearId,
    );

    if (!assigned) {
      throw new AppError(403, 'ASSESSMENT_ACCESS_DENIED', 'Student is not assigned to this course');
    }
  }

  private async ensureStudentPortalAccess(
    tenantId: string,
    assessmentId: string,
    portalAssignOnly: boolean,
    studentId: string,
  ) {
    if (!portalAssignOnly) {
      return;
    }

    const row = await prisma.assessmentStudentAssignment.findFirst({
      where: {
        tenantId,
        assessmentId,
        studentId,
      },
      select: { id: true },
    });

    if (!row) {
      throw new AppError(403, 'ASSESSMENT_NOT_ASSIGNED', 'You are not assigned to this assessment');
    }
  }

  private ensureAccessCode(expected: string | null, provided: string | undefined) {
    if (!expected) {
      return;
    }
    const ok = provided && provided.trim() === expected;
    if (!ok) {
      throw new AppError(403, 'ASSESSMENT_CODE_INVALID', 'A valid exam access code is required');
    }
  }

  private ensureAssessmentOpen(dueAt: Date | null) {
    if (dueAt && dueAt < new Date()) {
      throw new AppError(400, 'ASSESSMENT_CLOSED', 'Assessment due date has passed');
    }
  }

  private ensureAttemptWithinTimeLimit(startedAt: Date, timeLimitMinutes: number | null) {
    if (!timeLimitMinutes) {
      return;
    }

    const expiresAt = startedAt.getTime() + timeLimitMinutes * 60_000;
    if (Date.now() > expiresAt) {
      throw new AppError(400, 'ASSESSMENT_TIME_LIMIT_EXCEEDED', 'Assessment time limit has been exceeded');
    }
  }

  private ensureAssessmentQuestionsEditable(assessment: {
    isPublished: boolean;
    _count: {
      attempts: number;
    };
  }) {
    if (assessment.isPublished) {
      throw new AppError(409, 'ASSESSMENT_ALREADY_PUBLISHED', 'Unpublish the assessment before editing questions');
    }

    if (assessment._count.attempts > 0) {
      throw new AppError(
        409,
        'ASSESSMENT_ALREADY_HAS_ATTEMPTS',
        'Questions are locked after students start attempting this assessment',
      );
    }
  }

  private validateAnswerSelection(
    questions: Array<{
      id: string;
      type: AssessmentQuestionType;
      options: Array<{
        id: string;
        questionId: string;
      }>;
    }>,
    answers: SaveAttemptAnswersInput['answers'],
  ) {
    const questionById = new Map(questions.map((question) => [question.id, question]));

    for (const answer of answers) {
      const question = questionById.get(answer.questionId);
      if (!question) {
        throw new AppError(400, 'ASSESSMENT_QUESTION_INVALID', 'Question does not belong to this assessment');
      }

      if (question.type === AssessmentQuestionType.MCQ_SINGLE && answer.textResponse?.trim()) {
        throw new AppError(400, 'ASSESSMENT_TEXT_RESPONSE_INVALID', 'MCQ questions do not accept text answers');
      }

      if (isOpenEndedQuestionType(question.type) && answer.selectedOptionId) {
        throw new AppError(400, 'ASSESSMENT_OPTION_INVALID', 'Written-response questions do not accept selected options');
      }

      if (
        question.type === AssessmentQuestionType.MCQ_SINGLE &&
        answer.selectedOptionId &&
        !question.options.some((option) => option.id === answer.selectedOptionId)
      ) {
        throw new AppError(400, 'ASSESSMENT_OPTION_INVALID', 'Selected option does not belong to this question');
      }
    }
  }

  private ensureCanAccessAttempt(
    attempt: any,
    actor: JwtUser,
  ) {
    if (this.isAdmin(actor)) {
      return;
    }

    if (actor.roles.includes('TEACHER') && actor.sub === attempt.assessment.course.teacherUserId) {
      return;
    }

    if (actor.roles.includes('STUDENT') && actor.sub === attempt.studentUserId) {
      return;
    }

    throw new AppError(403, 'ASSESSMENT_ATTEMPT_FORBIDDEN', 'You cannot access this assessment attempt');
  }

  private isTeacherOnly(actor: JwtUser) {
    return actor.roles.includes('TEACHER') && !this.isAdmin(actor);
  }

  private isAdmin(actor: JwtUser) {
    return actor.roles.includes('SUPER_ADMIN') || actor.roles.includes('SCHOOL_ADMIN');
  }

  private ensureCanManageCourse(teacherUserId: string, actor: JwtUser) {
    if (this.isAdmin(actor)) {
      return;
    }

    if (actor.roles.includes('TEACHER') && actor.sub === teacherUserId) {
      return;
    }

    throw new AppError(403, 'COURSE_MANAGE_FORBIDDEN', 'You cannot manage this course');
  }

  private mapStudentProfile(student: {
    id: string;
    studentCode: string;
    firstName: string;
    lastName: string;
  }) {
    return {
      id: student.id,
      studentCode: student.studentCode,
      firstName: student.firstName,
      lastName: student.lastName,
    };
  }

  private mapAssessmentSummary(
    assessment: any,
    options?: { forStudent?: boolean },
  ) {
    const assignedStudentCount = assessment._count?.studentAssignments ?? 0;
    const common = {
      id: assessment.id,
      type: assessment.type,
      title: assessment.title,
      instructions: assessment.instructions,
      dueAt: assessment.dueAt,
      timeLimitMinutes: assessment.timeLimitMinutes,
      maxAttempts: assessment.maxAttempts,
      isPublished: assessment.isPublished,
      publishedAt: assessment.publishedAt,
      portalAssignOnly: assessment.portalAssignOnly,
      createdAt: assessment.createdAt,
      updatedAt: assessment.updatedAt,
      course: {
        id: assessment.course.id,
        title: assessment.course.title,
        classRoom: assessment.course.classRoom,
        academicYear: assessment.course.academicYear,
        subject: assessment.course.subject,
      },
      lesson: assessment.lesson,
      counts: {
        questions: assessment._count.questions,
        attempts: assessment._count.attempts,
        assignedStudents: assignedStudentCount,
      },
    };

    if (options?.forStudent) {
      return {
        ...common,
        requiresAccessCode: Boolean(assessment.accessCode),
      };
    }

    return {
      ...common,
      accessCode: assessment.accessCode,
    };
  }

  private mapQuestionForTeacher(
    question: any,
  ) {
    return {
      id: question.id,
      prompt: question.prompt,
      explanation: question.explanation,
      hint: question.hint ?? null,
      remedialLessonId: question.remedialLessonId ?? null,
      type: question.type,
      sequence: question.sequence,
      points: question.points,
      options: question.options
        .slice()
        .sort((a: any, b: any) => a.sequence - b.sequence)
        .map((option: any) => ({
          id: option.id,
          label: option.label,
          sequence: option.sequence,
          isCorrect: option.isCorrect,
        })),
    };
  }

  private mapAssessmentDetail(assessment: any) {
    const assignedStudents =
      assessment.studentAssignments?.map((row: any) => ({
        id: row.student.id,
        studentCode: row.student.studentCode,
        firstName: row.student.firstName,
        lastName: row.student.lastName,
      })) ?? [];

    return {
      ...this.mapAssessmentSummary(assessment),
      assignedStudents,
      questions: assessment.questions.map((question: any) => this.mapQuestionForTeacher(question)),
    };
  }

  private mapAttemptSummary(
    attempt: {
      id: string;
      attemptNumber: number;
      status: AssessmentAttemptStatus;
      startedAt: Date;
      submittedAt: Date | null;
      autoScore: number | null;
      manualScore?: number | null;
      maxScore: number | null;
      manualFeedback?: string | null;
      manuallyGradedAt?: Date | null;
      manuallyGradedByUser?: {
        id: string;
        firstName: string;
        lastName: string;
      } | null;
      student?: {
        id: string;
        studentCode: string;
        firstName: string;
        lastName: string;
      };
    },
  ) {
    return {
      id: attempt.id,
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      autoScore: attempt.autoScore,
      manualScore: attempt.manualScore ?? null,
      score: this.getAttemptScore(attempt),
      maxScore: attempt.maxScore,
      manualFeedback: attempt.manualFeedback ?? null,
      manuallyGradedAt: attempt.manuallyGradedAt ?? null,
      manuallyGradedByUser: attempt.manuallyGradedByUser ?? null,
      student: attempt.student ?? null,
    };
  }

  private mapAttemptForStudent(
    assessment: any,
    attempt: any,
    includeCorrectness: boolean,
  ) {
    const answerByQuestionId = new Map<string, any>(
      attempt.answers.map((answer: any) => [answer.questionId, answer]),
    );

    return {
      id: attempt.id,
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      autoScore: attempt.autoScore,
      manualScore: attempt.manualScore ?? null,
      score: this.getAttemptScore(attempt),
      maxScore: attempt.maxScore,
      manualFeedback: attempt.manualFeedback ?? null,
      manuallyGradedAt: attempt.manuallyGradedAt ?? null,
      manuallyGradedByUser: attempt.manuallyGradedByUser ?? null,
      student: attempt.student
        ? {
            id: attempt.student.id,
            studentCode: attempt.student.studentCode,
            firstName: attempt.student.firstName,
            lastName: attempt.student.lastName,
          }
        : null,
      assessment: {
        id: assessment.id,
        type: assessment.type,
        title: assessment.title,
        instructions: assessment.instructions,
        dueAt: assessment.dueAt,
        timeLimitMinutes: assessment.timeLimitMinutes,
        maxAttempts: assessment.maxAttempts,
        course: {
          id: assessment.course.id,
          title: assessment.course.title,
          classRoom: assessment.course.classRoom,
          academicYear: assessment.course.academicYear,
          subject: assessment.course.subject,
        },
        lesson: assessment.lesson,
      },
      questions: assessment.questions.map((question: any) => {
        const answer = answerByQuestionId.get(question.id);
        const effectiveIsCorrect =
          answer?.manualPointsAwarded != null
            ? answer.manualPointsAwarded >= question.points
            : (answer?.isCorrect ?? false);
        return {
          id: question.id,
          prompt: question.prompt,
          explanation: includeCorrectness ? question.explanation : null,
          hint: question.hint ?? null,
          remedialLessonId: question.remedialLessonId ?? null,
          type: question.type,
          sequence: question.sequence,
          points: question.points,
          selectedOptionId: answer?.selectedOptionId ?? null,
          textResponse: answer?.textResponse ?? null,
          isCorrect: includeCorrectness ? effectiveIsCorrect : null,
          pointsAwarded: includeCorrectness ? (answer?.pointsAwarded ?? 0) : null,
          manualPointsAwarded: includeCorrectness ? (answer?.manualPointsAwarded ?? null) : null,
          effectivePointsAwarded: includeCorrectness
            ? (answer?.manualPointsAwarded ?? answer?.pointsAwarded ?? 0)
            : null,
          options: question.options
            .slice()
            .sort((a: any, b: any) => a.sequence - b.sequence)
            .map((option: any) => ({
              id: option.id,
              label: option.label,
              sequence: option.sequence,
              isCorrect: includeCorrectness ? option.isCorrect : undefined,
            })),
        };
      }),
    };
  }

  private getAttemptScore(attempt: {
    autoScore: number | null;
    manualScore?: number | null;
  }) {
    return attempt.manualScore ?? attempt.autoScore ?? 0;
  }
}
