import { prisma } from '../../src/db/prisma';
import { TimetableService } from '../../src/modules/timetable/timetable.service';
import { AppError } from '../../src/common/errors/app-error';

describe('Timetable Teacher Conflict Validation', () => {
  const service = new TimetableService();
  let tenantId: string;
  let academicYearId: string;
  let termId: string;
  let classAId: string;
  let classBId: string;
  let teacherId: string;
  let courseAId: string;
  let courseBId: string;

  beforeAll(async () => {
    // Setup test data
    const tenant = await prisma.tenant.create({
      data: {
        code: `test-timetable-${Date.now()}`,
        name: 'Test School',
      },
    });
    tenantId = tenant.id;

    const year = await prisma.academicYear.create({
      data: {
        tenantId,
        name: '2025-2026',
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-12-31'),
        isCurrent: true,
      },
    });
    academicYearId = year.id;

    const term = await prisma.term.create({
      data: {
        tenantId,
        academicYearId,
        name: 'Term 1',
        sequence: 1,
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-04-30'),
      },
    });
    termId = term.id;

    const grade = await prisma.gradeLevel.create({
      data: { tenantId, name: 'Grade 1', code: 'G1', rank: 1 },
    });

    const classA = await prisma.classRoom.create({
      data: { tenantId, gradeLevelId: grade.id, name: 'Class A', code: 'A' },
    });
    classAId = classA.id;

    const classB = await prisma.classRoom.create({
      data: { tenantId, gradeLevelId: grade.id, name: 'Class B', code: 'B' },
    });
    classBId = classB.id;

    const user = await prisma.user.create({
      data: {
        tenantId,
        email: `teacher-${Date.now()}@test.com`,
        passwordHash: 'hash',
        firstName: 'John',
        lastName: 'Doe',
      },
    });
    teacherId = user.id;

    const courseA = await prisma.course.create({
      data: {
        tenantId,
        academicYearId,
        classRoomId: classAId,
        teacherUserId: teacherId,
        title: 'Math Class A',
      },
    });
    courseAId = courseA.id;

    const courseB = await prisma.course.create({
      data: {
        tenantId,
        academicYearId,
        classRoomId: classBId,
        teacherUserId: teacherId,
        title: 'Math Class B',
      },
    });
    courseBId = courseB.id;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.timetableSlot.deleteMany({ where: { tenantId } });
    await prisma.course.deleteMany({ where: { tenantId } });
    await prisma.classRoom.deleteMany({ where: { tenantId } });
    await prisma.gradeLevel.deleteMany({ where: { tenantId } });
    await prisma.term.deleteMany({ where: { tenantId } });
    await prisma.academicYear.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
  });

  it('should allow creating a slot if teacher is available', async () => {
    const slot = await service.createSlot(
      tenantId,
      {
        academicYearId,
        termId,
        classRoomId: classAId,
        courseId: courseAId,
        dayOfWeek: 1,
        periodNumber: 1,
        startTime: '08:00',
        endTime: '08:45',
      },
      { sub: teacherId, roles: ['SUPER_ADMIN'], tenantId } as any,
    );
    expect(slot).toBeDefined();
  });

  it('should prevent creating a slot if teacher is busy in another class at the same time', async () => {
    await expect(
      service.createSlot(
        tenantId,
        {
          academicYearId,
          termId,
          classRoomId: classBId, // Conflict with classA
          courseId: courseBId,
          dayOfWeek: 1,
          periodNumber: 1,
          startTime: '08:00',
          endTime: '08:45',
        },
        { sub: teacherId, roles: ['SUPER_ADMIN'], tenantId } as any,
      ),
    ).rejects.toThrow(
      new AppError(
        400,
        'TEACHER_TIMETABLE_CONFLICT',
        'Teacher John Doe is already assigned to Math Class A in class Class A (A) during this period on day 1.',
      ),
    );
  });

  it('should allow the same teacher at different periods', async () => {
    const slot = await service.createSlot(
      tenantId,
      {
        academicYearId,
        termId,
        classRoomId: classBId,
        courseId: courseBId,
        dayOfWeek: 1,
        periodNumber: 2, // Different period
        startTime: '08:45',
        endTime: '09:30',
      },
      { sub: teacherId, roles: ['SUPER_ADMIN'], tenantId } as any,
    );
    expect(slot).toBeDefined();
  });
});
