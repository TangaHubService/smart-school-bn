import {
  ConductIncidentStatus,
  ConductSeverity,
  Prisma,
} from '@prisma/client';

import { AppError } from '../../common/errors/app-error';
import { JwtUser } from '../../common/types/auth.types';
import { PERMISSIONS } from '../../constants/permissions';
import { prisma } from '../../db/prisma';
import { TimetableService } from '../timetable/timetable.service';
import { listTimetableSlotsQuerySchema } from '../timetable/timetable.schemas';
import type {
  ConductSchoolReportQueryInput,
  ConductStudentReportQueryInput,
  TeacherActivityQueryInput,
  TeacherReportsBaseQueryInput,
  TimetableReportQueryInput,
} from './reports.schemas';

function parseTimeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function slotDurationMinutes(startTime: string, endTime: string): number {
  return Math.max(0, parseTimeToMinutes(endTime) - parseTimeToMinutes(startTime));
}

function rangeToUtcBounds(from: string, to: string) {
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T23:59:59.999Z`);
  return { fromDate, toDate };
}

export class ReportsOpsService {
  private readonly timetableService = new TimetableService();

  private isTeacherOnly(actor: JwtUser) {
    return (
      actor.roles.includes('TEACHER') &&
      !actor.roles.includes('SUPER_ADMIN') &&
      !actor.roles.includes('SCHOOL_ADMIN')
    );
  }

  private async getTeacherClassRoomIds(tenantId: string, teacherUserId: string) {
    const rows = await prisma.course.findMany({
      where: { tenantId, teacherUserId, isActive: true },
      select: { classRoomId: true },
      distinct: ['classRoomId'],
    });
    return rows.map((r) => r.classRoomId);
  }

  /** Teacher workload + allocation from courses and timetable slots. */
  async teachersWorkload(tenantId: string, query: TeacherReportsBaseQueryInput, actor: JwtUser) {
    const year = await prisma.academicYear.findFirst({
      where: { id: query.academicYearId, tenantId, isActive: true },
      select: { id: true, name: true },
    });
    if (!year) {
      throw new AppError(404, 'ACADEMIC_YEAR_NOT_FOUND', 'Academic year not found');
    }

    let term: { id: string; name: string } | null = null;
    if (query.termId) {
      const t = await prisma.term.findFirst({
        where: { id: query.termId, tenantId, academicYearId: query.academicYearId, isActive: true },
        select: { id: true, name: true },
      });
      if (!t) {
        throw new AppError(404, 'TERM_NOT_FOUND', 'Term not found');
      }
      term = t;
    }

    const courseWhere: Prisma.CourseWhereInput = {
      tenantId,
      academicYearId: query.academicYearId,
      isActive: true,
      ...(this.isTeacherOnly(actor) ? { teacherUserId: actor.sub } : {}),
    };

    const courses = await prisma.course.findMany({
      where: courseWhere,
      include: {
        teacherUser: { select: { id: true, firstName: true, lastName: true, email: true } },
        classRoom: { select: { id: true, code: true, name: true } },
        subject: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ teacherUser: { lastName: 'asc' } }, { title: 'asc' }],
    });

    const slotWhere: Prisma.TimetableSlotWhereInput = {
      tenantId,
      academicYearId: query.academicYearId,
      ...(query.termId ? { termId: query.termId } : {}),
      ...(this.isTeacherOnly(actor)
        ? { course: { teacherUserId: actor.sub } }
        : {}),
    };

    const slots = await prisma.timetableSlot.findMany({
      where: slotWhere,
      select: {
        id: true,
        dayOfWeek: true,
        periodNumber: true,
        startTime: true,
        endTime: true,
        course: {
          select: {
            teacherUserId: true,
          },
        },
      },
    });

    const minutesByTeacher = new Map<string, number>();
    const slotCountByTeacher = new Map<string, number>();
    for (const s of slots) {
      const tid = s.course.teacherUserId;
      const mins = slotDurationMinutes(s.startTime, s.endTime);
      minutesByTeacher.set(tid, (minutesByTeacher.get(tid) ?? 0) + mins);
      slotCountByTeacher.set(tid, (slotCountByTeacher.get(tid) ?? 0) + 1);
    }

    const byTeacher = new Map<
      string,
      {
        teacher: { id: string; firstName: string; lastName: string; email: string };
        courseRows: typeof courses;
      }
    >();

    for (const c of courses) {
      const tid = c.teacherUserId;
      if (!byTeacher.has(tid)) {
        byTeacher.set(tid, {
          teacher: {
            id: c.teacherUser.id,
            firstName: c.teacherUser.firstName,
            lastName: c.teacherUser.lastName,
            email: c.teacherUser.email,
          },
          courseRows: [],
        });
      }
      byTeacher.get(tid)!.courseRows.push(c);
    }

    const teachers = Array.from(byTeacher.values()).map((entry) => {
      const classIds = new Set(entry.courseRows.map((r) => r.classRoomId));
      const subjectIds = new Set(
        entry.courseRows.map((r) => r.subjectId).filter((id): id is string => Boolean(id)),
      );
      const tid = entry.teacher.id;
      return {
        teacher: {
          id: entry.teacher.id,
          firstName: entry.teacher.firstName,
          lastName: entry.teacher.lastName,
          email: entry.teacher.email,
        },
        coursesCount: entry.courseRows.length,
        distinctClasses: classIds.size,
        distinctSubjects: subjectIds.size,
        timetableSlotsCount: slotCountByTeacher.get(tid) ?? 0,
        weeklyTeachingMinutes: minutesByTeacher.get(tid) ?? 0,
        weeklyTeachingHours: Number(((minutesByTeacher.get(tid) ?? 0) / 60).toFixed(2)),
        note:
          'Weekly minutes sum durations of all timetable slots for this teacher in the selected year/term. One row per class period.',
      };
    });

    teachers.sort((a, b) => a.teacher.lastName.localeCompare(b.teacher.lastName));

    return {
      academicYear: year,
      term,
      timetableScopeNote: query.termId
        ? 'Timetable figures are limited to the selected term.'
        : 'Timetable figures include all terms in this academic year for the selected filters.',
      teachers,
    };
  }

  /** Flat teacher → class → subject mapping from active courses. */
  async teachersAllocation(tenantId: string, query: TeacherReportsBaseQueryInput, actor: JwtUser) {
    const year = await prisma.academicYear.findFirst({
      where: { id: query.academicYearId, tenantId, isActive: true },
      select: { id: true, name: true },
    });
    if (!year) {
      throw new AppError(404, 'ACADEMIC_YEAR_NOT_FOUND', 'Academic year not found');
    }

    const courses = await prisma.course.findMany({
      where: {
        tenantId,
        academicYearId: query.academicYearId,
        isActive: true,
        ...(this.isTeacherOnly(actor) ? { teacherUserId: actor.sub } : {}),
      },
      include: {
        teacherUser: { select: { id: true, firstName: true, lastName: true } },
        classRoom: { select: { id: true, code: true, name: true } },
        subject: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ teacherUser: { lastName: 'asc' } }, { classRoom: { code: 'asc' } }, { title: 'asc' }],
    });

    return {
      academicYear: year,
      rows: courses.map((c) => ({
        courseId: c.id,
        courseTitle: c.title,
        teacher: {
          id: c.teacherUser.id,
          firstName: c.teacherUser.firstName,
          lastName: c.teacherUser.lastName,
        },
        classRoom: c.classRoom,
        subject: c.subject
          ? { id: c.subject.id, code: c.subject.code, name: c.subject.name }
          : null,
      })),
    };
  }

  /**
   * Operational counts only: attendance records saved and exam marks updated in range,
   * attributed to the staff user who last touched the record.
   */
  async teachersActivity(tenantId: string, query: TeacherActivityQueryInput, actor: JwtUser) {
    const { fromDate, toDate } = rangeToUtcBounds(query.from, query.to);
    if (fromDate > toDate) {
      throw new AppError(400, 'REPORTS_RANGE_INVALID', 'from must be on or before to');
    }

    const teacherIds = await prisma.course.findMany({
      where: { tenantId, isActive: true },
      select: { teacherUserId: true },
      distinct: ['teacherUserId'],
    });
    const allowedIds = new Set(teacherIds.map((t) => t.teacherUserId));

    if (this.isTeacherOnly(actor)) {
      allowedIds.clear();
      allowedIds.add(actor.sub);
    }

    const isSuper = actor.roles.includes('SUPER_ADMIN');
    const canAttendance =
      isSuper || actor.permissions.includes(PERMISSIONS.ATTENDANCE_READ);
    const canExams = isSuper || actor.permissions.includes(PERMISSIONS.EXAMS_READ);

    const attGroups = canAttendance
      ? await prisma.attendanceRecord.groupBy({
          by: ['markedByUserId'],
          where: {
            tenantId,
            attendanceDate: { gte: fromDate, lte: toDate },
            markedByUserId: { in: Array.from(allowedIds) },
          },
          _count: { _all: true },
        })
      : [];

    const markGroups = canExams
      ? await prisma.examMark.groupBy({
          by: ['updatedByUserId'],
          where: {
            tenantId,
            updatedAt: { gte: fromDate, lte: toDate },
            updatedByUserId: { in: Array.from(allowedIds) },
          },
          _count: { _all: true },
        })
      : [];

    const users = await prisma.user.findMany({
      where: { tenantId, id: { in: Array.from(allowedIds) } },
      select: { id: true, firstName: true, lastName: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const attMap = new Map(attGroups.map((g) => [g.markedByUserId, g._count._all]));
    const markMap = new Map(markGroups.map((g) => [g.updatedByUserId, g._count._all]));

    const rows = Array.from(allowedIds).map((id) => {
      const u = userMap.get(id);
      return {
        userId: id,
        firstName: u?.firstName ?? '',
        lastName: u?.lastName ?? '',
        attendanceRecordsSaved: attMap.get(id) ?? 0,
        examMarksUpdated: markMap.get(id) ?? 0,
      };
    });

    rows.sort((a, b) => a.lastName.localeCompare(b.lastName));

    return {
      range: { from: query.from, to: query.to },
      metricsNote:
        'attendanceRecordsSaved counts rows marked by each user (requires attendance.read). examMarksUpdated counts mark rows updated in the period (requires exams.read).',
      teachers: rows,
    };
  }

  /** Delegates to TimetableService.listSlots (school-scoped, conflict-free stored data). */
  async timetableReport(tenantId: string, query: TimetableReportQueryInput, actor: JwtUser) {
    const inner = listTimetableSlotsQuerySchema.parse({
      academicYearId: query.academicYearId,
      termId: query.termId,
      classRoomId: query.classRoomId,
      teacherUserId: query.teacherUserId,
    });
    const { slots } = await this.timetableService.listSlots(tenantId, inner, actor);
    const filtered = query.dayOfWeek
      ? slots.filter((s) => s.dayOfWeek === query.dayOfWeek)
      : slots;

    return {
      source: 'timetable_slots',
      note: 'Data reflects saved timetable slots (validated on write).',
      slotCount: filtered.length,
      slots: filtered,
    };
  }

  async conductSchoolSummary(tenantId: string, query: ConductSchoolReportQueryInput, actor: JwtUser) {
    const { fromDate, toDate } = rangeToUtcBounds(query.from, query.to);
    if (fromDate > toDate) {
      throw new AppError(400, 'REPORTS_RANGE_INVALID', 'from must be on or before to');
    }

    const where: Prisma.ConductIncidentWhereInput = {
      tenantId,
      occurredAt: { gte: fromDate, lte: toDate },
    };
    if (query.status) {
      where.status = query.status as ConductIncidentStatus;
    }
    if (query.severity) {
      where.severity = query.severity as ConductSeverity;
    }

    if (this.isTeacherOnly(actor) && actor.sub) {
      const ids = await this.getTeacherClassRoomIds(tenantId, actor.sub);
      if (query.classRoomId && !ids.includes(query.classRoomId)) {
        throw new AppError(403, 'REPORTS_FORBIDDEN', 'You do not have access to this class');
      }
      where.classRoomId = query.classRoomId ?? { in: ids.length ? ids : ['__none__'] };
    } else if (query.classRoomId) {
      where.classRoomId = query.classRoomId;
    }

    const total = await prisma.conductIncident.count({ where });

    const [byStatus, bySeverity] = await Promise.all([
      prisma.conductIncident.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      prisma.conductIncident.groupBy({
        by: ['severity'],
        where,
        _count: { _all: true },
      }),
    ]);

    const topCategories = await prisma.conductIncident.groupBy({
      by: ['category'],
      where,
      _count: { _all: true },
      orderBy: { _count: { category: 'desc' } },
      take: 15,
    });

    return {
      range: { from: query.from, to: query.to },
      totalIncidents: total,
      byStatus: byStatus.map((r) => ({ status: r.status, count: r._count._all })),
      bySeverity: bySeverity.map((r) => ({ severity: r.severity, count: r._count._all })),
      topCategories: topCategories.map((r) => ({ category: r.category, count: r._count._all })),
    };
  }

  async conductByClass(tenantId: string, query: ConductSchoolReportQueryInput, actor: JwtUser) {
    const { fromDate, toDate } = rangeToUtcBounds(query.from, query.to);
    if (fromDate > toDate) {
      throw new AppError(400, 'REPORTS_RANGE_INVALID', 'from must be on or before to');
    }

    const where: Prisma.ConductIncidentWhereInput = {
      tenantId,
      occurredAt: { gte: fromDate, lte: toDate },
      classRoomId: { not: null },
    };
    if (query.status) {
      where.status = query.status as ConductIncidentStatus;
    }
    if (query.severity) {
      where.severity = query.severity as ConductSeverity;
    }

    if (this.isTeacherOnly(actor) && actor.sub) {
      const ids = await this.getTeacherClassRoomIds(tenantId, actor.sub);
      if (query.classRoomId && !ids.includes(query.classRoomId)) {
        throw new AppError(403, 'REPORTS_FORBIDDEN', 'You do not have access to this class');
      }
      where.classRoomId = query.classRoomId
        ? query.classRoomId
        : { in: ids.length ? ids : ['__none__'] };
    } else if (query.classRoomId) {
      where.classRoomId = query.classRoomId;
    }

    const groups = await prisma.conductIncident.groupBy({
      by: ['classRoomId'],
      where,
      _count: { _all: true },
    });

    const classIds = groups.map((g) => g.classRoomId).filter((id): id is string => id != null);
    const rooms = await prisma.classRoom.findMany({
      where: { tenantId, id: { in: classIds } },
      select: { id: true, code: true, name: true },
    });
    const roomMap = new Map(rooms.map((r) => [r.id, r]));

    const rows = groups
      .map((g) => {
        const cr = g.classRoomId ? roomMap.get(g.classRoomId) : null;
        return {
          classRoom: cr ?? { id: g.classRoomId, code: '', name: '' },
          incidentCount: g._count._all,
        };
      })
      .sort((a, b) => b.incidentCount - a.incidentCount);

    return {
      range: { from: query.from, to: query.to },
      classes: rows,
    };
  }

  async conductStudentHistory(
    tenantId: string,
    studentId: string,
    query: ConductStudentReportQueryInput,
    actor: JwtUser,
  ) {
    const student = await prisma.student.findFirst({
      where: { id: studentId, tenantId, deletedAt: null },
      select: { id: true, studentCode: true, firstName: true, lastName: true },
    });
    if (!student) {
      throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student not found');
    }

    const { fromDate, toDate } = rangeToUtcBounds(query.from, query.to);
    if (fromDate > toDate) {
      throw new AppError(400, 'REPORTS_RANGE_INVALID', 'from must be on or before to');
    }

    const where: Prisma.ConductIncidentWhereInput = {
      tenantId,
      studentId,
      occurredAt: { gte: fromDate, lte: toDate },
    };

    if (this.isTeacherOnly(actor) && actor.sub) {
      const ids = await this.getTeacherClassRoomIds(tenantId, actor.sub);
      where.classRoomId = { in: ids.length ? ids : ['__none__'] };
    }

    const incidents = await prisma.conductIncident.findMany({
      where,
      select: {
        id: true,
        occurredAt: true,
        category: true,
        title: true,
        severity: true,
        status: true,
        classRoom: { select: { id: true, code: true, name: true } },
        reportedByUser: { select: { id: true, firstName: true, lastName: true } },
        actions: {
          select: {
            id: true,
            type: true,
            title: true,
            actionDate: true,
            completedAt: true,
          },
        },
      },
      orderBy: [{ occurredAt: 'desc' }],
      take: 200,
    });

    return {
      student,
      range: { from: query.from, to: query.to },
      incidentCount: incidents.length,
      incidents,
    };
  }
}
