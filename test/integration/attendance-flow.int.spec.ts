jest.mock('../../src/db/prisma', () => {
  const prisma = {
    classRoom: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    academicYear: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    student: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    studentEnrollment: {
      findMany: jest.fn(),
    },
    attendanceSession: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    attendanceRecord: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  return { prisma };
});

import { AttendanceStatus } from '@prisma/client';

import { prisma } from '../../src/db/prisma';
import { AttendanceService } from '../../src/modules/attendance/attendance.service';

const mockedPrisma = prisma as any;

const actor = {
  sub: 'teacher-1',
  tenantId: 'tenant-1',
  email: 'teacher@school.rw',
  roles: ['TEACHER'],
  permissions: ['attendance.read', 'attendance.manage'],
};

const context = {
  requestId: 'req-attendance-1',
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};

describe('attendance integration flow', () => {
  const attendanceService = new AttendanceService();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.auditLog.create.mockResolvedValue({ id: 1n });
  });

  it('create session -> submit records -> fetch class report', async () => {
    const attendanceDate = '2026-03-06';
    const attendanceDateUtc = new Date('2026-03-06T00:00:00.000Z');
    const sessionCreatedAt = new Date('2026-03-06T08:00:00.000Z');

    mockedPrisma.classRoom.findFirst
      .mockResolvedValueOnce({ id: 'class-1' })
      .mockResolvedValueOnce({
        id: 'class-1',
        code: 'G1-A',
        name: 'Grade 1 A',
        gradeLevel: {
          id: 'grade-1',
          code: 'G1',
          name: 'Grade 1',
        },
      });

    mockedPrisma.academicYear.findFirst.mockResolvedValue({
      id: 'year-1',
      name: '2026/2027',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2026-12-31T00:00:00.000Z'),
    });

    mockedPrisma.attendanceSession.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'session-1',
        tenantId: 'tenant-1',
        classRoomId: 'class-1',
        academicYearId: 'year-1',
        sessionDate: attendanceDateUtc,
        status: 'OPEN',
        createdByUserId: 'teacher-1',
        editedByUserId: 'teacher-1',
        createdAt: sessionCreatedAt,
        updatedAt: sessionCreatedAt,
        academicYear: {
          id: 'year-1',
          name: '2026/2027',
        },
      });

    mockedPrisma.attendanceSession.create.mockResolvedValue({
      id: 'session-1',
      tenantId: 'tenant-1',
      classRoomId: 'class-1',
      academicYearId: 'year-1',
      sessionDate: attendanceDateUtc,
      status: 'OPEN',
      createdByUserId: 'teacher-1',
      editedByUserId: 'teacher-1',
      createdAt: sessionCreatedAt,
      updatedAt: sessionCreatedAt,
      academicYear: {
        id: 'year-1',
        name: '2026/2027',
      },
    });

    const created = await attendanceService.createSession(
      'tenant-1',
      {
        classRoomId: 'class-1',
        date: attendanceDate,
      },
      actor,
      context,
    );

    expect(created.created).toBe(true);
    expect(created.session.id).toBe('session-1');

    mockedPrisma.attendanceSession.findFirst.mockResolvedValue({
      id: 'session-1',
      tenantId: 'tenant-1',
      classRoomId: 'class-1',
      academicYearId: 'year-1',
      sessionDate: attendanceDateUtc,
      status: 'OPEN',
      createdByUserId: 'teacher-1',
      editedByUserId: 'teacher-1',
      createdAt: sessionCreatedAt,
      updatedAt: sessionCreatedAt,
    });

    mockedPrisma.student.findMany.mockResolvedValue([
      { id: 'student-1' },
      { id: 'student-2' },
    ]);
    mockedPrisma.studentEnrollment.findMany.mockResolvedValue([
      { studentId: 'student-1' },
      { studentId: 'student-2' },
    ]);
    mockedPrisma.attendanceRecord.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'record-1',
          studentId: 'student-1',
          status: AttendanceStatus.ABSENT,
          remarks: 'Sick',
          markedAt: sessionCreatedAt,
          updatedAt: sessionCreatedAt,
        },
      ]);

    mockedPrisma.$transaction.mockImplementationOnce(async (callback: any) => {
      const tx = {
        attendanceSession: {
          update: jest.fn().mockResolvedValue({
            id: 'session-1',
          }),
        },
        attendanceRecord: {
          upsert: jest.fn().mockResolvedValue({ id: 'record-1' }),
        },
      };

      return callback(tx);
    });

    const saved = await attendanceService.saveBulkRecords(
      'tenant-1',
      {
        sessionId: 'session-1',
        records: [
          { studentId: 'student-1', status: AttendanceStatus.ABSENT, remarks: 'Sick' },
          { studentId: 'student-2', status: AttendanceStatus.PRESENT },
        ],
      },
      actor,
      context,
    );

    expect(saved.savedCount).toBe(2);

    mockedPrisma.studentEnrollment.findMany.mockResolvedValueOnce([
      {
        student: {
          id: 'student-1',
          studentCode: 'STU-001',
          firstName: 'Alice',
          lastName: 'Uwase',
        },
      },
      {
        student: {
          id: 'student-2',
          studentCode: 'STU-002',
          firstName: 'Eric',
          lastName: 'Ndayisaba',
        },
      },
    ]);

    const report = await attendanceService.getClassAttendance('tenant-1', 'class-1', {
      date: attendanceDate,
    });

    expect(report.date).toBe(attendanceDate);
    expect(report.students).toHaveLength(2);
    expect(report.summary.total).toBe(2);
    expect(report.summary.absent).toBe(1);
    expect(report.summary.present).toBe(1);
    expect(report.students[0].status).toBe(AttendanceStatus.ABSENT);
    expect(report.students[1].status).toBe(AttendanceStatus.PRESENT);
    expect(mockedPrisma.auditLog.create).toHaveBeenCalled();
  });
});

