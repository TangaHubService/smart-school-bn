import {
  AttendanceSession,
  AttendanceStatus,
  Prisma,
} from '@prisma/client';

import { AppError } from '../../common/errors/app-error';
import { JwtUser, RequestAuditContext } from '../../common/types/auth.types';
import { AUDIT_EVENT } from '../../constants/audit-events';
import { prisma } from '../../db/prisma';
import { AuditService } from '../audit/audit.service';
import {
  AttendanceSummaryQueryInput,
  BulkAttendanceRecordsInput,
  ClassAttendanceQueryInput,
  CreateAttendanceSessionInput,
  StudentAttendanceHistoryQueryInput,
} from './attendance.schemas';

interface SessionResolutionInput {
  classRoomId: string;
  date: string;
  academicYearId?: string;
}

export class AttendanceService {
  private readonly auditService = new AuditService();

  async listAttendanceClasses(tenantId: string) {
    return prisma.classRoom.findMany({
      where: {
        tenantId,
        isActive: true,
        gradeLevel: {
          isActive: true,
        },
      },
      select: {
        id: true,
        code: true,
        name: true,
        capacity: true,
        gradeLevel: {
          select: {
            id: true,
            code: true,
            name: true,
            rank: true,
          },
        },
      },
      orderBy: [{ gradeLevel: { rank: 'asc' } }, { code: 'asc' }, { name: 'asc' }],
    });
  }

  async getDashboardSummary(
    tenantId: string,
    query: AttendanceSummaryQueryInput,
  ) {
    const schoolDate = query.date ?? this.getTodaySchoolDate();
    const attendanceDate = this.parseSchoolDate(schoolDate);

    const [
      activeClasses,
      sessionsOpened,
      recordsSaved,
      presentCount,
      absentCount,
      lateCount,
      excusedCount,
    ] = await prisma.$transaction([
      prisma.classRoom.count({
        where: {
          tenantId,
          isActive: true,
          gradeLevel: {
            isActive: true,
          },
        },
      }),
      prisma.attendanceSession.count({
        where: {
          tenantId,
          sessionDate: attendanceDate,
        },
      }),
      prisma.attendanceRecord.count({
        where: {
          tenantId,
          attendanceDate,
        },
      }),
      prisma.attendanceRecord.count({
        where: {
          tenantId,
          attendanceDate,
          status: AttendanceStatus.PRESENT,
        },
      }),
      prisma.attendanceRecord.count({
        where: {
          tenantId,
          attendanceDate,
          status: AttendanceStatus.ABSENT,
        },
      }),
      prisma.attendanceRecord.count({
        where: {
          tenantId,
          attendanceDate,
          status: AttendanceStatus.LATE,
        },
      }),
      prisma.attendanceRecord.count({
        where: {
          tenantId,
          attendanceDate,
          status: AttendanceStatus.EXCUSED,
        },
      }),
    ]);

    return {
      date: schoolDate,
      activeClasses,
      sessionsOpened,
      pendingClasses: Math.max(activeClasses - sessionsOpened, 0),
      coveragePercent: activeClasses
        ? Math.round((sessionsOpened / activeClasses) * 100)
        : 0,
      markedStudents: recordsSaved,
      summary: {
        present: presentCount,
        absent: absentCount,
        late: lateCount,
        excused: excusedCount,
      },
    };
  }

  async createSession(
    tenantId: string,
    input: CreateAttendanceSessionInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const result = await this.resolveOrCreateSession(tenantId, input, actor, context);

    return {
      session: this.mapSession(result.session),
      created: result.created,
    };
  }

