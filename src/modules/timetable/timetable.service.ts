import { AppError } from '../../common/errors/app-error';
import { JwtUser } from '../../common/types/auth.types';
import { prisma } from '../../db/prisma';
import {
  BulkUpsertTimetableSlotsInput,
  CreateTimetableSlotInput,
  ListTimetableSlotsQueryInput,
  UpdateTimetableSlotInput,
} from './timetable.schemas';

const slotInclude = {
  academicYear: { select: { id: true, name: true } },
  term: { select: { id: true, name: true, sequence: true } },
  classRoom: {
    select: {
      id: true,
      code: true,
      name: true,
      gradeLevel: { select: { id: true, code: true, name: true } },
    },
  },
  course: {
    select: {
      id: true,
      title: true,
      subject: { select: { id: true, code: true, name: true } },
      teacherUser: {
        select: { id: true, firstName: true, lastName: true },
      },
    },
  },
};

type ExistingSlot = {
  id: string;
  tenantId: string;
  academicYearId: string;
  termId: string;
  classRoomId: string;
  dayOfWeek: number;
  periodNumber: number;
  startTime: string;
  endTime: string;
  course: {
    id: string;
    title: string;
    teacherUserId: string;
    classRoomId: string;
  };
  classRoom: { name: string; code: string };
};

type CandidateSlot = {
  id?: string;
  academicYearId: string;
  termId: string;
  classRoomId: string;
  courseId: string;
  teacherUserId: string;
  dayOfWeek: number;
  periodNumber: number;
  startTime: string;
  endTime: string;
};

export class TimetableService {
  async listSlots(
    tenantId: string,
    query: ListTimetableSlotsQueryInput,
    actor?: JwtUser,
  ) {
    this.ensureReadScope(actor, query.teacherUserId);
    const teacherOnly =
      actor?.roles?.includes('TEACHER') &&
      !actor?.roles?.includes('SCHOOL_ADMIN') &&
      !actor?.roles?.includes('SUPER_ADMIN');

    const where: any = {
      tenantId,
      academicYearId: query.academicYearId,
    };

    if (query.termId) {
      where.termId = query.termId;
    }

    if (query.classRoomId) {
      where.classRoomId = query.classRoomId;
    }

    if (teacherOnly && actor?.sub) {
      where.course = { teacherUserId: actor.sub };
    } else if (query.teacherUserId) {
      where.course = { teacherUserId: query.teacherUserId };
    }

    const slots = await prisma.timetableSlot.findMany({
      where,
      include: slotInclude,
      orderBy: [{ dayOfWeek: 'asc' }, { periodNumber: 'asc' }],
    });

    return { slots };
  }

  async createSlot(
    tenantId: string,
    input: CreateTimetableSlotInput,
    actor: JwtUser,
  ) {
    this.ensureActorCanManageTimetable(actor);
    await this.ensureSlotTargets(tenantId, input);
    this.ensureValidTimeRange(input.startTime, input.endTime);
    const courseMap = await this.getCourseTeacherMap(tenantId, [input.courseId]);
    const teacherUserId = courseMap.get(input.courseId);
    if (!teacherUserId) {
      throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found');
    }
    const existing = await this.getExistingSlots(tenantId, input.academicYearId, input.termId);
    this.validateScheduleChanges(existing, [
      {
        academicYearId: input.academicYearId,
        termId: input.termId,
        classRoomId: input.classRoomId,
        courseId: input.courseId,
        teacherUserId,
        dayOfWeek: input.dayOfWeek,
        periodNumber: input.periodNumber,
        startTime: input.startTime,
        endTime: input.endTime,
      },
    ]);

    const slot = await prisma.timetableSlot.create({
      data: {
        tenantId,
        academicYearId: input.academicYearId,
        termId: input.termId,
        classRoomId: input.classRoomId,
        courseId: input.courseId,
        dayOfWeek: input.dayOfWeek,
        periodNumber: input.periodNumber,
        startTime: input.startTime,
        endTime: input.endTime,
      },
      include: slotInclude,
    });

    return slot;
  }

