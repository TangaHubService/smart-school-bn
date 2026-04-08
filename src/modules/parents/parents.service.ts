import { Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';

import { AppError } from '../../common/errors/app-error';
import { JwtUser, RequestAuditContext } from '../../common/types/auth.types';
import { buildPagination } from '../../common/utils/pagination';
import { env } from '../../config/env';
import { AUDIT_EVENT } from '../../constants/audit-events';
import { PERMISSIONS } from '../../constants/permissions';
import { prisma } from '../../db/prisma';
import { AuditService } from '../audit/audit.service';
import {
  CreateParentInput,
  ListLinkableStudentsQueryInput,
  LinkParentStudentInput,
  ListParentsQueryInput,
  ParentStudentAttendanceHistoryQueryInput,
  UpdateParentInput,
} from './parents.schemas';

export class ParentsService {
  private readonly auditService = new AuditService();

  async listParents(tenantId: string, query: ListParentsQueryInput) {
    const where: Prisma.ParentWhereInput = {
      tenantId,
      deletedAt: null,
      isActive: true,
    };

    if (query.q) {
      where.OR = [
        {
          parentCode: {
            contains: query.q,
            mode: 'insensitive',
          },
        },
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
        {
          phone: {
            contains: query.q,
            mode: 'insensitive',
          },
        },
      ];
    }

    const skip = (query.page - 1) * query.pageSize;

    const [totalItems, parents] = await prisma.$transaction([
      prisma.parent.count({ where }),
      prisma.parent.findMany({
        where,
        skip,
        take: query.pageSize,
        include: {
          students: {
            where: {
              deletedAt: null,
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
            },
          },
          user: {
            select: {
              id: true,
              email: true,
            },
          },
        },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      }),
    ]);

    return {
      items: parents.map((parent) => ({
        id: parent.id,
        parentCode: parent.parentCode,
        firstName: parent.firstName,
        lastName: parent.lastName,
        email: parent.email,
        phone: parent.phone,
        hasLogin: Boolean(parent.userId),
        user: parent.user,
        linkedStudentsCount: parent.students.length,
        linkedStudents: parent.students.map((link) => ({
          id: link.student.id,
          studentCode: link.student.studentCode,
          firstName: link.student.firstName,
          lastName: link.student.lastName,
          relationship: link.relationship,
          isPrimary: link.isPrimary,
        })),
      })),
      pagination: buildPagination(query.page, query.pageSize, totalItems),
    };
  }

  async createParent(
    tenantId: string,
    input: CreateParentInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    if (input.createLogin && !input.email) {
      throw new AppError(
        400,
        'PARENT_EMAIL_REQUIRED',
        'email is required when createLogin is true',
      );
    }

    if (input.createLogin && !input.password) {
      throw new AppError(
        400,
        'PARENT_PASSWORD_REQUIRED',
        'password is required when createLogin is true',
      );
    }

    try {
      const created = await prisma.$transaction(async (tx) => {
        let userId: string | null = null;

        if (input.createLogin) {
          const parentRole = await tx.role.upsert({
            where: {
              tenantId_name: {
                tenantId,
                name: 'PARENT',
              },
            },
            update: {
              isSystem: true,
              permissions: [PERMISSIONS.PARENT_MY_CHILDREN_READ, PERMISSIONS.REPORT_CARDS_MY_READ],
            },
            create: {
              tenantId,
              name: 'PARENT',
              description: 'Parent portal role',
              isSystem: true,
              permissions: [PERMISSIONS.PARENT_MY_CHILDREN_READ, PERMISSIONS.REPORT_CARDS_MY_READ],
            },
          });

          const passwordHash = await bcrypt.hash(input.password!, env.BCRYPT_ROUNDS);

          const existingUser = await tx.user.findFirst({
            where: {
              tenantId,
              email: input.email!,
              deletedAt: null,
            },
            select: {
              id: true,
            },
          });

          if (existingUser) {
            userId = existingUser.id;

            await tx.user.update({
              where: {
                id: existingUser.id,
              },
              data: {
                firstName: input.firstName,
                lastName: input.lastName,
                passwordHash,
                status: 'ACTIVE',
                deletedAt: null,
              },
            });
          } else {
            const user = await tx.user.create({
              data: {
                tenantId,
                email: input.email!,
                firstName: input.firstName,
                lastName: input.lastName,
                passwordHash,
                status: 'ACTIVE',
              },
            });

            userId = user.id;
          }

          await tx.userRole.upsert({
            where: {
              tenantId_userId_roleId: {
                tenantId,
                userId,
                roleId: parentRole.id,
              },
            },
            update: {},
            create: {
              tenantId,
              userId,
              roleId: parentRole.id,
              assignedById: actor.sub,
            },
          });
        }

        const parent = await tx.parent.create({
          data: {
            tenantId,
            userId,
            parentCode: input.parentCode,
            firstName: input.firstName,
            lastName: input.lastName,
            email: input.email,
            phone: input.phone,
            isActive: true,
          },
        });

        return parent;
      });

      await this.auditService.log({
        tenantId,
        actorUserId: actor.sub,
        event: AUDIT_EVENT.PARENT_CREATED,
        entity: 'Parent',
        entityId: created.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        payload: {
          email: created.email,
          hasLogin: Boolean(created.userId),
        },
      });

      return {
        id: created.id,
        parentCode: created.parentCode,
        firstName: created.firstName,
        lastName: created.lastName,
        email: created.email,
        phone: created.phone,
        hasLogin: Boolean(created.userId),
      };
    } catch (error) {
      this.handleUniqueError(error, 'Parent code/email already exists');
      throw error;
    }
  }

  async updateParent(
    tenantId: string,
    parentId: string,
    input: UpdateParentInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const existingParent = await prisma.parent.findFirst({
      where: {
        id: parentId,
        tenantId,
        deletedAt: null,
      },
    });

    if (!existingParent) {
      throw new AppError(404, 'PARENT_NOT_FOUND', 'Parent not found');
    }

    if (input.createLogin && !input.email && !existingParent.email) {
      throw new AppError(
        400,
        'PARENT_EMAIL_REQUIRED',
        'email is required when createLogin is true',
      );
    }

    if (input.createLogin && !input.password) {
      throw new AppError(
        400,
        'PARENT_PASSWORD_REQUIRED',
        'password is required when createLogin is true',
      );
    }

    try {
      const updated = await prisma.$transaction(async (tx) => {
        let userId = existingParent.userId;
        const nextEmail =
          input.email === undefined
            ? existingParent.email
            : input.email;

        const nextFirstName = input.firstName ?? existingParent.firstName;
        const nextLastName = input.lastName ?? existingParent.lastName;

        if (input.createLogin) {
          const parentRole = await tx.role.upsert({
            where: {
              tenantId_name: {
                tenantId,
                name: 'PARENT',
              },
            },
            update: {
              isSystem: true,
              permissions: [PERMISSIONS.PARENT_MY_CHILDREN_READ, PERMISSIONS.REPORT_CARDS_MY_READ],
            },
            create: {
              tenantId,
              name: 'PARENT',
              description: 'Parent portal role',
              isSystem: true,
              permissions: [PERMISSIONS.PARENT_MY_CHILDREN_READ, PERMISSIONS.REPORT_CARDS_MY_READ],
            },
          });

          const passwordHash = await bcrypt.hash(input.password!, env.BCRYPT_ROUNDS);

          const targetEmail = nextEmail;
          if (!targetEmail) {
            throw new AppError(
              400,
              'PARENT_EMAIL_REQUIRED',
              'email is required when createLogin is true',
            );
          }

          const existingUser = await tx.user.findFirst({
            where: {
              tenantId,
              email: targetEmail,
              deletedAt: null,
            },
            select: {
              id: true,
            },
          });

          if (existingUser) {
            userId = existingUser.id;
            await tx.user.update({
              where: { id: existingUser.id },
              data: {
                firstName: nextFirstName,
                lastName: nextLastName,
                passwordHash,
                status: 'ACTIVE',
                deletedAt: null,
              },
            });
          } else {
            const createdUser = await tx.user.create({
              data: {
                tenantId,
                email: targetEmail,
                firstName: nextFirstName,
                lastName: nextLastName,
                passwordHash,
                status: 'ACTIVE',
              },
            });

            userId = createdUser.id;
          }

          await tx.userRole.upsert({
            where: {
              tenantId_userId_roleId: {
                tenantId,
                userId,
                roleId: parentRole.id,
              },
            },
            update: {},
            create: {
              tenantId,
              userId,
              roleId: parentRole.id,
              assignedById: actor.sub,
            },
          });
        } else if (userId) {
          if (nextEmail === null) {
            throw new AppError(
              400,
              'PARENT_EMAIL_REQUIRED',
              'email cannot be removed for a parent with login',
            );
          }

          const nextPasswordHash = input.password
            ? await bcrypt.hash(input.password, env.BCRYPT_ROUNDS)
            : undefined;

          await tx.user.update({
            where: { id: userId },
            data: {
              email: nextEmail ?? undefined,
              firstName: nextFirstName,
              lastName: nextLastName,
              passwordHash: nextPasswordHash,
            },
          });
        }

        return tx.parent.update({
          where: { id: parentId },
          data: {
            parentCode: input.parentCode,
            firstName: input.firstName,
            lastName: input.lastName,
            email:
              input.email === undefined
                ? undefined
                : input.email,
            phone:
              input.phone === undefined
                ? undefined
                : input.phone,
            isActive: input.isActive,
            userId,
          },
        });
      });

      await this.auditService.log({
        tenantId,
        actorUserId: actor.sub,
        event: AUDIT_EVENT.PARENT_UPDATED,
        entity: 'Parent',
        entityId: updated.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return {
        id: updated.id,
        parentCode: updated.parentCode,
        firstName: updated.firstName,
        lastName: updated.lastName,
        email: updated.email,
        phone: updated.phone,
        hasLogin: Boolean(updated.userId),
        isActive: updated.isActive,
      };
    } catch (error) {
      this.handleUniqueError(error, 'Parent code/email already exists');
      throw error;
    }
  }

  async listLinkableStudents(
    tenantId: string,
    query: ListLinkableStudentsQueryInput,
  ) {
    const students = await prisma.student.findMany({
      where: {
        tenantId,
        deletedAt: null,
        isActive: true,
        enrollments: query.classId
          ? {
              some: {
                isActive: true,
                classRoomId: query.classId,
              },
            }
          : undefined,
        OR: query.q
          ? [
              {
                studentCode: {
                  contains: query.q,
                  mode: 'insensitive',
                },
              },
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
            ]
          : undefined,
      },
      select: {
        id: true,
        studentCode: true,
        firstName: true,
        lastName: true,
        enrollments: {
          where: {
            isActive: true,
          },
          orderBy: [{ enrolledAt: 'desc' }],
          take: 1,
          select: {
            id: true,
            enrolledAt: true,
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
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: query.pageSize,
    });

    return students.map((student) => ({
      id: student.id,
      studentCode: student.studentCode,
      firstName: student.firstName,
      lastName: student.lastName,
      currentEnrollment: student.enrollments[0]
        ? {
            id: student.enrollments[0].id,
            enrolledAt: student.enrollments[0].enrolledAt.toISOString(),
            academicYear: student.enrollments[0].academicYear,
            classRoom: student.enrollments[0].classRoom,
          }
        : null,
    }));
  }

  async linkStudent(
    tenantId: string,
    parentId: string,
    input: LinkParentStudentInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const [parent, student] = await prisma.$transaction([
      prisma.parent.findFirst({
        where: {
          id: parentId,
          tenantId,
          deletedAt: null,
          isActive: true,
        },
      }),
      prisma.student.findFirst({
        where: {
          id: input.studentId,
          tenantId,
          deletedAt: null,
          isActive: true,
        },
      }),
    ]);

    if (!parent) {
      throw new AppError(404, 'PARENT_NOT_FOUND', 'Parent not found');
    }

    if (!student) {
      throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student not found');
    }

    const link = await prisma.$transaction(async (tx) => {
      if (input.isPrimary) {
        await tx.parentStudent.updateMany({
          where: {
            tenantId,
            studentId: input.studentId,
            deletedAt: null,
          },
          data: {
            isPrimary: false,
          },
        });
      }

      return tx.parentStudent.upsert({
        where: {
          tenantId_parentId_studentId: {
            tenantId,
            parentId,
            studentId: input.studentId,
          },
        },
        update: {
          relationship: input.relationship,
          isPrimary: input.isPrimary,
          deletedAt: null,
        },
        create: {
          tenantId,
          parentId,
          studentId: input.studentId,
          relationship: input.relationship,
          isPrimary: input.isPrimary,
        },
        include: {
          parent: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
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
        },
      });
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.PARENT_LINKED_TO_STUDENT,
      entity: 'ParentStudent',
      entityId: link.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        parentId,
        studentId: input.studentId,
        relationship: input.relationship,
        isPrimary: input.isPrimary,
      },
    });

    return {
      id: link.id,
      relationship: link.relationship,
      isPrimary: link.isPrimary,
      parent: link.parent,
      student: link.student,
    };
  }

  async listMyStudents(tenantId: string, userId: string) {
    const parent = await prisma.parent.findFirst({
      where: {
        tenantId,
        userId,
        deletedAt: null,
        isActive: true,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
    });

    if (!parent) {
      return {
        parent: null,
        students: [],
      };
    }

    const links = await prisma.parentStudent.findMany({
      where: {
        tenantId,
        parentId: parent.id,
        deletedAt: null,
      },
      include: {
        student: {
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
              orderBy: {
                updatedAt: 'desc',
              },
              take: 1,
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const linkedStudentIds = links.map((link) => link.student.id);
    const lastThirtyDays = this.parseSchoolDate(this.getTodaySchoolDate());
    lastThirtyDays.setUTCDate(lastThirtyDays.getUTCDate() - 30);

    const attendanceRecords = linkedStudentIds.length
      ? await prisma.attendanceRecord.findMany({
          where: {
            tenantId,
            studentId: {
              in: linkedStudentIds,
            },
            attendanceDate: {
              gte: lastThirtyDays,
            },
          },
          select: {
            studentId: true,
            status: true,
            attendanceDate: true,
          },
        })
      : [];

    const attendanceByStudentId = new Map<
      string,
      {
        total: number;
        present: number;
        absent: number;
        late: number;
        excused: number;
        lastMarkedDate: string | null;
      }
    >();

    for (const record of attendanceRecords) {
      const current = attendanceByStudentId.get(record.studentId) ?? {
        total: 0,
        present: 0,
        absent: 0,
        late: 0,
        excused: 0,
        lastMarkedDate: null,
      };

      current.total += 1;
      current.present += record.status === 'PRESENT' ? 1 : 0;
      current.absent += record.status === 'ABSENT' ? 1 : 0;
      current.late += record.status === 'LATE' ? 1 : 0;
      current.excused += record.status === 'EXCUSED' ? 1 : 0;

      const recordDate = this.toSchoolDateString(record.attendanceDate);
      if (!current.lastMarkedDate || recordDate > current.lastMarkedDate) {
        current.lastMarkedDate = recordDate;
      }

      attendanceByStudentId.set(record.studentId, current);
    }

    return {
      parent,
      students: links.map((link) => ({
        id: link.student.id,
        studentCode: link.student.studentCode,
        firstName: link.student.firstName,
        lastName: link.student.lastName,
        gender: link.student.gender,
        dateOfBirth: link.student.dateOfBirth,
        relationship: link.relationship,
        isPrimary: link.isPrimary,
        currentEnrollment: link.student.enrollments[0]
          ? {
              id: link.student.enrollments[0].id,
              enrolledAt: link.student.enrollments[0].enrolledAt,
              academicYear: link.student.enrollments[0].academicYear,
              classRoom: link.student.enrollments[0].classRoom,
            }
          : null,
        attendanceLast30Days:
          attendanceByStudentId.get(link.student.id) ?? {
            total: 0,
            present: 0,
            absent: 0,
            late: 0,
            excused: 0,
            lastMarkedDate: null,
          },
      })),
    };
  }

  async getMyStudentAttendance(
    tenantId: string,
    userId: string,
    studentId: string,
    query: ParentStudentAttendanceHistoryQueryInput,
  ) {
    const parent = await prisma.parent.findFirst({
      where: {
        tenantId,
        userId,
        deletedAt: null,
        isActive: true,
      },
      select: {
        id: true,
      },
    });

    if (!parent) {
      throw new AppError(404, 'PARENT_NOT_FOUND', 'Parent profile not found');
    }

    const link = await prisma.parentStudent.findFirst({
      where: {
        tenantId,
        parentId: parent.id,
        studentId,
        deletedAt: null,
      },
      include: {
        student: {
          select: {
            id: true,
            studentCode: true,
            firstName: true,
            lastName: true,
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
              orderBy: {
                updatedAt: 'desc',
              },
              take: 1,
            },
          },
        },
      },
    });

    if (!link) {
      throw new AppError(
        404,
        'CHILD_NOT_LINKED',
        'Student is not linked to the current parent account',
      );
    }

    const toDate = query.to
      ? this.parseSchoolDate(query.to)
      : this.parseSchoolDate(this.getTodaySchoolDate());
    const fromDate = query.from
      ? this.parseSchoolDate(query.from)
      : new Date(
          Date.UTC(
            toDate.getUTCFullYear(),
            toDate.getUTCMonth(),
            toDate.getUTCDate() - 30,
          ),
        );

    const records = await prisma.attendanceRecord.findMany({
      where: {
        tenantId,
        studentId,
        attendanceDate: {
          gte: fromDate,
          lte: toDate,
        },
      },
      include: {
        classRoom: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
      orderBy: [{ attendanceDate: 'desc' }, { updatedAt: 'desc' }],
      take: 1000,
    });

    return {
      student: {
        id: link.student.id,
        studentCode: link.student.studentCode,
        firstName: link.student.firstName,
        lastName: link.student.lastName,
        currentEnrollment: link.student.enrollments[0]
          ? {
              id: link.student.enrollments[0].id,
              enrolledAt: link.student.enrollments[0].enrolledAt,
              academicYear: link.student.enrollments[0].academicYear,
              classRoom: link.student.enrollments[0].classRoom,
            }
          : null,
      },
      range: {
        from: this.toSchoolDateString(fromDate),
        to: this.toSchoolDateString(toDate),
      },
      summary: {
        total: records.length,
        present: records.filter((item) => item.status === 'PRESENT').length,
        absent: records.filter((item) => item.status === 'ABSENT').length,
        late: records.filter((item) => item.status === 'LATE').length,
        excused: records.filter((item) => item.status === 'EXCUSED').length,
      },
      records: records.map((record) => ({
        id: record.id,
        date: this.toSchoolDateString(record.attendanceDate),
        status: record.status,
        remarks: record.remarks,
        classRoom: record.classRoom,
        markedAt: record.markedAt,
        updatedAt: record.updatedAt,
      })),
    };
  }

  async getMyStudentLearning(tenantId: string, userId: string, studentId: string) {
    const parent = await prisma.parent.findFirst({
      where: { tenantId, userId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!parent) {
      throw new AppError(403, 'PARENT_NOT_FOUND', 'Parent profile not found');
    }
    const link = await prisma.parentStudent.findFirst({
      where: { tenantId, parentId: parent.id, studentId, deletedAt: null },
      select: { id: true },
    });
    if (!link) {
      throw new AppError(404, 'STUDENT_NOT_LINKED', 'Student is not linked to this account');
    }
    const student = await prisma.student.findFirst({
      where: { id: studentId, tenantId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!student) {
      throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student not found');
    }

    const enrollments = await prisma.studentEnrollment.findMany({
      where: { tenantId, studentId, isActive: true },
      select: { classRoomId: true, academicYearId: true },
    });
    if (enrollments.length === 0) {
      return {
        student: { id: student.id, firstName: student.firstName, lastName: student.lastName },
        courses: [] as Array<{
          courseId: string;
          title: string;
          completedLessons: number;
          totalPublishedLessons: number;
          progressPercent: number;
        }>,
        recentAttempts: [] as Array<{
          id: string;
          assessmentTitle: string;
          courseTitle: string;
          score: number;
          maxScore: number;
          submittedAt: string;
        }>,
      };
    }

    const courses = await prisma.course.findMany({
      where: {
        tenantId,
        isActive: true,
        OR: enrollments.map((e) => ({
          classRoomId: e.classRoomId,
          academicYearId: e.academicYearId,
        })),
      },
      select: {
        id: true,
        title: true,
      },
    });

    const lessonLists = await prisma.lesson.findMany({
      where: {
        tenantId,
        courseId: { in: courses.map((c) => c.id) },
        isPublished: true,
      },
      select: { id: true, courseId: true },
    });
    const lessonIdsByCourse = new Map<string, string[]>();
    for (const l of lessonLists) {
      if (!lessonIdsByCourse.has(l.courseId)) lessonIdsByCourse.set(l.courseId, []);
      lessonIdsByCourse.get(l.courseId)!.push(l.id);
    }

    const progressRows = await prisma.studentLessonProgress.findMany({
      where: {
        tenantId,
        studentId,
        isCompleted: true,
        lessonId: { in: lessonLists.map((l) => l.id) },
      },
      select: { lessonId: true },
    });
    const doneLessons = new Set(progressRows.map((p) => p.lessonId));

    const courseSummaries = courses.map((c) => {
      const lids = lessonIdsByCourse.get(c.id) ?? [];
      const total = lids.length;
      const done = lids.filter((id) => doneLessons.has(id)).length;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      return {
        courseId: c.id,
        title: c.title,
        completedLessons: done,
        totalPublishedLessons: total,
        progressPercent: pct,
      };
    });

    const recentAttempts = await prisma.assessmentAttempt.findMany({
      where: { tenantId, studentId, submittedAt: { not: null } },
      orderBy: { submittedAt: 'desc' },
      take: 8,
      include: {
        assessment: { select: { id: true, title: true, course: { select: { title: true } } } },
      },
    });

    return {
      student: { id: student.id, firstName: student.firstName, lastName: student.lastName },
      courses: courseSummaries,
      recentAttempts: recentAttempts.map((a) => ({
        id: a.id,
        assessmentTitle: a.assessment.title,
        courseTitle: a.assessment.course.title,
        score: a.autoScore ?? a.manualScore ?? 0,
        maxScore: a.maxScore ?? 0,
        submittedAt: a.submittedAt!.toISOString(),
      })),
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

  private parseSchoolDate(value: string): Date {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      throw new AppError(400, 'INVALID_DATE', 'Invalid date');
    }

    return date;
  }

  private getTodaySchoolDate(): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Kigali',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    const value = formatter.format(new Date());
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }

    return new Date().toISOString().slice(0, 10);
  }

  private toSchoolDateString(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
