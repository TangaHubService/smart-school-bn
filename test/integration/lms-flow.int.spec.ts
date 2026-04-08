jest.mock('../../src/db/prisma', () => {
  const prisma = {
    academicYear: { findFirst: jest.fn() },
    classRoom: { findFirst: jest.fn() },
    subject: { findFirst: jest.fn() },
    user: { findFirst: jest.fn(), findMany: jest.fn() },
    student: { findFirst: jest.fn() },
    programEnrollment: { findMany: jest.fn() },
    studentLessonProgress: { findMany: jest.fn() },
    assessmentAttempt: { findMany: jest.fn() },
    course: {
      create: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    lesson: {
      aggregate: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    assignment: {
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    submission: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  return { prisma };
});

import { prisma } from '../../src/db/prisma';
import { LmsService } from '../../src/modules/lms/lms.service';

const mockedPrisma = prisma as any;

const teacherActor = {
  sub: 'teacher-1',
  tenantId: 'tenant-1',
  email: 'teacher@school.rw',
  roles: ['TEACHER'],
  permissions: [
    'courses.read',
    'courses.manage',
    'lessons.manage',
    'lessons.publish',
    'assignments.manage',
    'submissions.read',
    'submissions.grade',
    'files.upload',
  ],
};

const adminActor = {
  sub: 'admin-1',
  tenantId: 'tenant-1',
  email: 'admin@school.rw',
  roles: ['SCHOOL_ADMIN'],
  permissions: [
    'courses.read',
    'courses.manage',
    'lessons.manage',
    'lessons.publish',
    'assignments.manage',
    'submissions.read',
    'submissions.grade',
    'files.upload',
    'staff.invite',
  ],
};

const studentActor = {
  sub: 'student-user-1',
  tenantId: 'tenant-1',
  email: 'student@school.rw',
  roles: ['STUDENT'],
  permissions: ['students.my_courses.read', 'assignments.submit', 'files.upload'],
};

const context = {
  requestId: 'req-1',
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};

function buildCourseRow() {
  return {
    id: 'course-1',
    title: 'Mathematics Grade 1',
    description: 'Intro course',
    isActive: true,
    createdAt: new Date('2026-03-06T08:00:00.000Z'),
    updatedAt: new Date('2026-03-06T08:00:00.000Z'),
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
    teacherUser: {
      id: 'teacher-1',
      firstName: 'Daily',
      lastName: 'Teacher',
      email: 'teacher@school.rw',
    },
  };
}

describe('lms integration flow', () => {
  const lmsService = new LmsService();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.auditLog.create.mockResolvedValue({ id: 1n });
    mockedPrisma.assessmentAttempt.findMany.mockResolvedValue([]);
  });

  it('course -> lesson publish -> student access', async () => {
    mockedPrisma.academicYear.findFirst.mockResolvedValue({ id: 'year-1' });
    mockedPrisma.classRoom.findFirst.mockResolvedValue({ id: 'class-1' });
    mockedPrisma.subject.findFirst.mockResolvedValue({ id: 'subject-1' });
    mockedPrisma.course.findFirst.mockResolvedValueOnce({ id: 'course-existing-1' });

    mockedPrisma.course.create.mockResolvedValue(buildCourseRow());

    const createdCourse = await lmsService.createCourse(
      'tenant-1',
      {
        academicYearId: 'year-1',
        classRoomId: 'class-1',
        subjectId: 'subject-1',
        title: 'Mathematics Grade 1',
        description: 'Intro course',
      },
      teacherActor,
      context,
    );

    expect(createdCourse.title).toBe('Mathematics Grade 1');

    mockedPrisma.course.findFirst.mockResolvedValue({
      id: 'course-1',
      teacherUserId: 'teacher-1',
    });

    mockedPrisma.$transaction.mockImplementationOnce(async (callback: any) => {
      const tx = {
        lesson: {
          aggregate: jest.fn().mockResolvedValue({
            _max: { sequence: 0 },
          }),
          create: jest.fn().mockResolvedValue({
            id: 'lesson-1',
            title: 'Counting up to 20',
            summary: 'Count classroom items',
            contentType: 'TEXT',
            body: 'Count from one to twenty.',
            externalUrl: null,
            sequence: 1,
            isPublished: false,
            publishedAt: null,
            createdAt: new Date('2026-03-06T08:05:00.000Z'),
            updatedAt: new Date('2026-03-06T08:05:00.000Z'),
            fileAsset: null,
          }),
        },
      };

      return callback(tx);
    });

    const createdLesson = await lmsService.createLesson(
      'tenant-1',
      'course-1',
      {
        title: 'Counting up to 20',
        summary: 'Count classroom items',
        contentType: 'TEXT',
        body: 'Count from one to twenty.',
      },
      teacherActor,
      context,
    );

    expect(createdLesson.isPublished).toBe(false);

    mockedPrisma.lesson.findFirst.mockResolvedValue({
      id: 'lesson-1',
      course: {
        teacherUserId: 'teacher-1',
      },
      fileAsset: null,
    });

    mockedPrisma.lesson.update.mockResolvedValue({
      id: 'lesson-1',
      title: 'Counting up to 20',
      summary: 'Count classroom items',
      contentType: 'TEXT',
      body: 'Count from one to twenty.',
      externalUrl: null,
      sequence: 1,
      isPublished: true,
      publishedAt: new Date('2026-03-06T08:10:00.000Z'),
      createdAt: new Date('2026-03-06T08:05:00.000Z'),
      updatedAt: new Date('2026-03-06T08:10:00.000Z'),
      fileAsset: null,
    });

    const publishedLesson = await lmsService.publishLesson(
      'tenant-1',
      'lesson-1',
      {
        isPublished: true,
      },
      teacherActor,
      context,
    );

    expect(publishedLesson.isPublished).toBe(true);

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

    // Mock program enrollments (empty for this test)
    mockedPrisma.programEnrollment.findMany.mockResolvedValue([]);

    // Mock student lesson progress (empty for this test)
    mockedPrisma.studentLessonProgress.findMany.mockResolvedValue([]);

    mockedPrisma.$transaction.mockResolvedValueOnce([
      1,
      [
        {
          ...buildCourseRow(),
          lessons: [
            {
              id: 'lesson-1',
              title: 'Counting up to 20',
              summary: 'Count classroom items',
              contentType: 'TEXT',
              body: 'Count from one to twenty.',
              externalUrl: null,
              sequence: 1,
              isPublished: true,
              publishedAt: new Date('2026-03-06T08:10:00.000Z'),
              createdAt: new Date('2026-03-06T08:05:00.000Z'),
              updatedAt: new Date('2026-03-06T08:10:00.000Z'),
              fileAsset: null,
            },
          ],
          assignments: [],
        },
      ],
    ]);

    const myCourses = await lmsService.listMyCourses('tenant-1', studentActor, {
      page: 1,
      pageSize: 10,
    });

    expect(myCourses.items).toHaveLength(1);
    expect(myCourses.items[0].lessons).toHaveLength(1);
    expect(myCourses.items[0].lessons[0].isPublished).toBe(true);
  });

  it('teacher cannot create a course without selecting a subject', async () => {
    mockedPrisma.academicYear.findFirst.mockResolvedValue({ id: 'year-1' });
    mockedPrisma.classRoom.findFirst.mockResolvedValue({ id: 'class-1' });

    await expect(
      lmsService.createCourse(
        'tenant-1',
        {
          academicYearId: 'year-1',
          classRoomId: 'class-1',
          title: 'Science Grade 1',
        },
        teacherActor,
        context,
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'COURSE_SUBJECT_REQUIRED',
    });

    expect(mockedPrisma.course.create).not.toHaveBeenCalled();
  });

  it('teacher cannot create a course for a subject not assigned to them', async () => {
    mockedPrisma.academicYear.findFirst.mockResolvedValue({ id: 'year-1' });
    mockedPrisma.classRoom.findFirst.mockResolvedValue({ id: 'class-1' });
    mockedPrisma.subject.findFirst.mockResolvedValue({ id: 'subject-2' });
    mockedPrisma.course.findFirst.mockResolvedValue(null);

    await expect(
      lmsService.createCourse(
        'tenant-1',
        {
          academicYearId: 'year-1',
          classRoomId: 'class-1',
          subjectId: 'subject-2',
          title: 'Science Grade 1',
        },
        teacherActor,
        context,
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'COURSE_SUBJECT_NOT_ASSIGNED',
    });

    expect(mockedPrisma.course.create).not.toHaveBeenCalled();
  });

  it('admin assigns a teacher to a course and teacher list remains scoped to assigned courses', async () => {
    mockedPrisma.course.findFirst.mockResolvedValueOnce({
      id: 'course-1',
      teacherUserId: 'admin-1',
    });
    mockedPrisma.user.findFirst.mockResolvedValue({ id: 'teacher-1' });
    mockedPrisma.course.update.mockResolvedValue(buildCourseRow());

    const updatedCourse = await lmsService.assignCourseTeacher(
      'tenant-1',
      'course-1',
      {
        teacherUserId: 'teacher-1',
      },
      adminActor,
      context,
    );

    expect(updatedCourse.teacher.id).toBe('teacher-1');
    expect(mockedPrisma.course.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          teacherUserId: 'teacher-1',
        }),
      }),
    );

    mockedPrisma.$transaction.mockResolvedValueOnce([
      1,
      [
        {
          ...buildCourseRow(),
          _count: {
            lessons: 0,
            assignments: 0,
          },
        },
      ],
    ]);

    const teacherCourses = await lmsService.listCourses(
      'tenant-1',
      {
        academicYearId: 'year-1',
        classId: 'class-1',
        page: 1,
        pageSize: 12,
      },
      teacherActor,
    );

    expect(mockedPrisma.course.count).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        isActive: true,
        classRoomId: 'class-1',
        academicYearId: 'year-1',
        teacherUserId: 'teacher-1',
      },
    });
    expect(teacherCourses.items).toHaveLength(1);
    expect(teacherCourses.items[0].teacher.id).toBe('teacher-1');
  });

  it('assignment submit -> grade -> student sees feedback', async () => {
    mockedPrisma.course.findFirst.mockResolvedValue({
      id: 'course-1',
      teacherUserId: 'teacher-1',
    });

    mockedPrisma.lesson.findFirst.mockResolvedValue({
      id: 'lesson-1',
    });

    mockedPrisma.$transaction.mockImplementationOnce(async (callback: any) => {
      const tx = {
        assignment: {
          create: jest.fn().mockResolvedValue({
            id: 'assignment-1',
            title: 'Count five objects',
            instructions: 'Submit five counted items.',
            dueAt: new Date('2026-05-15T17:00:00.000Z'),
            maxPoints: 20,
            isPublished: true,
            createdAt: new Date('2026-03-06T09:00:00.000Z'),
            updatedAt: new Date('2026-03-06T09:00:00.000Z'),
            lesson: {
              id: 'lesson-1',
              title: 'Counting up to 20',
            },
            attachmentAsset: null,
            _count: {
              submissions: 0,
            },
          }),
        },
      };

      return callback(tx);
    });

    const assignment = await lmsService.createAssignment(
      'tenant-1',
      {
        courseId: 'course-1',
        lessonId: 'lesson-1',
        title: 'Count five objects',
        instructions: 'Submit five counted items.',
        dueAt: '2026-05-15T17:00:00.000Z',
        maxPoints: 20,
        isPublished: true,
      },
      teacherActor,
      context,
    );

    expect(assignment.title).toBe('Count five objects');

    mockedPrisma.$transaction.mockResolvedValueOnce([
      1,
      [
        {
          id: 'assignment-1',
          title: 'Count five objects',
          instructions: 'Submit five counted items.',
          dueAt: new Date('2026-05-15T17:00:00.000Z'),
          maxPoints: 20,
          isPublished: true,
          createdAt: new Date('2026-03-06T09:00:00.000Z'),
          updatedAt: new Date('2026-03-06T09:00:00.000Z'),
          lesson: {
            id: 'lesson-1',
            title: 'Counting up to 20',
          },
          course: {
            id: 'course-1',
            title: 'Mathematics Grade 1',
            classRoom: { id: 'class-1', code: 'G1-A', name: 'Grade 1 A' },
            academicYear: { id: 'year-1', name: '2026 Academic Year' },
          },
          attachmentAsset: null,
          _count: {
            submissions: 0,
          },
        },
      ],
    ]);

    const listedAssignments = await lmsService.listAssignments(
      'tenant-1',
      {
        page: 1,
        pageSize: 20,
      },
      teacherActor,
    );

    expect(listedAssignments.items).toHaveLength(1);
    expect(listedAssignments.items[0].course?.title).toBe('Mathematics Grade 1');

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

    mockedPrisma.assignment.findFirst.mockResolvedValue({
      id: 'assignment-1',
      dueAt: new Date('2026-05-15T17:00:00.000Z'),
      isPublished: true,
      course: {
        id: 'course-1',
        classRoomId: 'class-1',
        academicYearId: 'year-1',
      },
    });

    mockedPrisma.submission.findUnique.mockResolvedValue(null);

    mockedPrisma.$transaction.mockImplementationOnce(async (callback: any) => {
      const tx = {
        submission: {
          upsert: jest.fn().mockResolvedValue({
            id: 'submission-1',
            textAnswer: 'Book, chair, desk, pen, bag',
            linkUrl: null,
            status: 'SUBMITTED',
            submittedAt: new Date('2026-03-06T10:00:00.000Z'),
            gradedAt: null,
            gradePoints: null,
            feedback: null,
            createdAt: new Date('2026-03-06T10:00:00.000Z'),
            updatedAt: new Date('2026-03-06T10:00:00.000Z'),
            student: {
              id: 'student-1',
              studentCode: 'STU-001',
              firstName: 'Alice',
              lastName: 'Uwase',
            },
            fileAsset: null,
            gradedByUser: null,
          }),
        },
      };

      return callback(tx);
    });

    const submission = await lmsService.submitAssignment(
      'tenant-1',
      'assignment-1',
      {
        textAnswer: 'Book, chair, desk, pen, bag',
      },
      studentActor,
      context,
    );

    expect(submission.status).toBe('SUBMITTED');

    mockedPrisma.submission.findFirst.mockResolvedValue({
      id: 'submission-1',
      assignment: {
        maxPoints: 20,
        course: {
          teacherUserId: 'teacher-1',
        },
      },
      student: {
        id: 'student-1',
        studentCode: 'STU-001',
        firstName: 'Alice',
        lastName: 'Uwase',
      },
      fileAsset: null,
      gradedByUser: null,
    });

    mockedPrisma.submission.update.mockResolvedValue({
      id: 'submission-1',
      textAnswer: 'Book, chair, desk, pen, bag',
      linkUrl: null,
      status: 'GRADED',
      submittedAt: new Date('2026-03-06T10:00:00.000Z'),
      gradedAt: new Date('2026-03-06T11:00:00.000Z'),
      gradePoints: 18,
      feedback: 'Good work.',
      createdAt: new Date('2026-03-06T10:00:00.000Z'),
      updatedAt: new Date('2026-03-06T11:00:00.000Z'),
      student: {
        id: 'student-1',
        studentCode: 'STU-001',
        firstName: 'Alice',
        lastName: 'Uwase',
      },
      fileAsset: null,
      gradedByUser: {
        id: 'teacher-1',
        firstName: 'Daily',
        lastName: 'Teacher',
      },
    });

    const graded = await lmsService.gradeSubmission(
      'tenant-1',
      'submission-1',
      {
        gradePoints: 18,
        feedback: 'Good work.',
      },
      teacherActor,
      context,
    );

    expect(graded.status).toBe('GRADED');
    expect(graded.feedback).toBe('Good work.');

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

    // Mock program enrollments (empty for this test)
    mockedPrisma.programEnrollment.findMany.mockResolvedValue([]);

    // Mock student lesson progress (empty for this test)
    mockedPrisma.studentLessonProgress.findMany.mockResolvedValue([]);

    mockedPrisma.$transaction.mockResolvedValueOnce([
      1,
      [
        {
          ...buildCourseRow(),
          lessons: [],
          assignments: [
            {
              id: 'assignment-1',
              title: 'Count five objects',
              instructions: 'Submit five counted items.',
              dueAt: new Date('2026-05-15T17:00:00.000Z'),
              maxPoints: 20,
              isPublished: true,
              createdAt: new Date('2026-03-06T09:00:00.000Z'),
              updatedAt: new Date('2026-03-06T11:00:00.000Z'),
              lesson: {
                id: 'lesson-1',
                title: 'Counting up to 20',
              },
              attachmentAsset: null,
              submissions: [
                {
                  id: 'submission-1',
                  textAnswer: 'Book, chair, desk, pen, bag',
                  linkUrl: null,
                  status: 'GRADED',
                  submittedAt: new Date('2026-03-06T10:00:00.000Z'),
                  gradedAt: new Date('2026-03-06T11:00:00.000Z'),
                  gradePoints: 18,
                  feedback: 'Good work.',
                  createdAt: new Date('2026-03-06T10:00:00.000Z'),
                  updatedAt: new Date('2026-03-06T11:00:00.000Z'),
                  student: {
                    id: 'student-1',
                    studentCode: 'STU-001',
                    firstName: 'Alice',
                    lastName: 'Uwase',
                  },
                  fileAsset: null,
                  gradedByUser: {
                    id: 'teacher-1',
                    firstName: 'Daily',
                    lastName: 'Teacher',
                  },
                },
              ],
            },
          ],
        },
      ],
    ]);

    const myCourses = await lmsService.listMyCourses('tenant-1', studentActor, {
      page: 1,
      pageSize: 10,
    });

    expect(myCourses.items[0].assignments[0].mySubmission?.feedback).toBe('Good work.');
    expect(myCourses.items[0].assignments[0].mySubmission?.gradePoints).toBe(18);
  });
});