  async updateSlot(
    tenantId: string,
    slotId: string,
    input: UpdateTimetableSlotInput,
    actor: JwtUser,
  ) {
    const existing = await prisma.timetableSlot.findFirst({
      where: { id: slotId, tenantId },
      include: { course: true },
    });

    if (!existing) {
      throw new AppError(404, 'TIMETABLE_SLOT_NOT_FOUND', 'Timetable slot not found');
    }

    this.ensureActorCanManageTimetable(actor);

    if (input.academicYearId || input.termId || input.classRoomId || input.courseId) {
      await this.ensureSlotTargets(tenantId, {
        academicYearId: input.academicYearId ?? existing.academicYearId,
        termId: input.termId ?? existing.termId,
        classRoomId: input.classRoomId ?? existing.classRoomId,
        courseId: input.courseId ?? existing.courseId,
      });
    }

    const nextStart = input.startTime ?? existing.startTime;
    const nextEnd = input.endTime ?? existing.endTime;
    this.ensureValidTimeRange(nextStart, nextEnd);

    const nextAcademicYearId = input.academicYearId ?? existing.academicYearId;
    const nextTermId = input.termId ?? existing.termId;
    const nextClassRoomId = input.classRoomId ?? existing.classRoomId;
    const nextCourseId = input.courseId ?? existing.courseId;

    const courseMap = await this.getCourseTeacherMap(tenantId, [nextCourseId]);
    const teacherUserId = courseMap.get(nextCourseId);
    if (!teacherUserId) {
      throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found');
    }
    const existingSlots = await this.getExistingSlots(tenantId, nextAcademicYearId, nextTermId);
    this.validateScheduleChanges(
      existingSlots.filter((slot) => slot.id !== slotId),
      [
        {
          id: slotId,
          academicYearId: nextAcademicYearId,
          termId: nextTermId,
          classRoomId: nextClassRoomId,
          courseId: nextCourseId,
          teacherUserId,
          dayOfWeek: input.dayOfWeek ?? existing.dayOfWeek,
          periodNumber: input.periodNumber ?? existing.periodNumber,
          startTime: nextStart,
          endTime: nextEnd,
        },
      ],
    );

    const updated = await prisma.timetableSlot.update({
      where: { id: slotId },
      data: {
        ...(input.academicYearId && { academicYearId: input.academicYearId }),
        ...(input.termId && { termId: input.termId }),
        ...(input.classRoomId && { classRoomId: input.classRoomId }),
        ...(input.courseId && { courseId: input.courseId }),
        ...(input.dayOfWeek != null && { dayOfWeek: input.dayOfWeek }),
        ...(input.periodNumber != null && { periodNumber: input.periodNumber }),
        ...(input.startTime && { startTime: input.startTime }),
        ...(input.endTime && { endTime: input.endTime }),
      },
      include: slotInclude,
    });

    return updated;
  }

  async deleteSlot(tenantId: string, slotId: string, actor: JwtUser) {
    const existing = await prisma.timetableSlot.findFirst({
      where: { id: slotId, tenantId },
      include: { course: true },
    });

    if (!existing) {
      throw new AppError(404, 'TIMETABLE_SLOT_NOT_FOUND', 'Timetable slot not found');
    }

    this.ensureActorCanManageTimetable(actor);

    await prisma.timetableSlot.delete({
      where: { id: slotId },
    });

    return { deleted: true };
  }

