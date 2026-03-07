import { Prisma, SubmissionStatus, UserStatus } from '@prisma/client';

import { AppError } from '../../common/errors/app-error';
import { JwtUser, RequestAuditContext } from '../../common/types/auth.types';
import { buildPagination } from '../../common/utils/pagination';
import { AUDIT_EVENT } from '../../constants/audit-events';
import { prisma } from '../../db/prisma';
import { AuditService } from '../audit/audit.service';
import {
  AssignCourseTeacherInput,
  AssignTeacherBySubjectInput,
  CourseDetailQueryInput,
  CreateAssignmentInput,
  CreateCourseInput,
  CreateLessonInput,
  CreateSubmissionInput,
  GradeSubmissionInput,
  ListCourseTeacherOptionsQueryInput,
  ListCourseSubjectOptionsQueryInput,
  ListAssignmentsQueryInput,
  ListAssignmentSubmissionsQueryInput,
  ListCoursesQueryInput,
  ListMyCoursesQueryInput,
  PublishLessonInput,
  UploadedAssetInput,
} from './lms.schemas';

type TxClient = Prisma.TransactionClient;

export class LmsService {
  private readonly auditService = new AuditService();

  async createCourse(
    tenantId: string,
    input: CreateCourseInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    await this.ensureAcademicTargets(tenantId, input.academicYearId, input.classRoomId, input.subjectId);
    const teacherUserId = await this.resolveCourseTeacherUserId(tenantId, input.teacherUserId, actor);

    if (this.isTeacherOnly(actor)) {
      if (!input.subjectId) {
        throw new AppError(
          400,
          'COURSE_SUBJECT_REQUIRED',
          'Subject is required when teachers create courses',
        );
      }

      await this.ensureTeacherCanUseSubject(tenantId, actor.sub, input.subjectId);
    }

    try {
      const created = await prisma.course.create({
        data: {
          tenantId,
          academicYearId: input.academicYearId,
          classRoomId: input.classRoomId,
          subjectId: input.subjectId,
          teacherUserId,
          title: input.title,
          description: input.description,
        },
        include: this.courseInclude,
      });

      await this.auditService.log({
        tenantId,
        actorUserId: actor.sub,
        event: AUDIT_EVENT.COURSE_CREATED,
        entity: 'Course',
        entityId: created.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        payload: {
          academicYearId: input.academicYearId,
          classRoomId: input.classRoomId,
          subjectId: input.subjectId ?? null,
          teacherUserId,
        },
      });

      return this.mapCourse(created);
    } catch (error) {
      this.handleUniqueError(error, 'Course title already exists for this class, year, and teacher');
      throw error;
    }
  }

  async listCourses(
    tenantId: string,
    query: ListCoursesQueryInput,
    actor: JwtUser,
  ) {
    const where: Prisma.CourseWhereInput = {
      tenantId,
      isActive: true,
      classRoomId: query.classId,
      academicYearId: query.academicYearId,
    };

    if (query.teacherUserId) {
      where.teacherUserId = query.teacherUserId;
    }

    if (this.isTeacherOnly(actor)) {
      where.teacherUserId = actor.sub;
    }

    const skip = (query.page - 1) * query.pageSize;

    const [totalItems, items] = await prisma.$transaction([
      prisma.course.count({ where }),
      prisma.course.findMany({
        where,
        skip,
        take: query.pageSize,
        include: {
          ...this.courseInclude,
          _count: {
            select: {
              lessons: true,
              assignments: true,
            },
          },
        },
        orderBy: [{ updatedAt: 'desc' }, { title: 'asc' }],
      }),
    ]);

    return {
      items: items.map((item) => ({
        ...this.mapCourse(item),
        counts: {
          lessons: item._count.lessons,
          assignments: item._count.assignments,
        },
      })),
      pagination: buildPagination(query.page, query.pageSize, totalItems),
    };
  }

