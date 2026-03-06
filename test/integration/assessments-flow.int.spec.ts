jest.mock('../../src/db/prisma', () => {
  const prisma = {
    course: {
      findFirst: jest.fn(),
    },
    lesson: {
      findFirst: jest.fn(),
    },
    student: {
      findFirst: jest.fn(),
    },
    assessment: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    assessmentQuestion: {
      aggregate: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      updateMany: jest.fn(),
    },
    assessmentOption: {
      deleteMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
    },
    assessmentAttempt: {
      findMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    assessmentAnswer: {
      upsert: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  return { prisma };
});

import { prisma } from '../../src/db/prisma';
import { AssessmentsService } from '../../src/modules/assessments/assessments.service';

const mockedPrisma = prisma as any;

const teacherActor = {
  sub: 'teacher-1',
  tenantId: 'tenant-1',
  email: 'teacher@school.rw',
  roles: ['TEACHER'],
  permissions: [
    'courses.read',
    'courses.manage',
    'assessments.read',
    'assessments.manage',
    'assessments.publish',
    'assessment_results.read',
  ],
};

const studentActor = {
  sub: 'student-user-1',
  tenantId: 'tenant-1',
  email: 'student@school.rw',
  roles: ['STUDENT'],
  permissions: ['students.my_courses.read', 'assessments.submit'],
};

const context = {
  requestId: 'req-1',
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};

function buildAssessmentSummaryRow() {
  return {
    id: 'assessment-1',
    tenantId: 'tenant-1',
    courseId: 'course-1',
    lessonId: null,
    type: 'GENERAL',
    title: 'Unit 1 Check',
    instructions: '<p>Pick one answer.</p>',
    dueAt: new Date('2026-03-08T08:00:00.000Z'),
    timeLimitMinutes: 15,
    maxAttempts: 1,
    isPublished: false,
    publishedAt: null,
    createdByUserId: 'teacher-1',
    updatedByUserId: 'teacher-1',
    createdAt: new Date('2026-03-06T08:00:00.000Z'),
    updatedAt: new Date('2026-03-06T08:00:00.000Z'),
    course: {
      id: 'course-1',
      title: 'Mathematics Grade 1',
      teacherUserId: 'teacher-1',
      classRoom: {
        id: 'class-1',
        code: 'G1-A',
        name: 'Grade 1 A',
      },
      academicYear: {
        id: 'year-1',
        name: '2026 Academic Year',
      },
      subject: {
        id: 'subject-1',
        code: 'MATH',
        name: 'Mathematics',
      },
    },
    lesson: null,
    _count: {
      questions: 0,
      attempts: 0,
    },
  };
}

function buildAssessmentDetailRow() {
  return {
    ...buildAssessmentSummaryRow(),
    questions: [
      {
        id: 'question-1',
        tenantId: 'tenant-1',
        assessmentId: 'assessment-1',
        prompt: '2 + 2 = ?',
        explanation: 'Two plus two equals four.',
        type: 'MCQ_SINGLE',
        sequence: 1,
        points: 5,
        createdAt: new Date('2026-03-06T08:10:00.000Z'),
        updatedAt: new Date('2026-03-06T08:10:00.000Z'),
        options: [
          {
            id: 'option-1',
            tenantId: 'tenant-1',
            questionId: 'question-1',
            label: '3',
            sequence: 1,
            isCorrect: false,
            createdAt: new Date('2026-03-06T08:10:00.000Z'),
            updatedAt: new Date('2026-03-06T08:10:00.000Z'),
          },
          {
            id: 'option-2',
            tenantId: 'tenant-1',
            questionId: 'question-1',
            label: '4',
            sequence: 2,
            isCorrect: true,
            createdAt: new Date('2026-03-06T08:10:00.000Z'),
            updatedAt: new Date('2026-03-06T08:10:00.000Z'),
          },
        ],
      },
    ],
    _count: {
      questions: 1,
      attempts: 0,
    },
  };
}

function buildStudentAssessmentRow() {
  return {
    id: 'assessment-1',
    tenantId: 'tenant-1',
    courseId: 'course-1',
    lessonId: null,
    type: 'GENERAL',
    title: 'Unit 1 Check',
    instructions: '<p>Pick one answer.</p>',
    dueAt: new Date('2026-03-08T08:00:00.000Z'),
    timeLimitMinutes: 15,
    maxAttempts: 1,
    isPublished: true,
    publishedAt: new Date('2026-03-06T08:12:00.000Z'),
    createdByUserId: 'teacher-1',
    updatedByUserId: 'teacher-1',
    createdAt: new Date('2026-03-06T08:00:00.000Z'),
    updatedAt: new Date('2026-03-06T08:12:00.000Z'),
    course: {
      id: 'course-1',
      title: 'Mathematics Grade 1',
      teacherUserId: 'teacher-1',
      classRoomId: 'class-1',
      academicYearId: 'year-1',
      classRoom: {
        id: 'class-1',
        code: 'G1-A',
        name: 'Grade 1 A',
      },
      academicYear: {
        id: 'year-1',
        name: '2026 Academic Year',
      },
      subject: {
        id: 'subject-1',
        code: 'MATH',
        name: 'Mathematics',
      },
    },
    lesson: null,
    questions: buildAssessmentDetailRow().questions,
  };
}

function buildAttemptRow(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: 'attempt-1',
    tenantId: 'tenant-1',
    assessmentId: 'assessment-1',
    studentId: 'student-1',
    studentUserId: 'student-user-1',
    attemptNumber: 1,
    status: 'IN_PROGRESS',
    startedAt: now,
    submittedAt: null,
    autoScore: null,
    manualScore: null,
    maxScore: null,
    manualFeedback: null,
    manuallyGradedAt: null,
    manuallyGradedByUserId: null,
    manuallyGradedByUser: null,
    createdAt: now,
    updatedAt: now,
    student: {
      id: 'student-1',
      studentCode: 'STU-001',
      firstName: 'Alice',
      lastName: 'Uwase',
    },
    assessment: buildStudentAssessmentRow(),
    answers: [],
    ...overrides,
  };
}

describe('assessments integration flow', () => {
  const service = new AssessmentsService();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.auditLog.create.mockResolvedValue({ id: 1n });
  });

  it('create assessment -> student attempt -> submit -> auto-grade', async () => {
    mockedPrisma.course.findFirst.mockResolvedValue({
      id: 'course-1',
      teacherUserId: 'teacher-1',
    });
    mockedPrisma.assessment.create.mockResolvedValue(buildAssessmentSummaryRow());

    const createdAssessment = await service.createAssessment(
      'tenant-1',
      {
        courseId: 'course-1',
        type: 'GENERAL',
        title: 'Unit 1 Check',
        instructions: '<p>Pick one answer.</p>',
        dueAt: '2026-03-08T08:00:00.000Z',
        timeLimitMinutes: 15,
        maxAttempts: 1,
        isPublished: false,
      },
      teacherActor,
      context,
    );

    expect(createdAssessment.title).toBe('Unit 1 Check');

    mockedPrisma.assessment.findFirst.mockResolvedValue({
      ...buildAssessmentSummaryRow(),
      questions: [],
    });

    mockedPrisma.$transaction.mockImplementationOnce(async (callback: any) => {
      const tx = {
        assessmentQuestion: {
          aggregate: jest.fn().mockResolvedValue({ _max: { sequence: 0 } }),
          create: jest.fn().mockResolvedValue(buildAssessmentDetailRow().questions[0]),
        },
      };

      return callback(tx);
    });
    mockedPrisma.assessment.update.mockResolvedValue({ id: 'assessment-1' });

    const createdQuestion = await service.addQuestion(
      'tenant-1',
      'assessment-1',
      {
        prompt: '2 + 2 = ?',
        explanation: 'Two plus two equals four.',
        type: 'MCQ_SINGLE',
        points: 5,
        options: [
          { label: '3', isCorrect: false },
          { label: '4', isCorrect: true },
        ],
      },
      teacherActor,
      context,
    );

    expect(createdQuestion.options.some((option: any) => option.isCorrect)).toBe(true);

    mockedPrisma.student.findFirst.mockResolvedValue({
      id: 'student-1',
      userId: 'student-user-1',
      studentCode: 'STU-001',
      firstName: 'Alice',
      lastName: 'Uwase',
      enrollments: [
        {
          classRoomId: 'class-1',
          academicYearId: 'year-1',
          academicYear: { id: 'year-1', name: '2026 Academic Year' },
          classRoom: { id: 'class-1', code: 'G1-A', name: 'Grade 1 A' },
        },
      ],
    });

    mockedPrisma.assessment.findFirst.mockResolvedValue(buildStudentAssessmentRow());
    mockedPrisma.assessmentAttempt.findMany.mockResolvedValue([]);
    mockedPrisma.assessmentAttempt.create.mockResolvedValue(buildAttemptRow());

    const startedAttempt = await service.startAttempt(
      'tenant-1',
      'assessment-1',
      studentActor,
      context,
    );

    expect(startedAttempt.status).toBe('IN_PROGRESS');
    expect(startedAttempt.questions).toHaveLength(1);

    mockedPrisma.assessmentAttempt.findFirst
      .mockResolvedValueOnce(buildAttemptRow())
      .mockResolvedValueOnce(
        buildAttemptRow({
          answers: [
            {
              id: 'answer-1',
              tenantId: 'tenant-1',
              attemptId: 'attempt-1',
              questionId: 'question-1',
              selectedOptionId: 'option-2',
              isCorrect: null,
              pointsAwarded: null,
              createdAt: new Date('2026-03-06T08:16:00.000Z'),
              updatedAt: new Date('2026-03-06T08:16:00.000Z'),
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        buildAttemptRow({
          status: 'IN_PROGRESS',
          answers: [
            {
              id: 'answer-1',
              tenantId: 'tenant-1',
              attemptId: 'attempt-1',
              questionId: 'question-1',
              selectedOptionId: 'option-2',
              isCorrect: null,
              pointsAwarded: null,
              createdAt: new Date('2026-03-06T08:16:00.000Z'),
              updatedAt: new Date('2026-03-06T08:16:00.000Z'),
            },
          ],
        }),
      );
    mockedPrisma.assessmentAnswer.upsert.mockResolvedValue({ id: 'answer-1' });

    const savedAttempt = await service.saveAttemptAnswers(
      'tenant-1',
      'attempt-1',
      {
        answers: [{ questionId: 'question-1', selectedOptionId: 'option-2' }],
      },
      studentActor,
    );

    expect(savedAttempt.questions[0].selectedOptionId).toBe('option-2');

    mockedPrisma.$transaction.mockImplementationOnce(async (callback: any) => {
      const tx = {
        assessmentAnswer: {
          upsert: jest.fn().mockResolvedValue({ id: 'answer-1' }),
        },
        assessment: {
          update: jest.fn().mockResolvedValue({ id: 'assessment-1' }),
        },
        assessmentAttempt: {
          update: jest.fn().mockResolvedValue(
            buildAttemptRow({
              status: 'SUBMITTED',
              submittedAt: new Date('2026-03-06T08:17:00.000Z'),
              autoScore: 5,
              maxScore: 5,
              answers: [
                {
                  id: 'answer-1',
                  tenantId: 'tenant-1',
                  attemptId: 'attempt-1',
                  questionId: 'question-1',
                  selectedOptionId: 'option-2',
                  isCorrect: true,
                  pointsAwarded: 5,
                  createdAt: new Date('2026-03-06T08:16:00.000Z'),
                  updatedAt: new Date('2026-03-06T08:17:00.000Z'),
                },
              ],
            }),
          ),
        },
      };

      return callback(tx);
    });

    const submittedAttempt = await service.submitAttempt(
      'tenant-1',
      'attempt-1',
      studentActor,
      context,
    );

    expect(submittedAttempt.status).toBe('SUBMITTED');
    expect(submittedAttempt.autoScore).toBe(5);
    expect(submittedAttempt.questions[0].isCorrect).toBe(true);

    mockedPrisma.assessmentAttempt.findFirst.mockResolvedValueOnce(
      buildAttemptRow({
        status: 'SUBMITTED',
        submittedAt: new Date('2026-03-06T08:17:00.000Z'),
        autoScore: 5,
        maxScore: 5,
        answers: [
          {
            id: 'answer-1',
            tenantId: 'tenant-1',
            attemptId: 'attempt-1',
            questionId: 'question-1',
            selectedOptionId: 'option-2',
            isCorrect: true,
            pointsAwarded: 5,
            manualPointsAwarded: null,
            createdAt: new Date('2026-03-06T08:16:00.000Z'),
            updatedAt: new Date('2026-03-06T08:17:00.000Z'),
          },
        ],
      }),
    );

    mockedPrisma.$transaction.mockImplementationOnce(async (callback: any) => {
      const tx = {
        assessmentAnswer: {
          upsert: jest.fn().mockResolvedValue({ id: 'answer-1' }),
        },
        assessmentAttempt: {
          update: jest.fn().mockResolvedValue(
            buildAttemptRow({
              status: 'SUBMITTED',
              submittedAt: new Date('2026-03-06T08:17:00.000Z'),
              autoScore: 5,
              manualScore: 3,
              maxScore: 5,
              manualFeedback: 'Teacher override applied.',
              manuallyGradedAt: new Date('2026-03-06T08:20:00.000Z'),
              manuallyGradedByUser: {
                id: 'teacher-1',
                firstName: 'Daily',
                lastName: 'Teacher',
              },
              answers: [
                {
                  id: 'answer-1',
                  tenantId: 'tenant-1',
                  attemptId: 'attempt-1',
                  questionId: 'question-1',
                  selectedOptionId: 'option-2',
                  isCorrect: true,
                  pointsAwarded: 5,
                  manualPointsAwarded: 3,
                  createdAt: new Date('2026-03-06T08:16:00.000Z'),
                  updatedAt: new Date('2026-03-06T08:20:00.000Z'),
                },
              ],
            }),
          ),
        },
      };

      return callback(tx);
    });

    const regradedAttempt = await service.regradeAttempt(
      'tenant-1',
      'attempt-1',
      {
        manualFeedback: 'Teacher override applied.',
        answers: [{ questionId: 'question-1', pointsAwarded: 3 }],
      },
      teacherActor,
      context,
    );

    expect(regradedAttempt.manualScore).toBe(3);
    expect(regradedAttempt.score).toBe(3);
    expect(regradedAttempt.questions[0].manualPointsAwarded).toBe(3);
  });
});