  async bulkUpsertSlots(
    tenantId: string,
    input: BulkUpsertTimetableSlotsInput,
    actor: JwtUser,
  ) {
    this.ensureActorCanManageTimetable(actor);
    const uniqueCourseIds = [...new Set(input.slots.map((s) => s.courseId))];
    for (const courseId of uniqueCourseIds) {
      await this.ensureSlotTargets(tenantId, {
        academicYearId: input.academicYearId,
        termId: input.termId,
        classRoomId: input.classRoomId,
        courseId,
      });
    }
    for (const s of input.slots) {
      this.ensureValidTimeRange(s.startTime, s.endTime);
    }

    const courseMap = await this.getCourseTeacherMap(tenantId, uniqueCourseIds);
    const candidates: CandidateSlot[] = input.slots.map((s) => {
      const teacherUserId = courseMap.get(s.courseId);
      if (!teacherUserId) {
        throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found');
      }
      return {
        academicYearId: input.academicYearId,
        termId: input.termId,
        classRoomId: input.classRoomId,
        courseId: s.courseId,
        teacherUserId,
        dayOfWeek: s.dayOfWeek,
        periodNumber: s.periodNumber,
        startTime: s.startTime,
        endTime: s.endTime,
      };
    });

    const existing = await this.getExistingSlots(tenantId, input.academicYearId, input.termId);
    const unaffected = existing.filter((slot) => slot.classRoomId !== input.classRoomId);
    this.validateScheduleChanges(unaffected, candidates);

    const created = await prisma.$transaction(async (tx) => {
      await tx.timetableSlot.deleteMany({
        where: {
          tenantId,
          academicYearId: input.academicYearId,
          termId: input.termId,
          classRoomId: input.classRoomId,
        },
      });

      return tx.timetableSlot.createMany({
        data: candidates.map((s) => ({
          tenantId,
          academicYearId: s.academicYearId,
          termId: s.termId,
          classRoomId: s.classRoomId,
          courseId: s.courseId,
          dayOfWeek: s.dayOfWeek,
          periodNumber: s.periodNumber,
          startTime: s.startTime,
          endTime: s.endTime,
        })),
      });
    });

    const slots = await this.listSlots(
      tenantId,
      {
        academicYearId: input.academicYearId,
        termId: input.termId,
        classRoomId: input.classRoomId,
      },
      actor,
    );

    return { created: created.count, slots: slots.slots };
  }

  private async ensureSlotTargets(
    tenantId: string,
    input: {
      academicYearId: string;
      termId: string;
      classRoomId: string;
      courseId: string;
    },
  ) {
    const [academicYear, term, classRoom, course] = await Promise.all([
      prisma.academicYear.findFirst({
        where: { id: input.academicYearId, tenantId, isActive: true },
      }),
      prisma.term.findFirst({
        where: { id: input.termId, tenantId, academicYearId: input.academicYearId },
      }),
      prisma.classRoom.findFirst({
        where: { id: input.classRoomId, tenantId, isActive: true },
      }),
      prisma.course.findFirst({
        where: {
          id: input.courseId,
          tenantId,
          academicYearId: input.academicYearId,
          classRoomId: input.classRoomId,
          isActive: true,
        },
      }),
    ]);

    if (!academicYear) {
      throw new AppError(404, 'ACADEMIC_YEAR_NOT_FOUND', 'Academic year not found');
    }
    if (!term) {
      throw new AppError(404, 'TERM_NOT_FOUND', 'Term not found');
    }
    if (!classRoom) {
      throw new AppError(404, 'CLASS_ROOM_NOT_FOUND', 'Class room not found');
    }
    if (!course) {
      throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found or not in this class');
    }
  }

  private ensureActorCanManageTimetable(actor: JwtUser) {
    const isAdmin =
      actor.roles?.includes('SCHOOL_ADMIN') || actor.roles?.includes('SUPER_ADMIN');
    if (!isAdmin) {
      throw new AppError(
        403,
        'TIMETABLE_FORBIDDEN',
        'Only school administrators can manage timetable entries',
      );
    }
  }

  private ensureReadScope(actor: JwtUser | undefined, teacherUserId?: string) {
    if (!actor) {
      return;
    }
    const isTeacherOnly =
      actor.roles?.includes('TEACHER') &&
      !actor.roles?.includes('SCHOOL_ADMIN') &&
      !actor.roles?.includes('SUPER_ADMIN');
    if (isTeacherOnly && teacherUserId && teacherUserId !== actor.sub) {
      throw new AppError(
        403,
        'TIMETABLE_FORBIDDEN',
        'Teachers can only view their own timetable',
      );
    }
  }

  private ensureValidTimeRange(startTime: string, endTime: string) {
    const start = this.timeToMinutes(startTime);
    const end = this.timeToMinutes(endTime);
    if (end <= start) {
      throw new AppError(
        400,
        'TIMETABLE_TIME_RANGE_INVALID',
        'End time must be after start time',
      );
    }
  }

  private rangesOverlap(
    left: { start: number; end: number },
    right: { start: number; end: number },
  ) {
    return left.start < right.end && right.start < left.end;
  }

