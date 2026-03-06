jest.mock('../../src/db/prisma', () => {
  const prisma = {
    parent: {
      findFirst: jest.fn(),
    },
    parentStudent: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    attendanceRecord: {
      findMany: jest.fn(),
    },
  };

  return { prisma };
});

import { prisma } from '../../src/db/prisma';
import { ParentsService } from '../../src/modules/parents/parents.service';

const mockedPrisma = prisma as any;

describe('parent attendance flow', () => {
  const parentsService = new ParentsService();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns child attendance summary and linked child history only', async () => {
    mockedPrisma.parent.findFirst
      .mockResolvedValueOnce({
        id: 'parent-1',
        firstName: 'Family',
        lastName: 'Guardian',
      })
      .mockResolvedValueOnce({
        id: 'parent-1',
      });

    mockedPrisma.parentStudent.findMany.mockResolvedValue([
      {
        relationship: 'GUARDIAN',
        isPrimary: true,
        student: {
          id: 'student-1',
          studentCode: 'STU-001',
          firstName: 'Alice',
          lastName: 'Uwase',
          gender: 'FEMALE',
          dateOfBirth: new Date('2016-05-20T00:00:00.000Z'),
          enrollments: [
            {
              id: 'enrollment-1',
              enrolledAt: new Date('2026-01-08T00:00:00.000Z'),
              academicYear: {
                id: 'year-1',
                name: '2026 Academic Year',
              },
              classRoom: {
                id: 'class-1',
                code: 'G1-A',
                name: 'Grade 1 A',
              },
            },
          ],
        },
      },
    ]);

    mockedPrisma.attendanceRecord.findMany
      .mockResolvedValueOnce([
        {
          studentId: 'student-1',
          status: 'PRESENT',
          attendanceDate: new Date('2026-03-06T00:00:00.000Z'),
        },
        {
          studentId: 'student-1',
          status: 'ABSENT',
          attendanceDate: new Date('2026-03-05T00:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'record-1',
          attendanceDate: new Date('2026-03-06T00:00:00.000Z'),
          status: 'PRESENT',
          remarks: null,
          markedAt: new Date('2026-03-06T07:00:00.000Z'),
          updatedAt: new Date('2026-03-06T07:00:00.000Z'),
          classRoom: {
            id: 'class-1',
            code: 'G1-A',
            name: 'Grade 1 A',
          },
        },
        {
          id: 'record-2',
          attendanceDate: new Date('2026-03-05T00:00:00.000Z'),
          status: 'ABSENT',
          remarks: 'Sick',
          markedAt: new Date('2026-03-05T07:00:00.000Z'),
          updatedAt: new Date('2026-03-05T07:00:00.000Z'),
          classRoom: {
            id: 'class-1',
            code: 'G1-A',
            name: 'Grade 1 A',
          },
        },
      ]);

    mockedPrisma.parentStudent.findFirst.mockResolvedValue({
      student: {
        id: 'student-1',
        studentCode: 'STU-001',
        firstName: 'Alice',
        lastName: 'Uwase',
        enrollments: [
          {
            id: 'enrollment-1',
            enrolledAt: new Date('2026-01-08T00:00:00.000Z'),
            academicYear: {
              id: 'year-1',
              name: '2026 Academic Year',
            },
            classRoom: {
              id: 'class-1',
              code: 'G1-A',
              name: 'Grade 1 A',
            },
          },
        ],
      },
    });

    const children = await parentsService.listMyStudents('tenant-1', 'parent-user-1');
    expect(children.students).toHaveLength(1);
    expect(children.students[0].attendanceLast30Days).toEqual({
      total: 2,
      present: 1,
      absent: 1,
      late: 0,
      excused: 0,
      lastMarkedDate: '2026-03-06',
    });

    const history = await parentsService.getMyStudentAttendance(
      'tenant-1',
      'parent-user-1',
      'student-1',
      {
        from: '2026-03-01',
        to: '2026-03-06',
      },
    );

    expect(history.summary).toEqual({
      total: 2,
      present: 1,
      absent: 1,
      late: 0,
      excused: 0,
    });
    expect(history.records).toHaveLength(2);
    expect(history.student.studentCode).toBe('STU-001');
  });
});

