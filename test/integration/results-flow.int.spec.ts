jest.mock('../../src/db/prisma', () => {
  const prisma = {
    gradingScheme: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    term: {
      findFirst: jest.fn(),
    },
    classRoom: {
      findFirst: jest.fn(),
    },
    subject: {
      findFirst: jest.fn(),
    },
    course: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    exam: {
      create: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    examMark: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    studentEnrollment: {
      findMany: jest.fn(),
    },
    student: {
      findFirst: jest.fn(),
    },
    parent: {
      findFirst: jest.fn(),
    },
    resultSnapshot: {
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    school: {
      findFirst: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  return { prisma };
});

import { prisma } from '../../src/db/prisma';
import { ExamsService } from '../../src/modules/exams/exams.service';

const mockedPrisma = prisma as any;

const adminActor = {
  sub: 'admin-1',
  tenantId: 'tenant-1',
  email: 'admin@school.rw',
  roles: ['SCHOOL_ADMIN'],
  permissions: ['grading_schemes.manage', 'exams.read', 'exams.manage', 'exam_marks.manage', 'results.lock', 'results.publish', 'report_cards.read'],
};

const teacherActor = {
  sub: 'teacher-1',
  tenantId: 'tenant-1',
  email: 'teacher@school.rw',
  roles: ['TEACHER'],
  permissions: ['exams.read', 'exams.manage', 'exam_marks.manage', 'report_cards.read'],
};

const studentActor = {
  sub: 'student-user-1',
  tenantId: 'tenant-1',
  email: 'student@school.rw',
  roles: ['STUDENT'],
  permissions: ['report_cards.my_read'],
};

const parentActor = {
  sub: 'parent-user-1',
  tenantId: 'tenant-1',
  email: 'parent@school.rw',
  roles: ['PARENT'],
  permissions: ['report_cards.my_read'],
};

const context = {
  requestId: 'req-1',
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};

function buildGradingScheme() {
  return {
    id: 'scheme-1',
    tenantId: 'tenant-1',
    name: 'Standard grading',
    version: 1,
    description: 'Default',
    rules: [
      { min: 80, max: 100, grade: 'A', remark: 'Excellent' },
      { min: 0, max: 79, grade: 'B', remark: 'Good' },
    ],
    isDefault: true,
    isActive: true,
    createdAt: new Date('2026-03-06T08:00:00.000Z'),
    updatedAt: new Date('2026-03-06T08:00:00.000Z'),
  };
}

function buildExamSummary() {
  return {
    id: 'exam-1',
    tenantId: 'tenant-1',
    academicYearId: 'year-1',
    termId: 'term-1',
    classRoomId: 'class-1',
    subjectId: 'subject-1',
    gradingSchemeId: 'scheme-1',
    teacherUserId: 'teacher-1',
    name: 'Mid-term Mathematics',
    description: null,
    totalMarks: 100,
    weight: 100,
    examDate: new Date('2026-03-10T08:00:00.000Z'),
    isActive: true,
    createdByUserId: 'admin-1',
    updatedByUserId: 'admin-1',
    createdAt: new Date('2026-03-06T08:00:00.000Z'),
    updatedAt: new Date('2026-03-06T08:00:00.000Z'),
    term: {
      id: 'term-1',
      name: 'Term 1',
      sequence: 1,
      academicYearId: 'year-1',
    },
    academicYear: {
      id: 'year-1',
      name: '2026 Academic Year',
    },
    classRoom: {
      id: 'class-1',
      code: 'G1-A',
      name: 'Grade 1 A',
    },
    subject: {
      id: 'subject-1',
      code: 'MATH',
      name: 'Mathematics',
    },
    gradingScheme: {
      id: 'scheme-1',
      name: 'Standard grading',
      version: 1,
    },
    teacherUser: {
      id: 'teacher-1',
      firstName: 'Daily',
      lastName: 'Teacher',
    },
    _count: {
      marks: 0,
    },
  };
}

function buildExamDetail() {
  return {
    ...buildExamSummary(),
    marks: [
      {
        id: 'mark-1',
        tenantId: 'tenant-1',
        examId: 'exam-1',
        studentId: 'student-1',
        marksObtained: 88,
        student: {
          id: 'student-1',
          studentCode: 'STU-001',
          firstName: 'Alice',
          lastName: 'Uwase',
        },
      },
      {
        id: 'mark-2',
        tenantId: 'tenant-1',
        examId: 'exam-1',
        studentId: 'student-2',
        marksObtained: 73,
        student: {
          id: 'student-2',
          studentCode: 'STU-002',
          firstName: 'Bob',
          lastName: 'Mugisha',
        },
      },
    ],
  };
}

function buildStudentRows() {
  return [
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
        firstName: 'Bob',
        lastName: 'Mugisha',
      },
    },
  ];
}

function buildReportCardSnapshot() {
  return {
    id: 'snapshot-1',
    tenantId: 'tenant-1',
    academicYearId: 'year-1',
    termId: 'term-1',
    classRoomId: 'class-1',
    studentId: 'student-1',
    gradingSchemeId: 'scheme-1',
    gradingSchemeVersion: 1,
    status: 'PUBLISHED',
    payload: {
      schoolName: 'GS Rwanda',
      academicYear: { id: 'year-1', name: '2026 Academic Year' },
      term: { id: 'term-1', name: 'Term 1' },
      classRoom: { id: 'class-1', code: 'G1-A', name: 'Grade 1 A' },
      student: { id: 'student-1', studentCode: 'STU-001', firstName: 'Alice', lastName: 'Uwase' },
      gradingScheme: { id: 'scheme-1', name: 'Standard grading', version: 1 },
      subjects: [
        {
          subjectId: 'subject-1',
          subjectName: 'Mathematics',
          averagePercentage: 88,
          grade: 'A',
          remark: 'Excellent',
        },
      ],
      totals: {
        totalMarksObtained: 88,
        totalMarksPossible: 100,
        averagePercentage: 88,
        grade: 'A',
        remark: 'Excellent',
        position: 1,
        classSize: 2,
      },
    },
    lockedAt: new Date('2026-03-10T10:00:00.000Z'),
    publishedAt: new Date('2026-03-10T11:00:00.000Z'),
    createdAt: new Date('2026-03-10T10:00:00.000Z'),
    updatedAt: new Date('2026-03-10T11:00:00.000Z'),
    term: {
      id: 'term-1',
      name: 'Term 1',
      sequence: 1,
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2026-04-01T00:00:00.000Z'),
    },
    academicYear: {
      id: 'year-1',
      name: '2026 Academic Year',
    },
    classRoom: {
      id: 'class-1',
      code: 'G1-A',
      name: 'Grade 1 A',
    },
    student: {
      id: 'student-1',
      studentCode: 'STU-001',
      firstName: 'Alice',
      lastName: 'Uwase',
    },
    gradingScheme: {
      id: 'scheme-1',
      name: 'Standard grading',
      version: 1,
    },
  };
}

describe('results integration flow', () => {
  const service = new ExamsService();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.auditLog.create.mockResolvedValue({ id: 1n });
  });

  it('create exam -> enter marks -> lock -> publish -> student views report card', async () => {
    mockedPrisma.term.findFirst.mockResolvedValue({
      id: 'term-1',
      tenantId: 'tenant-1',
      academicYearId: 'year-1',
      name: 'Term 1',
      sequence: 1,
      isActive: true,
      academicYear: {
        id: 'year-1',
        name: '2026 Academic Year',
      },
    });
    mockedPrisma.classRoom.findFirst.mockResolvedValue({ id: 'class-1', code: 'G1-A', name: 'Grade 1 A' });
    mockedPrisma.subject.findFirst.mockResolvedValue({ id: 'subject-1', code: 'MATH', name: 'Mathematics' });
    mockedPrisma.gradingScheme.findFirst.mockResolvedValue(buildGradingScheme());
    mockedPrisma.course.findFirst.mockResolvedValue({ id: 'course-1', teacherUserId: 'teacher-1' });
    mockedPrisma.exam.create.mockResolvedValue(buildExamSummary());

    const createdExam = await service.createExam(
      'tenant-1',
      {
        termId: 'term-1',
        classRoomId: 'class-1',
        subjectId: 'subject-1',
        name: 'Mid-term Mathematics',
        totalMarks: 100,
        weight: 100,
      },
      adminActor,
      context,
    );

    expect(createdExam.name).toBe('Mid-term Mathematics');

    mockedPrisma.exam.findFirst.mockResolvedValue(buildExamDetail());
    mockedPrisma.resultSnapshot.findFirst.mockResolvedValue(null);
    mockedPrisma.studentEnrollment.findMany.mockResolvedValue(buildStudentRows());
    mockedPrisma.examMark.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { studentId: 'student-1', marksObtained: 88 },
        { studentId: 'student-2', marksObtained: 73 },
      ]);
    mockedPrisma.$transaction.mockImplementation(async (arg: any) => {
      if (Array.isArray(arg)) {
        return Promise.all(arg);
      }

      const tx = {
        examMark: {
          upsert: jest.fn().mockResolvedValue(undefined),
          delete: jest.fn().mockResolvedValue(undefined),
        },
        exam: {
          update: jest.fn().mockResolvedValue(undefined),
        },
        resultSnapshot: {
          create: jest.fn().mockResolvedValue(undefined),
        },
      };
      return arg(tx);
    });

    const savedMarks = await service.bulkSaveMarks(
      'tenant-1',
      'exam-1',
      {
        entries: [
          { studentId: 'student-1', marksObtained: 88 },
          { studentId: 'student-2', marksObtained: 73 },
        ],
      },
      teacherActor,
      context,
    );

    expect(savedMarks.warnings.missingCount).toBe(0);

    mockedPrisma.school.findFirst.mockResolvedValue({ displayName: 'GS Rwanda' });
    mockedPrisma.resultSnapshot.count.mockResolvedValue(0);
    mockedPrisma.exam.findMany.mockResolvedValue([
      {
        id: 'exam-1',
        subjectId: 'subject-1',
        name: 'Mid-term Mathematics',
        totalMarks: 100,
        weight: 100,
        subject: { id: 'subject-1', name: 'Mathematics', code: 'MATH' },
        marks: [
          { studentId: 'student-1', marksObtained: 88 },
          { studentId: 'student-2', marksObtained: 73 },
        ],
      },
    ]);

    const locked = await service.lockResults(
      'tenant-1',
      { termId: 'term-1', classRoomId: 'class-1' },
      adminActor,
      context,
    );

    expect(locked.status).toBe('LOCKED');
    expect(locked.snapshotsCreated).toBe(2);

    mockedPrisma.resultSnapshot.findMany.mockResolvedValue([{ id: 'snapshot-1' }, { id: 'snapshot-2' }]);
    mockedPrisma.resultSnapshot.updateMany.mockResolvedValue({ count: 2 });

    const published = await service.publishResults(
      'tenant-1',
      { termId: 'term-1', classRoomId: 'class-1' },
      adminActor,
      context,
    );

    expect(published.status).toBe('PUBLISHED');

    mockedPrisma.student.findFirst.mockResolvedValue({
      id: 'student-1',
      studentCode: 'STU-001',
      firstName: 'Alice',
      lastName: 'Uwase',
    });
    mockedPrisma.resultSnapshot.findMany.mockResolvedValue([buildReportCardSnapshot()]);

    const myReportCards = await service.getMyReportCards('tenant-1', studentActor, {});

    expect(myReportCards.items).toHaveLength(1);
    expect(myReportCards.items[0].totals.grade).toBe('A');
  });

  it('prevents parent from reading report cards for an unlinked student', async () => {
    mockedPrisma.parent.findFirst.mockResolvedValue({
      id: 'parent-1',
      firstName: 'Parent',
      lastName: 'One',
      students: [{ studentId: 'student-1' }],
    });

    await expect(
      service.getParentReportCards('tenant-1', parentActor, {
        studentId: 'student-2',
      }),
    ).rejects.toMatchObject({
      code: 'REPORT_CARD_FORBIDDEN',
      statusCode: 403,
    });
  });
});
