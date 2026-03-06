jest.mock('../../src/db/prisma', () => {
  const prisma = {
    academicYear: { findFirst: jest.fn(), findMany: jest.fn() },
    classRoom: { findFirst: jest.fn(), findMany: jest.fn() },
    student: {
      findFirst: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    studentEnrollment: {
      create: jest.fn(),
      createMany: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
    },
    parent: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    parentStudent: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  return { prisma };
});

import { prisma } from '../../src/db/prisma';
import { StudentsService } from '../../src/modules/students/students.service';

const mockedPrisma = prisma as any;

const actor = {
  sub: 'admin-1',
  tenantId: 'tenant-1',
  email: 'admin@school.rw',
  roles: ['SCHOOL_ADMIN'],
  permissions: ['students.manage', 'students.read'],
};

const context = {
  requestId: 'req-1',
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};

describe('students integration flow', () => {
  const studentsService = new StudentsService();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.auditLog.create.mockResolvedValue({ id: 1n });
  });

  it('enroll -> list with filters -> export', async () => {
    mockedPrisma.academicYear.findFirst.mockResolvedValue({
      id: 'year-1',
      name: '2026/2027',
    });
    mockedPrisma.classRoom.findFirst.mockResolvedValue({
      id: 'class-1',
      name: 'Grade 1 A',
    });

    mockedPrisma.$transaction
      .mockResolvedValueOnce([
        { id: 'year-1', name: '2026/2027' },
        { id: 'class-1', name: 'Grade 1 A' },
      ])
      .mockImplementationOnce(async (callback: any) => {
        const tx = {
          student: {
            create: jest.fn().mockResolvedValue({
              id: 'student-1',
              studentCode: 'STU-001',
              firstName: 'Alice',
              lastName: 'Uwase',
            }),
          },
          studentEnrollment: {
            create: jest.fn().mockResolvedValue({
              id: 'enrollment-1',
              academicYearId: 'year-1',
              classRoomId: 'class-1',
            }),
          },
        };

        return callback(tx);
      });

    mockedPrisma.student.findFirst.mockResolvedValueOnce({
      id: 'student-1',
      studentCode: 'STU-001',
      firstName: 'Alice',
      lastName: 'Uwase',
      gender: null,
      dateOfBirth: null,
      isActive: true,
      createdAt: new Date('2026-03-06T08:00:00.000Z'),
      updatedAt: new Date('2026-03-06T08:00:00.000Z'),
      enrollments: [
        {
          id: 'enrollment-1',
          academicYearId: 'year-1',
          classRoomId: 'class-1',
          enrolledAt: new Date('2026-03-06T08:00:00.000Z'),
          academicYear: { id: 'year-1', name: '2026/2027' },
          classRoom: { id: 'class-1', code: 'G1-A', name: 'Grade 1 A' },
        },
      ],
      parentLinks: [],
    });

    const created = await studentsService.createStudent(
      'tenant-1',
      {
        studentCode: 'STU-001',
        firstName: 'Alice',
        lastName: 'Uwase',
        enrollment: {
          academicYearId: 'year-1',
          classRoomId: 'class-1',
        },
      },
      actor,
      context,
    );

    expect(created.studentCode).toBe('STU-001');
    expect(created.currentEnrollment?.classRoom.id).toBe('class-1');

    const listRow = {
      id: 'student-1',
      studentCode: 'STU-001',
      firstName: 'Alice',
      lastName: 'Uwase',
      gender: null,
      dateOfBirth: null,
      isActive: true,
      createdAt: new Date('2026-03-06T08:00:00.000Z'),
      updatedAt: new Date('2026-03-06T08:00:00.000Z'),
      enrollments: [
        {
          id: 'enrollment-1',
          academicYearId: 'year-1',
          classRoomId: 'class-1',
          enrolledAt: new Date('2026-03-06T08:00:00.000Z'),
          academicYear: { id: 'year-1', name: '2026/2027' },
          classRoom: { id: 'class-1', code: 'G1-A', name: 'Grade 1 A' },
        },
      ],
      parentLinks: [],
    };

    mockedPrisma.$transaction.mockResolvedValueOnce([1, [listRow]]);

    const listed = await studentsService.listStudents('tenant-1', {
      classId: 'class-1',
      academicYearId: 'year-1',
      q: 'alice',
      page: 1,
      pageSize: 20,
    });

    expect(listed.items).toHaveLength(1);
    expect(listed.pagination.totalItems).toBe(1);
    expect(listed.items[0].studentCode).toBe('STU-001');

    mockedPrisma.student.findMany.mockResolvedValueOnce([listRow]);

    const exported = await studentsService.exportStudents('tenant-1', {
      classId: 'class-1',
      academicYearId: 'year-1',
      q: '',
      page: 1,
      pageSize: 20,
    });

    expect(exported.rowCount).toBe(1);
    expect(exported.csv).toContain('studentCode,firstName,lastName');
    expect(exported.csv).toContain('STU-001');
  });

  it('import preview -> commit with partial success', async () => {
    mockedPrisma.academicYear.findMany.mockResolvedValue([
      { id: 'year-1', name: '2026/2027' },
    ]);
    mockedPrisma.classRoom.findMany.mockResolvedValue([
      { id: 'class-1', code: 'G1-A', name: 'Grade 1 A' },
    ]);

    mockedPrisma.student.findMany.mockResolvedValueOnce([]);

    const csv = [
      'studentCode,firstName,lastName,academicYearId,classRoomId',
      'STU-101,Aline,Iradukunda,year-1,class-1',
      'STU-102,,Habimana,year-1,class-1',
    ].join('\n');

    const preview = await studentsService.importStudents(
      'tenant-1',
      {
        csv,
        mode: 'preview',
        allowPartial: false,
      },
      actor,
      context,
    );

    expect(preview.mode).toBe('preview');
    expect(preview.summary.totalRows).toBe(2);
    expect(preview.summary.invalidRows).toBe(1);

    mockedPrisma.student.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'student-imported-1', studentCode: 'STU-101' }]);

    mockedPrisma.$transaction.mockImplementationOnce(async (callback: any) => {
      const tx = {
        student: {
          createMany: jest.fn().mockResolvedValue({ count: 1 }),
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 'student-imported-1', studentCode: 'STU-101' }]),
        },
        studentEnrollment: {
          createMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };

      return callback(tx);
    });

    const committed = await studentsService.importStudents(
      'tenant-1',
      {
        csv,
        mode: 'commit',
        allowPartial: true,
      },
      actor,
      context,
    );

    expect(committed.mode).toBe('commit');
    expect(
      'importedRows' in committed.summary ? committed.summary.importedRows : 0,
    ).toBe(1);
    expect(
      'skippedRows' in committed.summary ? committed.summary.skippedRows : 0,
    ).toBe(1);
    expect(mockedPrisma.auditLog.create).toHaveBeenCalled();
  });
});