  async saveBulkRecords(
    tenantId: string,
    input: BulkAttendanceRecordsInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const session = input.sessionId
      ? await this.findSessionById(tenantId, input.sessionId)
      : (
          await this.resolveOrCreateSession(
            tenantId,
            {
              classRoomId: input.classRoomId!,
              date: input.date!,
              academicYearId: input.academicYearId,
            },
            actor,
            context,
          )
        ).session;

    const dedupedRecords = this.dedupeRecordsByStudent(input.records);
    const studentIds = dedupedRecords.map((record) => record.studentId);

    const students = await prisma.student.findMany({
      where: {
        tenantId,
        id: { in: studentIds },
        deletedAt: null,
        isActive: true,
      },
      select: {
        id: true,
      },
    });

    const validStudentIds = new Set(students.map((student) => student.id));
    const missingStudents = studentIds.filter((studentId) => !validStudentIds.has(studentId));
    if (missingStudents.length) {
      throw new AppError(
        400,
        'ATTENDANCE_STUDENT_NOT_FOUND',
        'Some students do not exist or are inactive',
        { missingStudents },
      );
    }

    const enrollments = await prisma.studentEnrollment.findMany({
      where: {
        tenantId,
        studentId: { in: studentIds },
        classRoomId: session.classRoomId,
        academicYearId: session.academicYearId ?? undefined,
        isActive: true,
      },
      select: {
        studentId: true,
      },
    });

    const enrolledStudentIds = new Set(enrollments.map((item) => item.studentId));
    const notEnrolled = studentIds.filter((studentId) => !enrolledStudentIds.has(studentId));
    if (notEnrolled.length) {
      throw new AppError(
        400,
        'ATTENDANCE_STUDENT_NOT_ENROLLED',
        'Some students are not actively enrolled in this class for the session date',
        { notEnrolled },
      );
    }

    const existingRecords = await prisma.attendanceRecord.findMany({
      where: {
        tenantId,
        classRoomId: session.classRoomId,
        attendanceDate: session.sessionDate,
        studentId: { in: studentIds },
      },
      select: {
        id: true,
        studentId: true,
        status: true,
        remarks: true,
      },
    });

    const existingMap = new Map(existingRecords.map((record) => [record.studentId, record]));

    const editedRecords: Array<{
      studentId: string;
      fromStatus: AttendanceStatus;
      toStatus: AttendanceStatus;
      fromRemarks: string | null;
      toRemarks: string | null;
    }> = [];

    await prisma.$transaction(async (tx) => {
      await tx.attendanceSession.update({
        where: { id: session.id },
        data: {
          editedByUserId: actor.sub,
        },
      });

      for (const record of dedupedRecords) {
        const current = existingMap.get(record.studentId);
        const nextRemarks = record.remarks?.trim() || null;

        if (
          current &&
          (current.status !== record.status || (current.remarks ?? null) !== nextRemarks)
        ) {
          editedRecords.push({
            studentId: record.studentId,
            fromStatus: current.status,
            toStatus: record.status,
            fromRemarks: current.remarks ?? null,
            toRemarks: nextRemarks,
          });
        }

        await tx.attendanceRecord.upsert({
          where: {
            tenantId_classRoomId_attendanceDate_studentId: {
              tenantId,
              classRoomId: session.classRoomId,
              attendanceDate: session.sessionDate,
              studentId: record.studentId,
            },
          },
          update: {
            sessionId: session.id,
            status: record.status,
            remarks: nextRemarks,
            editedByUserId: actor.sub,
          },
          create: {
            tenantId,
            sessionId: session.id,
            classRoomId: session.classRoomId,
            studentId: record.studentId,
            attendanceDate: session.sessionDate,
            status: record.status,
            remarks: nextRemarks,
            markedByUserId: actor.sub,
            editedByUserId: actor.sub,
          },
        });
      }
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.ATTENDANCE_RECORDS_SAVED,
      entity: 'AttendanceSession',
      entityId: session.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        classRoomId: session.classRoomId,
        date: this.toSchoolDateString(session.sessionDate),
        savedCount: dedupedRecords.length,
      },
    });

    if (editedRecords.length) {
      await this.auditService.log({
        tenantId,
        actorUserId: actor.sub,
        event: AUDIT_EVENT.ATTENDANCE_RECORDS_EDITED,
        entity: 'AttendanceSession',
        entityId: session.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        payload: {
          editedCount: editedRecords.length,
          editedRecords: editedRecords.slice(0, 100),
        },
      });
    }