  private validateScheduleChanges(existing: ExistingSlot[], candidates: CandidateSlot[]) {
    const all = [
      ...existing.map((slot) => ({
        id: slot.id,
        classRoomId: slot.classRoomId,
        teacherUserId: slot.course.teacherUserId,
        dayOfWeek: slot.dayOfWeek,
        periodNumber: slot.periodNumber,
        startMin: this.timeToMinutes(slot.startTime),
        endMin: this.timeToMinutes(slot.endTime),
      })),
      ...candidates.map((slot, index) => ({
        id: slot.id ?? `candidate-${index}`,
        classRoomId: slot.classRoomId,
        teacherUserId: slot.teacherUserId,
        dayOfWeek: slot.dayOfWeek,
        periodNumber: slot.periodNumber,
        startMin: this.timeToMinutes(slot.startTime),
        endMin: this.timeToMinutes(slot.endTime),
      })),
    ];

    const classPeriodKeys = new Set<string>();
    for (const slot of all) {
      const key = `${slot.classRoomId}:${slot.dayOfWeek}:${slot.periodNumber}`;
      if (classPeriodKeys.has(key)) {
        throw new AppError(
          400,
          'CLASS_TIMETABLE_CONFLICT',
          'A class cannot have two subjects in the same period',
        );
      }
      classPeriodKeys.add(key);
    }

    for (let i = 0; i < all.length; i += 1) {
      const left = all[i];
      for (let j = i + 1; j < all.length; j += 1) {
        const right = all[j];
        if (left.dayOfWeek !== right.dayOfWeek) continue;
        const overlap = this.rangesOverlap(
          { start: left.startMin, end: left.endMin },
          { start: right.startMin, end: right.endMin },
        );
        if (!overlap) continue;
        if (left.classRoomId === right.classRoomId) {
          throw new AppError(
            400,
            'CLASS_TIMETABLE_TIME_CONFLICT',
            'This class already has another subject in the selected time range',
          );
        }
        if (left.teacherUserId === right.teacherUserId) {
          throw new AppError(
            400,
            'TEACHER_TIMETABLE_CONFLICT',
            'This teacher is already assigned to another class in an overlapping time',
          );
        }
      }
    }

    const dailyTeacherMinutes = new Map<string, number>();
    const weeklyTeacherMinutes = new Map<string, number>();
    for (const slot of all) {
      const minutes = slot.endMin - slot.startMin;
      const dayKey = `${slot.teacherUserId}:${slot.dayOfWeek}`;
      dailyTeacherMinutes.set(dayKey, (dailyTeacherMinutes.get(dayKey) ?? 0) + minutes);
      weeklyTeacherMinutes.set(
        slot.teacherUserId,
        (weeklyTeacherMinutes.get(slot.teacherUserId) ?? 0) + minutes,
      );
    }
    for (const minutes of dailyTeacherMinutes.values()) {
      if (minutes > 480) {
        throw new AppError(
          400,
          'TEACHER_DAILY_LIMIT_EXCEEDED',
          'Teacher working hours exceed 8 hours for at least one day',
        );
      }
    }
    for (const minutes of weeklyTeacherMinutes.values()) {
      if (minutes > 2400) {
        throw new AppError(
          400,
          'TEACHER_WEEKLY_LIMIT_EXCEEDED',
          'Teacher working hours exceed 40 hours in the selected timetable',
        );
      }
    }
  }

  private async getExistingSlots(
    tenantId: string,
    academicYearId: string,
    termId: string,
  ): Promise<ExistingSlot[]> {
    return prisma.timetableSlot.findMany({
      where: { tenantId, academicYearId, termId },
      include: {
        classRoom: { select: { name: true, code: true } },
        course: {
          select: {
            id: true,
            title: true,
            teacherUserId: true,
            classRoomId: true,
          },
        },
      },
    });
  }

  private async getCourseTeacherMap(tenantId: string, courseIds: string[]) {
    const courses = await prisma.course.findMany({
      where: { tenantId, id: { in: courseIds }, isActive: true },
      select: { id: true, teacherUserId: true },
    });
    return new Map(courses.map((course) => [course.id, course.teacherUserId]));
  }

  private timeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + (m || 0);
  }
}
