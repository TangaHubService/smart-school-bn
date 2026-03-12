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

export class TimetableService {
  async listSlots(
    tenantId: string,
    query: ListTimetableSlotsQueryInput,
    actor?: JwtUser,
  ) {
    const where: { tenantId: string; academicYearId: string; classRoomId: string; termId?: string } = {
      tenantId,
      academicYearId: query.academicYearId,
      classRoomId: query.classRoomId,
    };

    if (query.termId) {
      where.termId = query.termId;
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
    await this.ensureSlotTargets(tenantId, input);
    await this.ensureTeacherCanManage(tenantId, input.courseId, actor);

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

    if (input.courseId) {
      await this.ensureTeacherCanManage(tenantId, input.courseId, actor);
    } else {
      await this.ensureTeacherCanManage(tenantId, existing.courseId, actor);
    }

    if (input.academicYearId || input.termId || input.classRoomId || input.courseId) {
      await this.ensureSlotTargets(tenantId, {
        academicYearId: input.academicYearId ?? existing.academicYearId,
        termId: input.termId ?? existing.termId,
        classRoomId: input.classRoomId ?? existing.classRoomId,
        courseId: input.courseId ?? existing.courseId,
      });
    }

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

    await this.ensureTeacherCanManage(tenantId, existing.courseId, actor);

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
    const first = input.slots[0];
    await this.ensureSlotTargets(tenantId, {
      academicYearId: input.academicYearId,
      termId: input.termId,
      classRoomId: input.classRoomId,
      courseId: first.courseId,
    });

    for (const s of input.slots) {
      await this.ensureTeacherCanManage(tenantId, s.courseId, actor);
    }

    await prisma.timetableSlot.deleteMany({
      where: {
        tenantId,
        academicYearId: input.academicYearId,
        termId: input.termId,
        classRoomId: input.classRoomId,
      },
    });

    const created = await prisma.timetableSlot.createMany({
      data: input.slots.map((s) => ({
        tenantId,
        academicYearId: input.academicYearId,
        termId: input.termId,
        classRoomId: input.classRoomId,
        courseId: s.courseId,
        dayOfWeek: s.dayOfWeek,
        periodNumber: s.periodNumber,
        startTime: s.startTime,
        endTime: s.endTime,
      })),
    });

    const slots = await prisma.timetableSlot.findMany({
      where: {
        tenantId,
        academicYearId: input.academicYearId,
        termId: input.termId,
        classRoomId: input.classRoomId,
      },
      include: slotInclude,
      orderBy: [{ dayOfWeek: 'asc' }, { periodNumber: 'asc' }],
    });

    return { created: created.count, slots };
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

  private async ensureTeacherCanManage(
    tenantId: string,
    courseId: string,
    actor: JwtUser,
  ) {
    const isAdmin =
      actor.roles?.includes('SCHOOL_ADMIN') || actor.roles?.includes('SUPER_ADMIN');
    if (isAdmin) return;

    const course = await prisma.course.findFirst({
      where: { id: courseId, tenantId },
    });
    if (!course) return;
    if (course.teacherUserId !== actor.sub) {
      throw new AppError(
        403,
        'TIMETABLE_FORBIDDEN',
        'You can only manage timetable for your own courses',
      );
    }
  }
}