  async listTeacherOptions(
    tenantId: string,
    query: ListCourseTeacherOptionsQueryInput,
    actor: JwtUser,
  ) {
    this.ensureAdminCanAssignTeacher(actor);

    return prisma.user.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: UserStatus.ACTIVE,
        userRoles: {
          some: {
            role: {
              name: 'TEACHER',
            },
          },
        },
        OR: query.q
          ? [
              {
                firstName: {
                  contains: query.q,
                  mode: 'insensitive',
                },
              },
              {
                lastName: {
                  contains: query.q,
                  mode: 'insensitive',
                },
              },
              {
                email: {
                  contains: query.q,
                  mode: 'insensitive',
                },
              },
            ]
          : undefined,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { email: 'asc' }],
    });
  }

  async listSubjectOptions(
    tenantId: string,
    query: ListCourseSubjectOptionsQueryInput,
    actor: JwtUser,
  ) {
    let subjectIds: string[] | undefined;

    if (this.isTeacherOnly(actor)) {
      const assigned = await prisma.course.findMany({
        where: {
          tenantId,
          isActive: true,
          teacherUserId: actor.sub,
          subjectId: {
            not: null,
          },
        },
        select: {
          subjectId: true,
        },
        distinct: ['subjectId'],
      });

      subjectIds = assigned.map((item) => item.subjectId).filter((id): id is string => Boolean(id));
      if (!subjectIds.length) {
        return [];
      }
    }

    return prisma.subject.findMany({
      where: {
        tenantId,
        isActive: true,
        ...(subjectIds ? { id: { in: subjectIds } } : {}),
        OR: query.q
          ? [
              {
                name: {
                  contains: query.q,
                  mode: 'insensitive',
                },
              },
              {
                code: {
                  contains: query.q,
                  mode: 'insensitive',
                },
              },
            ]
          : undefined,
      },
      select: {
        id: true,
        code: true,
        name: true,
      },
      orderBy: [{ name: 'asc' }, { code: 'asc' }],
    });
  }

  async assignCourseTeacher(
    tenantId: string,
    courseId: string,
    input: AssignCourseTeacherInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    this.ensureAdminCanAssignTeacher(actor);

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

    const teacherUserId = await this.resolveCourseTeacherUserId(
      tenantId,
      input.teacherUserId,
      actor,
    );

    if (teacherUserId === course.teacherUserId) {
      const currentCourse = await prisma.course.findFirst({
        where: {
          id: courseId,
          tenantId,
          isActive: true,
        },
        include: this.courseInclude,
      });

      if (!currentCourse) {
        throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found');
      }

      return this.mapCourse(currentCourse);
    }

    try {
      const updated = await prisma.course.update({
        where: {
          id: courseId,
        },
        data: {
          teacherUserId,
        },
        include: this.courseInclude,
      });

      await this.auditService.log({
        tenantId,
        actorUserId: actor.sub,
        event: AUDIT_EVENT.COURSE_TEACHER_ASSIGNED,
        entity: 'Course',
        entityId: updated.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        payload: {
          previousTeacherUserId: course.teacherUserId,
          teacherUserId,
        },
      });

      return this.mapCourse(updated);
    } catch (error) {
      this.handleUniqueError(
        error,
        'This teacher already has a course with the same title in this class and academic year',
      );
      throw error;
    }
  }

  async assignTeacherBySubject(
    tenantId: string,
    input: AssignTeacherBySubjectInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    this.ensureAdminCanAssignTeacher(actor);

    const teacherUserId = await this.resolveCourseTeacherUserId(
      tenantId,
      input.teacherUserId,
      actor,
    );

    const [academicYear, classRoom, subject] = await Promise.all([
      prisma.academicYear.findFirst({
        where: {
          id: input.academicYearId,
          tenantId,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
        },
      }),
      prisma.classRoom.findFirst({
        where: {
          id: input.classRoomId,
          tenantId,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          code: true,
        },
      }),
      prisma.subject.findFirst({
        where: {
          id: input.subjectId,
          tenantId,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          code: true,
        },
      }),
    ]);

    if (!academicYear) {
      throw new AppError(404, 'ACADEMIC_YEAR_NOT_FOUND', 'Academic year not found');
    }

    if (!classRoom) {
      throw new AppError(404, 'CLASS_ROOM_NOT_FOUND', 'Class room not found');
    }

    if (!subject) {
      throw new AppError(404, 'SUBJECT_NOT_FOUND', 'Subject not found');
    }

    const existing = await prisma.course.findFirst({
      where: {
        tenantId,
        isActive: true,
        academicYearId: input.academicYearId,
        classRoomId: input.classRoomId,
        subjectId: input.subjectId,
      },
      include: this.courseInclude,
      orderBy: [{ updatedAt: 'desc' }],
    });

    if (existing) {
      if (existing.teacherUser.id === teacherUserId) {
        return this.mapCourse(existing);
      }

      try {
        const updated = await prisma.course.update({
          where: {
            id: existing.id,
          },
          data: {
            teacherUserId,
          },
          include: this.courseInclude,
        });

        await this.auditService.log({
          tenantId,
          actorUserId: actor.sub,
          event: AUDIT_EVENT.COURSE_TEACHER_ASSIGNED,
          entity: 'Course',
          entityId: updated.id,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          payload: {
            assignmentType: 'SUBJECT',
            academicYearId: input.academicYearId,
            classRoomId: input.classRoomId,
            subjectId: input.subjectId,
            previousTeacherUserId: existing.teacherUser.id,
            teacherUserId,
          },
        });

        return this.mapCourse(updated);
      } catch (error) {
        this.handleUniqueError(
          error,
          'This teacher already has a course with the same title in this class and academic year',
        );
        throw error;
      }
    }

    const generatedTitle = `${subject.name} ${classRoom.name}`;

    try {
      const created = await prisma.course.create({
        data: {
          tenantId,
          academicYearId: input.academicYearId,
          classRoomId: input.classRoomId,
          subjectId: input.subjectId,
          teacherUserId,
          title: generatedTitle,
          description: `Auto-created for ${subject.name} in ${classRoom.name} (${academicYear.name}).`,
        },
        include: this.courseInclude,
      });

      await this.auditService.log({
        tenantId,
        actorUserId: actor.sub,
        event: AUDIT_EVENT.COURSE_TEACHER_ASSIGNED,
        entity: 'Course',
        entityId: created.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        payload: {
          assignmentType: 'SUBJECT',
          academicYearId: input.academicYearId,
          classRoomId: input.classRoomId,
          subjectId: input.subjectId,
          teacherUserId,
          autoCreated: true,
        },
      });

      return this.mapCourse(created);
    } catch (error) {
      this.handleUniqueError(
        error,
        'A matching subject course already exists for this teacher, class, and year',
      );
      throw error;
    }
  }

  async getCourseDetail(
    tenantId: string,
    courseId: string,
    query: CourseDetailQueryInput,
    actor: JwtUser,
  ) {
    const course = await prisma.course.findFirst({
      where: {
        id: courseId,
        tenantId,
        isActive: true,
      },
      include: this.courseInclude,
    });

    if (!course) {
      throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found');
    }

    this.ensureCanManageCourse(course.teacherUserId, actor);

    const lessonSkip = (query.lessonsPage - 1) * query.lessonsPageSize;
    const [lessonCount, lessons, assignments] = await prisma.$transaction([
      prisma.lesson.count({
        where: {
          tenantId,
          courseId,
        },
      }),
      prisma.lesson.findMany({
        where: {
          tenantId,
          courseId,
        },
        skip: lessonSkip,
        take: query.lessonsPageSize,
        include: {
          fileAsset: true,
        },
        orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.assignment.findMany({
        where: {
          tenantId,
          courseId,
        },
        include: {
          attachmentAsset: true,
          lesson: {
            select: {
              id: true,
              title: true,
            },
          },
          _count: {
            select: {
              submissions: true,
            },
          },
        },
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
      }),
    ]);

    return {
      course: this.mapCourse(course),
      lessons: {
        items: lessons.map((item) => this.mapLesson(item)),
        pagination: buildPagination(query.lessonsPage, query.lessonsPageSize, lessonCount),
      },
      assignments: assignments.map((item) => this.mapAssignment(item)),
    };
  }

  async createLesson(
    tenantId: string,
    courseId: string,
    input: CreateLessonInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
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

    this.ensureCanManageCourse(course.teacherUserId, actor);

    try {
      const created = await prisma.$transaction(async (tx) => {
        const assetId = await this.upsertFileAsset(tx, tenantId, input.asset, actor.sub);
        const sequence =
          input.sequence ??
          ((await tx.lesson.aggregate({
            where: {
              tenantId,
              courseId,
            },
            _max: {
              sequence: true,
            },
          }))._max.sequence ?? 0) + 1;

        return tx.lesson.create({
          data: {
            tenantId,
            courseId,
            title: input.title,
            summary: input.summary,
            contentType: input.contentType,
            body: input.body,
            externalUrl: input.externalUrl,
            fileAssetId: assetId,
            sequence,
            createdByUserId: actor.sub,
          },
          include: {
            fileAsset: true,
          },
        });
      });

      await this.auditService.log({
        tenantId,
        actorUserId: actor.sub,
        event: AUDIT_EVENT.LESSON_CREATED,
        entity: 'Lesson',
        entityId: created.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        payload: {
          courseId,
          contentType: created.contentType,
        },
      });

      return this.mapLesson(created);
    } catch (error) {
      this.handleUniqueError(error, 'Lesson sequence already exists for this course');
      throw error;
    }
  }

  async publishLesson(
    tenantId: string,
    lessonId: string,
    input: PublishLessonInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const lesson = await prisma.lesson.findFirst({
      where: {
        id: lessonId,
        tenantId,
      },
      include: {
        course: {
          select: {
            teacherUserId: true,
          },
        },
        fileAsset: true,
      },
    });

    if (!lesson) {
      throw new AppError(404, 'LESSON_NOT_FOUND', 'Lesson not found');
    }

    this.ensureCanManageCourse(lesson.course.teacherUserId, actor);

    const updated = await prisma.lesson.update({
      where: {
        id: lesson.id,
      },
      data: {
        isPublished: input.isPublished,
        publishedAt: input.isPublished ? new Date() : null,
        publishedByUserId: input.isPublished ? actor.sub : null,
      },
      include: {
        fileAsset: true,
      },
    });

    if (input.isPublished) {
      await this.auditService.log({
        tenantId,
        actorUserId: actor.sub,
        event: AUDIT_EVENT.LESSON_PUBLISHED,
        entity: 'Lesson',
        entityId: updated.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
    }

    return this.mapLesson(updated);
  }

  async createAssignment(
    tenantId: string,
    input: CreateAssignmentInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const course = await prisma.course.findFirst({
      where: {
        id: input.courseId,
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

    this.ensureCanManageCourse(course.teacherUserId, actor);

    if (input.lessonId) {
      const lesson = await prisma.lesson.findFirst({
        where: {
          id: input.lessonId,
          tenantId,
          courseId: input.courseId,
        },
        select: {
          id: true,
        },
      });

      if (!lesson) {
        throw new AppError(404, 'LESSON_NOT_FOUND', 'Lesson not found');
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const assetId = await this.upsertFileAsset(tx, tenantId, input.asset, actor.sub);
      return tx.assignment.create({
        data: {
          tenantId,
          courseId: input.courseId,
          lessonId: input.lessonId,
          title: input.title,
          instructions: input.instructions,
          attachmentAssetId: assetId,
          dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
          maxPoints: input.maxPoints,
          isPublished: input.isPublished,
          createdByUserId: actor.sub,
        },
        include: {
          attachmentAsset: true,
          lesson: {
            select: {
              id: true,
              title: true,
            },
          },
          _count: {
            select: {
              submissions: true,
            },
          },
        },
      });
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.ASSIGNMENT_CREATED,
      entity: 'Assignment',
      entityId: created.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        courseId: input.courseId,
      },
    });

    return this.mapAssignment(created);
  }

  async listAssignments(
    tenantId: string,
    query: ListAssignmentsQueryInput,
    actor: JwtUser,
  ) {
    const courseWhere: Prisma.CourseWhereInput = {};

    if (query.classId) {
      courseWhere.classRoomId = query.classId;
    }

    if (query.academicYearId) {
      courseWhere.academicYearId = query.academicYearId;
    }

    if (this.isTeacherOnly(actor)) {
      courseWhere.teacherUserId = actor.sub;
    }

    const where: Prisma.AssignmentWhereInput = {
      tenantId,
      courseId: query.courseId,
      ...(Object.keys(courseWhere).length > 0 ? { course: courseWhere } : {}),
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
    const [totalItems, items] = await prisma.$transaction([
      prisma.assignment.count({ where }),
      prisma.assignment.findMany({
        where,
        skip,
        take: query.pageSize,
        include: {
          attachmentAsset: true,
          lesson: {
            select: {
              id: true,
              title: true,
            },
          },
          course: {
            select: {
              id: true,
              title: true,
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
            },
          },
          _count: {
            select: {
              submissions: true,
            },
          },
        },
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
      }),
    ]);

    return {
      items: items.map((item) => this.mapAssignment(item)),
      pagination: buildPagination(query.page, query.pageSize, totalItems),
    };
  }

  async listAssignmentSubmissions(
    tenantId: string,
    assignmentId: string,
    query: ListAssignmentSubmissionsQueryInput,
    actor: JwtUser,
  ) {
    const assignment = await prisma.assignment.findFirst({
      where: {
        id: assignmentId,
        tenantId,
      },
      include: {
        course: {
          select: {
            teacherUserId: true,
          },
        },
      },
    });

    if (!assignment) {
      throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found');
    }

    this.ensureCanManageCourse(assignment.course.teacherUserId, actor);

    const where: Prisma.SubmissionWhereInput = {
      tenantId,
      assignmentId,
      status: query.status,
    };

    const skip = (query.page - 1) * query.pageSize;
    const [totalItems, items] = await prisma.$transaction([
      prisma.submission.count({ where }),
      prisma.submission.findMany({
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
          fileAsset: true,
          gradedByUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: [{ updatedAt: 'desc' }, { submittedAt: 'desc' }],
      }),
    ]);

    return {
      assignment: {
        id: assignment.id,
        title: assignment.title,
        maxPoints: assignment.maxPoints,
      },
      items: items.map((item) => this.mapSubmission(item)),
      pagination: buildPagination(query.page, query.pageSize, totalItems),
    };
  }

  async submitAssignment(
    tenantId: string,
    assignmentId: string,
    input: CreateSubmissionInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const student = await this.getStudentProfile(tenantId, actor.sub);
    const assignment = await prisma.assignment.findFirst({
      where: {
        id: assignmentId,
        tenantId,
        isPublished: true,
      },
      include: {
        course: true,
      },
    });

    if (!assignment) {
      throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found');
    }

    this.ensureStudentAssignedToCourse(student, assignment.course.classRoomId, assignment.course.academicYearId);

    if (assignment.dueAt && assignment.dueAt < new Date()) {
      throw new AppError(400, 'ASSIGNMENT_SUBMISSION_CLOSED', 'Assignment due date has passed');
    }

    const existing = await prisma.submission.findUnique({
      where: {
        tenantId_assignmentId_studentId: {
          tenantId,
          assignmentId,
          studentId: student.id,
        },
      },
    });

    if (existing?.status === SubmissionStatus.GRADED) {
      throw new AppError(409, 'SUBMISSION_ALREADY_GRADED', 'Submission has already been graded');
    }

    const submission = await prisma.$transaction(async (tx) => {
      const assetId = await this.upsertFileAsset(tx, tenantId, input.asset, actor.sub);
      return tx.submission.upsert({
        where: {
          tenantId_assignmentId_studentId: {
            tenantId,
            assignmentId,
            studentId: student.id,
          },
        },
        update: {
          textAnswer: input.textAnswer,
          linkUrl: input.linkUrl,
          fileAssetId: assetId,
          status: SubmissionStatus.SUBMITTED,
          submittedAt: new Date(),
          gradedAt: null,
          gradePoints: null,
          feedback: null,
          gradedByUserId: null,
          studentUserId: actor.sub,
        },
        create: {
          tenantId,
          assignmentId,
          studentId: student.id,
          studentUserId: actor.sub,
          textAnswer: input.textAnswer,
          linkUrl: input.linkUrl,
          fileAssetId: assetId,
        },
        include: {
          student: {
            select: {
              id: true,
              studentCode: true,
              firstName: true,
              lastName: true,
            },
          },
          fileAsset: true,
          gradedByUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.SUBMISSION_UPSERTED,
      entity: 'Submission',
      entityId: submission.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        assignmentId,
        studentId: student.id,
      },
    });

    return this.mapSubmission(submission);
  }

  async gradeSubmission(
    tenantId: string,
    submissionId: string,
    input: GradeSubmissionInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const submission = await prisma.submission.findFirst({
      where: {
        id: submissionId,
        tenantId,
      },
      include: {
        assignment: {
          include: {
            course: {
              select: {
                teacherUserId: true,
              },
            },
          },
        },
        student: {
          select: {
            id: true,
            studentCode: true,
            firstName: true,
            lastName: true,
          },
        },
        fileAsset: true,
        gradedByUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!submission) {
      throw new AppError(404, 'SUBMISSION_NOT_FOUND', 'Submission not found');
    }

    this.ensureCanManageCourse(submission.assignment.course.teacherUserId, actor);

    if (input.gradePoints > submission.assignment.maxPoints) {
      throw new AppError(
        400,
        'GRADE_EXCEEDS_MAX_POINTS',
        'Grade cannot exceed assignment max points',
      );
    }

    const updated = await prisma.submission.update({
      where: {
        id: submission.id,
      },
      data: {
        status: SubmissionStatus.GRADED,
        gradePoints: input.gradePoints,
        feedback: input.feedback,
        gradedAt: new Date(),
        gradedByUserId: actor.sub,
      },
      include: {
        student: {
          select: {
            id: true,
            studentCode: true,
            firstName: true,
            lastName: true,
          },
        },
        fileAsset: true,
        gradedByUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.SUBMISSION_GRADED,
      entity: 'Submission',
      entityId: updated.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        gradePoints: updated.gradePoints,
      },
    });

    return this.mapSubmission(updated);
  }

  async listMyCourses(
    tenantId: string,
    actor: JwtUser,
    query: ListMyCoursesQueryInput,
  ) {
    const student = await this.getStudentProfile(tenantId, actor.sub);
    const enrollmentPairs = student.enrollments.map((item) => ({
      classRoomId: item.classRoomId,
      academicYearId: item.academicYearId,
    }));

    if (!enrollmentPairs.length) {
      return {
        student: {
          id: student.id,
          studentCode: student.studentCode,
          firstName: student.firstName,
          lastName: student.lastName,
        },
        items: [],
        pagination: buildPagination(query.page, query.pageSize, 0),
      };
    }

    const skip = (query.page - 1) * query.pageSize;
    const where: Prisma.CourseWhereInput = {
      tenantId,
      isActive: true,
      OR: enrollmentPairs.map((pair) => ({
        classRoomId: pair.classRoomId,
        academicYearId: pair.academicYearId,
      })),
    };

    const [totalItems, items] = await prisma.$transaction([
      prisma.course.count({ where }),
      prisma.course.findMany({
        where,
        skip,
        take: query.pageSize,
        include: {
          ...this.courseInclude,
          lessons: {
            where: {
              isPublished: true,
            },
            include: {
              fileAsset: true,
            },
            orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
          },
          assignments: {
            where: {
              isPublished: true,
            },
            include: {
              attachmentAsset: true,
              submissions: {
                where: {
                  studentId: student.id,
                },
                include: {
                  student: {
                    select: {
                      id: true,
                      studentCode: true,
                      firstName: true,
                      lastName: true,
                    },
                  },
                  fileAsset: true,
                  gradedByUser: {
                    select: {
                      id: true,
                      firstName: true,
                      lastName: true,
                    },
                  },
                },
                take: 1,
              },
            },
            orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
          },
        },
        orderBy: [{ updatedAt: 'desc' }, { title: 'asc' }],
      }),
    ]);

    return {
      student: {
        id: student.id,
        studentCode: student.studentCode,
        firstName: student.firstName,
        lastName: student.lastName,
      },
      items: items.map((item) => ({
        ...this.mapCourse(item),
        lessons: item.lessons.map((lesson) => this.mapLesson(lesson)),
        assignments: item.assignments.map((assignment) => ({
          ...this.mapAssignment(assignment),
          mySubmission: assignment.submissions[0]
            ? this.mapSubmission(assignment.submissions[0])
            : null,
        })),
      })),
      pagination: buildPagination(query.page, query.pageSize, totalItems),
    };
  }

  private readonly courseInclude = {
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
    subject: {
      select: {
        id: true,
        code: true,
        name: true,
      },
    },
    teacherUser: {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
      },
    },
  } satisfies Prisma.CourseInclude;

  private async ensureAcademicTargets(
    tenantId: string,
    academicYearId: string,
    classRoomId: string,
    subjectId?: string,
  ) {
    const [academicYear, classRoom, subject] = await Promise.all([
      prisma.academicYear.findFirst({
        where: {
          id: academicYearId,
          tenantId,
          isActive: true,
        },
        select: {
          id: true,
        },
      }),
      prisma.classRoom.findFirst({
        where: {
          id: classRoomId,
          tenantId,
          isActive: true,
        },
        select: {
          id: true,
        },
      }),
      subjectId
        ? prisma.subject.findFirst({
            where: {
              id: subjectId,
              tenantId,
              isActive: true,
            },
            select: {
              id: true,
            },
          })
        : Promise.resolve(null),
    ]);

    if (!academicYear) {
      throw new AppError(404, 'ACADEMIC_YEAR_NOT_FOUND', 'Academic year not found');
    }

    if (!classRoom) {
      throw new AppError(404, 'CLASS_ROOM_NOT_FOUND', 'Class room not found');
    }

    if (subjectId && !subject) {
      throw new AppError(404, 'SUBJECT_NOT_FOUND', 'Subject not found');
    }
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
      throw new AppError(
        403,
        'STUDENT_PROFILE_NOT_FOUND',
        'Student profile not found for current user',
      );
    }

    return student;
  }

  private ensureStudentAssignedToCourse(
    student: Awaited<ReturnType<LmsService['getStudentProfile']>>,
    classRoomId: string,
    academicYearId: string,
  ) {
    const assigned = student.enrollments.some(
      (item) => item.classRoomId === classRoomId && item.academicYearId === academicYearId,
    );

    if (!assigned) {
      throw new AppError(
        403,
        'COURSE_ACCESS_DENIED',
        'Student is not assigned to this course class and academic year',
      );
    }
  }

  private isTeacherOnly(actor: JwtUser) {
    return actor.roles.includes('TEACHER') && !this.isAdmin(actor);
  }

  private isAdmin(actor: JwtUser) {
    return actor.roles.includes('SUPER_ADMIN') || actor.roles.includes('SCHOOL_ADMIN');
  }

  private ensureAdminCanAssignTeacher(actor: JwtUser) {
    if (this.isAdmin(actor)) {
      return;
    }

    throw new AppError(
      403,
      'COURSE_TEACHER_ASSIGN_FORBIDDEN',
      'Only administrators can assign teachers to courses',
    );
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

  private async ensureTeacherCanUseSubject(
    tenantId: string,
    teacherUserId: string,
    subjectId: string,
  ) {
    const assigned = await prisma.course.findFirst({
      where: {
        tenantId,
        isActive: true,
        teacherUserId,
        subjectId,
      },
      select: {
        id: true,
      },
    });

    if (!assigned) {
      throw new AppError(
        403,
        'COURSE_SUBJECT_NOT_ASSIGNED',
        'This subject is not assigned to the current teacher',
      );
    }
  }

  private async resolveCourseTeacherUserId(
    tenantId: string,
    requestedTeacherUserId: string | undefined,
    actor: JwtUser,
  ) {
    if (this.isTeacherOnly(actor)) {
      if (requestedTeacherUserId && requestedTeacherUserId !== actor.sub) {
        throw new AppError(
          403,
          'COURSE_TEACHER_ASSIGN_FORBIDDEN',
          'Teachers can only create courses assigned to themselves',
        );
      }

      return actor.sub;
    }

    if (!requestedTeacherUserId) {
      return actor.sub;
    }

    const teacher = await prisma.user.findFirst({
      where: {
        id: requestedTeacherUserId,
        tenantId,
        deletedAt: null,
        status: UserStatus.ACTIVE,
        userRoles: {
          some: {
            role: {
              name: 'TEACHER',
            },
          },
        },
      },
      select: {
        id: true,
      },
    });

    if (!teacher) {
      throw new AppError(404, 'COURSE_TEACHER_NOT_FOUND', 'Assigned teacher not found');
    }

    return teacher.id;
  }

  private async upsertFileAsset(
    tx: TxClient,
    tenantId: string,
    asset: UploadedAssetInput | undefined,
    uploadedByUserId: string,
  ) {
    if (!asset) {
      return undefined;
    }

    const created = await tx.fileAsset.upsert({
      where: {
        tenantId_publicId: {
          tenantId,
          publicId: asset.publicId,
        },
      },
      update: {
        secureUrl: asset.secureUrl,
        originalName: asset.originalName,
        bytes: asset.bytes,
        format: asset.format,
        mimeType: asset.mimeType,
        resourceType: asset.resourceType,
      },
      create: {
        tenantId,
        uploadedByUserId,
        publicId: asset.publicId,
        secureUrl: asset.secureUrl,
        originalName: asset.originalName,
        bytes: asset.bytes,
        format: asset.format,
        mimeType: asset.mimeType,
        resourceType: asset.resourceType,
      },
    });

    return created.id;
  }

  private mapCourse(course: {
    id: string;
    title: string;
    description: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    academicYear: { id: string; name: string };
    classRoom: { id: string; code: string; name: string };
    subject: { id: string; code: string; name: string } | null;
    teacherUser: { id: string; firstName: string; lastName: string; email: string };
  }) {
    return {
      id: course.id,
      title: course.title,
      description: course.description,
      isActive: course.isActive,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
      academicYear: course.academicYear,
      classRoom: course.classRoom,
      subject: course.subject,
      teacher: course.teacherUser,
    };
  }

  private mapLesson(lesson: {
    id: string;
    title: string;
    summary: string | null;
    contentType: string;
    body: string | null;
    externalUrl: string | null;
    sequence: number;
    isPublished: boolean;
    publishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    fileAsset?: {
      id: string;
      secureUrl: string;
      originalName: string;
      format: string | null;
      mimeType: string | null;
      resourceType: string;
      bytes: number | null;
    } | null;
  }) {
    return {
      id: lesson.id,
      title: lesson.title,
      summary: lesson.summary,
      contentType: lesson.contentType,
      body: lesson.body,
      externalUrl: lesson.externalUrl,
      sequence: lesson.sequence,
      isPublished: lesson.isPublished,
      publishedAt: lesson.publishedAt,
      createdAt: lesson.createdAt,
      updatedAt: lesson.updatedAt,
      fileAsset: lesson.fileAsset
        ? {
            id: lesson.fileAsset.id,
            secureUrl: lesson.fileAsset.secureUrl,
            originalName: lesson.fileAsset.originalName,
            format: lesson.fileAsset.format,
            mimeType: lesson.fileAsset.mimeType,
            resourceType: lesson.fileAsset.resourceType,
            bytes: lesson.fileAsset.bytes,
          }
        : null,
    };
  }

  private mapAssignment(assignment: {
    id: string;
    title: string;
    instructions: string;
    dueAt: Date | null;
    maxPoints: number;
    isPublished: boolean;
    createdAt: Date;
    updatedAt: Date;
    lesson?: { id: string; title: string } | null;
    course?: {
      id: string;
      title: string;
      classRoom: {
        id: string;
        code: string;
        name: string;
      };
      academicYear: {
        id: string;
        name: string;
      };
    };
    attachmentAsset?: {
      id: string;
      secureUrl: string;
      originalName: string;
      format: string | null;
      mimeType: string | null;
      resourceType: string;
      bytes: number | null;
    } | null;
    _count?: {
      submissions: number;
    };
  }) {
    return {
      id: assignment.id,
      title: assignment.title,
      instructions: assignment.instructions,
      dueAt: assignment.dueAt,
      maxPoints: assignment.maxPoints,
      isPublished: assignment.isPublished,
      createdAt: assignment.createdAt,
      updatedAt: assignment.updatedAt,
      lesson: assignment.lesson ?? null,
      course: assignment.course ?? null,
      attachmentAsset: assignment.attachmentAsset
        ? {
            id: assignment.attachmentAsset.id,
            secureUrl: assignment.attachmentAsset.secureUrl,
            originalName: assignment.attachmentAsset.originalName,
            format: assignment.attachmentAsset.format,
            mimeType: assignment.attachmentAsset.mimeType,
            resourceType: assignment.attachmentAsset.resourceType,
            bytes: assignment.attachmentAsset.bytes,
          }
        : null,
      submissionCount: assignment._count?.submissions ?? 0,
    };
  }

  private mapSubmission(submission: {
    id: string;
    textAnswer: string | null;
    linkUrl: string | null;
    status: SubmissionStatus;
    submittedAt: Date;
    gradedAt: Date | null;
    gradePoints: number | null;
    feedback: string | null;
    createdAt: Date;
    updatedAt: Date;
    student: {
      id: string;
      studentCode: string;
      firstName: string;
      lastName: string;
    };
    fileAsset?: {
      id: string;
      secureUrl: string;
      originalName: string;
      format: string | null;
      mimeType: string | null;
      resourceType: string;
      bytes: number | null;
    } | null;
    gradedByUser?: {
      id: string;
      firstName: string;
      lastName: string;
    } | null;
  }) {
    return {
      id: submission.id,
      textAnswer: submission.textAnswer,
      linkUrl: submission.linkUrl,
      status: submission.status,
      submittedAt: submission.submittedAt,
      gradedAt: submission.gradedAt,
      gradePoints: submission.gradePoints,
      feedback: submission.feedback,
      createdAt: submission.createdAt,
      updatedAt: submission.updatedAt,
      student: submission.student,
      fileAsset: submission.fileAsset
        ? {
            id: submission.fileAsset.id,
            secureUrl: submission.fileAsset.secureUrl,
            originalName: submission.fileAsset.originalName,
            format: submission.fileAsset.format,
            mimeType: submission.fileAsset.mimeType,
            resourceType: submission.fileAsset.resourceType,
            bytes: submission.fileAsset.bytes,
          }
        : null,
      gradedBy: submission.gradedByUser ?? null,
    };
  }

  private handleUniqueError(error: unknown, message: string): never | void {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new AppError(409, 'UNIQUE_CONSTRAINT_VIOLATION', message, error.meta);
    }
  }
}