    return {
      session: this.mapSession(session),
      savedCount: dedupedRecords.length,
      editedCount: editedRecords.length,
    };
  }

  async getClassAttendance(
    tenantId: string,
    classRoomId: string,
    query: ClassAttendanceQueryInput,
  ) {
    const schoolDate = query.date ?? this.getTodaySchoolDate();
    const attendanceDate = this.parseSchoolDate(schoolDate);

    const classRoom = await prisma.classRoom.findFirst({
      where: {
        id: classRoomId,
        tenantId,
        isActive: true,
      },
      select: {
        id: true,
        code: true,
        name: true,
        gradeLevel: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
    });

    if (!classRoom) {
      throw new AppError(404, 'CLASS_ROOM_NOT_FOUND', 'Class room not found');
    }

    const session = await prisma.attendanceSession.findUnique({
      where: {
        tenantId_classRoomId_sessionDate: {
          tenantId,
          classRoomId,
          sessionDate: attendanceDate,
        },
      },
      include: {
        academicYear: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    const academicYearId =
      session?.academicYearId ??
      (
        await prisma.academicYear.findFirst({
          where: {
            tenantId,
            isActive: true,
            startDate: { lte: attendanceDate },
            endDate: { gte: attendanceDate },
          },
          select: {
            id: true,
          },
        })
      )?.id ??
      null;

    const enrollments = await prisma.studentEnrollment.findMany({
      where: {
        tenantId,
        classRoomId,
        academicYearId: academicYearId ?? undefined,
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
          },
        },
      },
      orderBy: [{ student: { firstName: 'asc' } }, { student: { lastName: 'asc' } }],
    });

    const studentIds = enrollments.map((item) => item.student.id);

    const records = studentIds.length
      ? await prisma.attendanceRecord.findMany({
          where: {
            tenantId,
            classRoomId,
            attendanceDate,
            studentId: { in: studentIds },
          },
          select: {
            id: true,
            studentId: true,
            status: true,
            remarks: true,
            markedAt: true,
            updatedAt: true,
          },
        })
      : [];

    const recordByStudentId = new Map(records.map((record) => [record.studentId, record]));

    const students = enrollments.map((item) => {
      const record = recordByStudentId.get(item.student.id);
      return {
        studentId: item.student.id,
        studentCode: item.student.studentCode,
        firstName: item.student.firstName,
        lastName: item.student.lastName,
        status: record?.status ?? AttendanceStatus.PRESENT,
        remarks: record?.remarks ?? null,
        recordId: record?.id ?? null,
        markedAt: record?.markedAt ?? null,
        updatedAt: record?.updatedAt ?? null,
      };
    });

    const summary = {
      total: students.length,
      present: students.filter((item) => item.status === AttendanceStatus.PRESENT).length,
      absent: students.filter((item) => item.status === AttendanceStatus.ABSENT).length,
      late: students.filter((item) => item.status === AttendanceStatus.LATE).length,
      excused: students.filter((item) => item.status === AttendanceStatus.EXCUSED).length,
    };

    return {
      date: schoolDate,
      classRoom,
      session: session ? this.mapSession(session) : null,
      students,
      summary,
    };
  }

  async getStudentAttendanceHistory(
    tenantId: string,
    studentId: string,
    query: StudentAttendanceHistoryQueryInput,
  ) {
    const student = await prisma.student.findFirst({
      where: {
        id: studentId,
        tenantId,
        deletedAt: null,
      },
      select: {
        id: true,
        studentCode: true,
        firstName: true,
        lastName: true,
      },
    });

    if (!student) {
      throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student not found');
    }

    const toDate = query.to ? this.parseSchoolDate(query.to) : this.parseSchoolDate(this.getTodaySchoolDate());
    const fromDate = query.from
      ? this.parseSchoolDate(query.from)
      : new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate() - 30));

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

    const summary = {
      total: records.length,
      present: records.filter((item) => item.status === AttendanceStatus.PRESENT).length,
      absent: records.filter((item) => item.status === AttendanceStatus.ABSENT).length,
      late: records.filter((item) => item.status === AttendanceStatus.LATE).length,
      excused: records.filter((item) => item.status === AttendanceStatus.EXCUSED).length,
    };

    return {
      student,
      range: {
        from: this.toSchoolDateString(fromDate),
        to: this.toSchoolDateString(toDate),
      },
      summary,
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

  private async findSessionById(tenantId: string, sessionId: string): Promise<AttendanceSession> {
    const session = await prisma.attendanceSession.findFirst({
      where: {
        id: sessionId,
        tenantId,
      },
    });

    if (!session) {
      throw new AppError(404, 'ATTENDANCE_SESSION_NOT_FOUND', 'Attendance session not found');
    }

    return session;
  }

  private async resolveOrCreateSession(
    tenantId: string,
    input: SessionResolutionInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const sessionDate = this.parseSchoolDate(input.date);

    const classRoom = await prisma.classRoom.findFirst({
      where: {
        id: input.classRoomId,
        tenantId,
        isActive: true,
      },
      select: {
        id: true,
      },
    });

    if (!classRoom) {
      throw new AppError(404, 'CLASS_ROOM_NOT_FOUND', 'Class room not found');
    }

    const academicYear = await this.resolveAcademicYear(
      tenantId,
      sessionDate,
      input.academicYearId,
    );

    const existing = await prisma.attendanceSession.findUnique({
      where: {
        tenantId_classRoomId_sessionDate: {
          tenantId,
          classRoomId: input.classRoomId,
          sessionDate,
        },
      },
      include: {
        academicYear: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (existing) {
      return {
        session: existing,
        created: false,
      };
    }

    try {
      const created = await prisma.attendanceSession.create({
        data: {
          tenantId,
          classRoomId: input.classRoomId,
          academicYearId: academicYear?.id,
          sessionDate,
          createdByUserId: actor.sub,
          editedByUserId: actor.sub,
          status: 'OPEN',
        },
        include: {
          academicYear: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      await this.auditService.log({
        tenantId,
        actorUserId: actor.sub,
        event: AUDIT_EVENT.ATTENDANCE_SESSION_CREATED,
        entity: 'AttendanceSession',
        entityId: created.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        payload: {
          classRoomId: created.classRoomId,
          date: this.toSchoolDateString(created.sessionDate),
        },
      });

      return {
        session: created,
        created: true,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const session = await prisma.attendanceSession.findUnique({
          where: {
            tenantId_classRoomId_sessionDate: {
              tenantId,
              classRoomId: input.classRoomId,
              sessionDate,
            },
          },
          include: {
            academicYear: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });

        if (!session) {
          throw new AppError(
            500,
            'ATTENDANCE_SESSION_CREATE_FAILED',
            'Unable to resolve attendance session after duplicate key conflict',
          );
        }

        return {
          session,
          created: false,
        };
      }

      throw error;
    }
  }

  private async resolveAcademicYear(
    tenantId: string,
    sessionDate: Date,
    academicYearId?: string,
  ) {
    if (academicYearId) {
      const year = await prisma.academicYear.findFirst({
        where: {
          id: academicYearId,
          tenantId,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          startDate: true,
          endDate: true,
        },
      });

      if (!year) {
        throw new AppError(404, 'ACADEMIC_YEAR_NOT_FOUND', 'Academic year not found');
      }

      if (sessionDate < year.startDate || sessionDate > year.endDate) {
        throw new AppError(
          400,
          'ATTENDANCE_DATE_OUTSIDE_ACADEMIC_YEAR',
          'Attendance date is outside selected academic year range',
        );
      }

      return year;
    }

    return prisma.academicYear.findFirst({
      where: {
        tenantId,
        isActive: true,
        startDate: { lte: sessionDate },
        endDate: { gte: sessionDate },
      },
      select: {
        id: true,
        name: true,
        startDate: true,
        endDate: true,
      },
    });
  }

  private parseSchoolDate(value: string): Date {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      throw new AppError(400, 'ATTENDANCE_INVALID_DATE', 'Invalid attendance date');
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

  private dedupeRecordsByStudent(
    records: BulkAttendanceRecordsInput['records'],
  ): BulkAttendanceRecordsInput['records'] {
    const map = new Map<string, BulkAttendanceRecordsInput['records'][number]>();

    for (const record of records) {
      map.set(record.studentId, record);
    }

    return [...map.values()];
  }

  private mapSession(
    session:
      | (AttendanceSession & { academicYear?: { id: string; name: string } | null })
      | (AttendanceSession & { academicYear: { id: string; name: string } | null }),
  ) {
    return {
      id: session.id,
      classRoomId: session.classRoomId,
      academicYear: session.academicYear ?? null,
      date: this.toSchoolDateString(session.sessionDate),
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }
}
