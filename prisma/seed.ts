import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

import {
  buildDefaultTenantRoles,
  SCHOOL_ADMIN_PERMISSIONS,
  SUPER_ADMIN_PERMISSIONS,
} from '../src/constants/permissions';

const prisma = new PrismaClient();

function schoolDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

async function main() {
  const platformTenant = await prisma.tenant.upsert({
    where: { code: 'platform' },
    update: { name: 'Smart School Platform' },
    create: {
      code: 'platform',
      name: 'Smart School Platform',
      domain: 'platform.smartschool.local',
    },
  });

  const superAdminRole = await prisma.role.upsert({
    where: {
      tenantId_name: {
        tenantId: platformTenant.id,
        name: 'SUPER_ADMIN',
      },
    },
    update: {
      permissions: SUPER_ADMIN_PERMISSIONS,
    },
    create: {
      tenantId: platformTenant.id,
      name: 'SUPER_ADMIN',
      description: 'Platform super administrator role',
      isSystem: true,
      permissions: SUPER_ADMIN_PERMISSIONS,
    },
  });

  const superAdminPasswordHash = await bcrypt.hash('SuperAdmin@12345', 12);

  const superAdminUser = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: platformTenant.id,
        email: 'superadmin@smartschool.rw',
      },
    },
    update: {},
    create: {
      tenantId: platformTenant.id,
      email: 'superadmin@smartschool.rw',
      passwordHash: superAdminPasswordHash,
      firstName: 'Platform',
      lastName: 'Admin',
    },
  });

  await prisma.userRole.upsert({
    where: {
      tenantId_userId_roleId: {
        tenantId: platformTenant.id,
        userId: superAdminUser.id,
        roleId: superAdminRole.id,
      },
    },
    update: {},
    create: {
      tenantId: platformTenant.id,
      userId: superAdminUser.id,
      roleId: superAdminRole.id,
    },
  });

  const schoolTenant = await prisma.tenant.upsert({
    where: { code: 'gs-rwanda' },
    update: {
      name: 'Green School Rwanda',
    },
    create: {
      code: 'gs-rwanda',
      name: 'Green School Rwanda',
      domain: 'green-school-rwanda.local',
    },
  });

  await prisma.school.upsert({
    where: { tenantId: schoolTenant.id },
    update: {
      displayName: 'Green School Rwanda',
      city: 'Kigali',
      district: 'Gasabo',
      country: 'Rwanda',
      timezone: 'Africa/Kigali',
      setupCompletedAt: new Date('2026-03-06T08:00:00.000Z'),
    },
    create: {
      tenantId: schoolTenant.id,
      displayName: 'Green School Rwanda',
      city: 'Kigali',
      district: 'Gasabo',
      country: 'Rwanda',
      timezone: 'Africa/Kigali',
      setupCompletedAt: new Date('2026-03-06T08:00:00.000Z'),
    },
  });

  const schoolAdminRole = await prisma.role.upsert({
    where: {
      tenantId_name: {
        tenantId: schoolTenant.id,
        name: 'SCHOOL_ADMIN',
      },
    },
    update: {
      permissions: SCHOOL_ADMIN_PERMISSIONS,
    },
    create: {
      tenantId: schoolTenant.id,
      name: 'SCHOOL_ADMIN',
      description: 'Default school administrator role',
      isSystem: true,
      permissions: SCHOOL_ADMIN_PERMISSIONS,
    },
  });

  const defaultSchoolRoles = buildDefaultTenantRoles();
  const teacherRoleDefinition = defaultSchoolRoles.find(
    (role) => role.name === 'TEACHER',
  )!;
  const studentRoleDefinition = defaultSchoolRoles.find(
    (role) => role.name === 'STUDENT',
  )!;
  const parentRoleDefinition = defaultSchoolRoles.find(
    (role) => role.name === 'PARENT',
  )!;

  const teacherRole = await prisma.role.upsert({
    where: {
      tenantId_name: {
        tenantId: schoolTenant.id,
        name: 'TEACHER',
      },
    },
    update: {
      permissions: teacherRoleDefinition.permissions,
    },
    create: {
      tenantId: schoolTenant.id,
      name: 'TEACHER',
      description: 'Teacher role',
      isSystem: true,
      permissions: teacherRoleDefinition.permissions,
    },
  });

  const studentRole = await prisma.role.upsert({
    where: {
      tenantId_name: {
        tenantId: schoolTenant.id,
        name: 'STUDENT',
      },
    },
    update: {
      permissions: studentRoleDefinition.permissions,
    },
    create: {
      tenantId: schoolTenant.id,
      name: 'STUDENT',
      description: 'Student portal role',
      isSystem: true,
      permissions: studentRoleDefinition.permissions,
    },
  });

  const parentRole = await prisma.role.upsert({
    where: {
      tenantId_name: {
        tenantId: schoolTenant.id,
        name: 'PARENT',
      },
    },
    update: {
      permissions: parentRoleDefinition.permissions,
    },
    create: {
      tenantId: schoolTenant.id,
      name: 'PARENT',
      description: 'Parent portal role',
      isSystem: true,
      permissions: parentRoleDefinition.permissions,
    },
  });

  const schoolAdminHash = await bcrypt.hash('Admin@12345', 12);
  const teacherHash = await bcrypt.hash('Teacher@12345', 12);
  const studentHash = await bcrypt.hash('Student@12345', 12);
  const parentHash = await bcrypt.hash('Parent@12345', 12);

  const schoolAdminUser = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: schoolTenant.id,
        email: 'admin@school.rw',
      },
    },
    update: {},
    create: {
      tenantId: schoolTenant.id,
      email: 'admin@school.rw',
      passwordHash: schoolAdminHash,
      firstName: 'System',
      lastName: 'Admin',
    },
  });

  const teacherUser = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: schoolTenant.id,
        email: 'teacher@school.rw',
      },
    },
    update: {},
    create: {
      tenantId: schoolTenant.id,
      email: 'teacher@school.rw',
      passwordHash: teacherHash,
      firstName: 'Daily',
      lastName: 'Teacher',
    },
  });

  const studentUser = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: schoolTenant.id,
        email: 'student@school.rw',
      },
    },
    update: {},
    create: {
      tenantId: schoolTenant.id,
      email: 'student@school.rw',
      passwordHash: studentHash,
      firstName: 'Alice',
      lastName: 'Uwase',
    },
  });

  const parentUser = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: schoolTenant.id,
        email: 'parent@school.rw',
      },
    },
    update: {},
    create: {
      tenantId: schoolTenant.id,
      email: 'parent@school.rw',
      passwordHash: parentHash,
      firstName: 'Family',
      lastName: 'Guardian',
    },
  });

  for (const [userId, roleId] of [
    [schoolAdminUser.id, schoolAdminRole.id],
    [teacherUser.id, teacherRole.id],
    [studentUser.id, studentRole.id],
    [parentUser.id, parentRole.id],
  ] as const) {
    await prisma.userRole.upsert({
      where: {
        tenantId_userId_roleId: {
          tenantId: schoolTenant.id,
          userId,
          roleId,
        },
      },
      update: {},
      create: {
        tenantId: schoolTenant.id,
        userId,
        roleId,
      },
    });
  }

  const academicYear = await prisma.academicYear.upsert({
    where: {
      tenantId_name: {
        tenantId: schoolTenant.id,
        name: '2026 Academic Year',
      },
    },
    update: {
      startDate: schoolDate('2026-01-01'),
      endDate: schoolDate('2026-12-31'),
      isCurrent: true,
      isActive: true,
    },
    create: {
      tenantId: schoolTenant.id,
      name: '2026 Academic Year',
      startDate: schoolDate('2026-01-01'),
      endDate: schoolDate('2026-12-31'),
      isCurrent: true,
      isActive: true,
    },
  });

  await prisma.term.upsert({
    where: {
      tenantId_academicYearId_sequence: {
        tenantId: schoolTenant.id,
        academicYearId: academicYear.id,
        sequence: 1,
      },
    },
    update: {
      name: 'Term 1',
      startDate: schoolDate('2026-01-08'),
      endDate: schoolDate('2026-04-12'),
      isActive: true,
    },
    create: {
      tenantId: schoolTenant.id,
      academicYearId: academicYear.id,
      name: 'Term 1',
      sequence: 1,
      startDate: schoolDate('2026-01-08'),
      endDate: schoolDate('2026-04-12'),
      isActive: true,
    },
  });

  const gradeLevel = await prisma.gradeLevel.upsert({
    where: {
      tenantId_code: {
        tenantId: schoolTenant.id,
        code: 'G1',
      },
    },
    update: {
      name: 'Grade 1',
      rank: 1,
      isActive: true,
    },
    create: {
      tenantId: schoolTenant.id,
      code: 'G1',
      name: 'Grade 1',
      rank: 1,
      isActive: true,
    },
  });

  const classRoom = await prisma.classRoom.upsert({
    where: {
      tenantId_code: {
        tenantId: schoolTenant.id,
        code: 'G1-A',
      },
    },
    update: {
      gradeLevelId: gradeLevel.id,
      name: 'Grade 1 A',
      capacity: 35,
      isActive: true,
    },
    create: {
      tenantId: schoolTenant.id,
      gradeLevelId: gradeLevel.id,
      code: 'G1-A',
      name: 'Grade 1 A',
      capacity: 35,
      isActive: true,
    },
  });

  const mathSubject = await prisma.subject.upsert({
    where: {
      tenantId_code: {
        tenantId: schoolTenant.id,
        code: 'MATH',
      },
    },
    update: {
      name: 'Mathematics',
      isCore: true,
      isActive: true,
    },
    create: {
      tenantId: schoolTenant.id,
      code: 'MATH',
      name: 'Mathematics',
      description: 'Core mathematics subject',
      isCore: true,
      isActive: true,
    },
  });

  const parentProfile = await prisma.parent.upsert({
    where: {
      tenantId_email: {
        tenantId: schoolTenant.id,
        email: 'parent@school.rw',
      },
    },
    update: {
      userId: parentUser.id,
      parentCode: 'PAR-001',
      firstName: 'Family',
      lastName: 'Guardian',
      phone: '+250788000001',
      isActive: true,
    },
    create: {
      tenantId: schoolTenant.id,
      userId: parentUser.id,
      parentCode: 'PAR-001',
      firstName: 'Family',
      lastName: 'Guardian',
      email: 'parent@school.rw',
      phone: '+250788000001',
      isActive: true,
    },
  });

  const studentOne = await prisma.student.upsert({
    where: {
      tenantId_studentCode: {
        tenantId: schoolTenant.id,
        studentCode: 'STU-001',
      },
    },
    update: {
      userId: studentUser.id,
      firstName: 'Alice',
      lastName: 'Uwase',
      gender: 'FEMALE',
      isActive: true,
      deletedAt: null,
    },
    create: {
      tenantId: schoolTenant.id,
      userId: studentUser.id,
      studentCode: 'STU-001',
      firstName: 'Alice',
      lastName: 'Uwase',
      gender: 'FEMALE',
      dateOfBirth: schoolDate('2016-05-20'),
      isActive: true,
    },
  });

  const studentTwo = await prisma.student.upsert({
    where: {
      tenantId_studentCode: {
        tenantId: schoolTenant.id,
        studentCode: 'STU-002',
      },
    },
    update: {
      firstName: 'Eric',
      lastName: 'Ndayisaba',
      gender: 'MALE',
      isActive: true,
      deletedAt: null,
    },
    create: {
      tenantId: schoolTenant.id,
      studentCode: 'STU-002',
      firstName: 'Eric',
      lastName: 'Ndayisaba',
      gender: 'MALE',
      dateOfBirth: schoolDate('2016-08-11'),
      isActive: true,
    },
  });

  await prisma.studentEnrollment.upsert({
    where: {
      tenantId_studentId_academicYearId: {
        tenantId: schoolTenant.id,
        studentId: studentOne.id,
        academicYearId: academicYear.id,
      },
    },
    update: {
      classRoomId: classRoom.id,
      isActive: true,
      endedAt: null,
    },
    create: {
      tenantId: schoolTenant.id,
      studentId: studentOne.id,
      academicYearId: academicYear.id,
      classRoomId: classRoom.id,
      enrolledAt: schoolDate('2026-01-08'),
      isActive: true,
    },
  });

  await prisma.studentEnrollment.upsert({
    where: {
      tenantId_studentId_academicYearId: {
        tenantId: schoolTenant.id,
        studentId: studentTwo.id,
        academicYearId: academicYear.id,
      },
    },
    update: {
      classRoomId: classRoom.id,
      isActive: true,
      endedAt: null,
    },
    create: {
      tenantId: schoolTenant.id,
      studentId: studentTwo.id,
      academicYearId: academicYear.id,
      classRoomId: classRoom.id,
      enrolledAt: schoolDate('2026-01-08'),
      isActive: true,
    },
  });

  await prisma.parentStudent.upsert({
    where: {
      tenantId_parentId_studentId: {
        tenantId: schoolTenant.id,
        parentId: parentProfile.id,
        studentId: studentOne.id,
      },
    },
    update: {
      relationship: 'GUARDIAN',
      isPrimary: true,
      deletedAt: null,
    },
    create: {
      tenantId: schoolTenant.id,
      parentId: parentProfile.id,
      studentId: studentOne.id,
      relationship: 'GUARDIAN',
      isPrimary: true,
    },
  });

  await prisma.parentStudent.upsert({
    where: {
      tenantId_parentId_studentId: {
        tenantId: schoolTenant.id,
        parentId: parentProfile.id,
        studentId: studentTwo.id,
      },
    },
    update: {
      relationship: 'GUARDIAN',
      isPrimary: false,
      deletedAt: null,
    },
    create: {
      tenantId: schoolTenant.id,
      parentId: parentProfile.id,
      studentId: studentTwo.id,
      relationship: 'GUARDIAN',
      isPrimary: false,
    },
  });

  const todaySession = await prisma.attendanceSession.upsert({
    where: {
      tenantId_classRoomId_sessionDate: {
        tenantId: schoolTenant.id,
        classRoomId: classRoom.id,
        sessionDate: schoolDate('2026-03-06'),
      },
    },
    update: {
      academicYearId: academicYear.id,
      editedByUserId: teacherUser.id,
      status: 'OPEN',
    },
    create: {
      tenantId: schoolTenant.id,
      classRoomId: classRoom.id,
      academicYearId: academicYear.id,
      sessionDate: schoolDate('2026-03-06'),
      status: 'OPEN',
      createdByUserId: teacherUser.id,
      editedByUserId: teacherUser.id,
    },
  });

  const yesterdaySession = await prisma.attendanceSession.upsert({
    where: {
      tenantId_classRoomId_sessionDate: {
        tenantId: schoolTenant.id,
        classRoomId: classRoom.id,
        sessionDate: schoolDate('2026-03-05'),
      },
    },
    update: {
      academicYearId: academicYear.id,
      editedByUserId: teacherUser.id,
      status: 'OPEN',
    },
    create: {
      tenantId: schoolTenant.id,
      classRoomId: classRoom.id,
      academicYearId: academicYear.id,
      sessionDate: schoolDate('2026-03-05'),
      status: 'OPEN',
      createdByUserId: teacherUser.id,
      editedByUserId: teacherUser.id,
    },
  });

  for (const [sessionId, attendanceDate, studentId, status, remarks] of [
    [todaySession.id, schoolDate('2026-03-06'), studentOne.id, 'PRESENT', null],
    [todaySession.id, schoolDate('2026-03-06'), studentTwo.id, 'ABSENT', 'Family trip'],
    [yesterdaySession.id, schoolDate('2026-03-05'), studentOne.id, 'LATE', 'Traffic delay'],
    [yesterdaySession.id, schoolDate('2026-03-05'), studentTwo.id, 'EXCUSED', 'Clinic visit'],
  ] as const) {
    await prisma.attendanceRecord.upsert({
      where: {
        tenantId_classRoomId_attendanceDate_studentId: {
          tenantId: schoolTenant.id,
          classRoomId: classRoom.id,
          attendanceDate,
          studentId,
        },
      },
      update: {
        sessionId,
        status,
        remarks,
        editedByUserId: teacherUser.id,
      },
      create: {
        tenantId: schoolTenant.id,
        sessionId,
        classRoomId: classRoom.id,
        studentId,
        attendanceDate,
        status,
        remarks,
        markedByUserId: teacherUser.id,
        editedByUserId: teacherUser.id,
      },
    });
  }

  const existingCourse = await prisma.course.findFirst({
    where: {
      tenantId: schoolTenant.id,
      academicYearId: academicYear.id,
      classRoomId: classRoom.id,
      teacherUserId: teacherUser.id,
      title: 'Mathematics Grade 1',
    },
  });

  const course = existingCourse
    ? await prisma.course.update({
        where: { id: existingCourse.id },
        data: {
          subjectId: mathSubject.id,
          description: 'Weekly Grade 1 mathematics lessons and assignments.',
          isActive: true,
        },
      })
    : await prisma.course.create({
        data: {
          tenantId: schoolTenant.id,
          academicYearId: academicYear.id,
          classRoomId: classRoom.id,
          subjectId: mathSubject.id,
          teacherUserId: teacherUser.id,
          title: 'Mathematics Grade 1',
          description: 'Weekly Grade 1 mathematics lessons and assignments.',
          isActive: true,
        },
      });

  const existingLessonOne = await prisma.lesson.findFirst({
    where: {
      tenantId: schoolTenant.id,
      courseId: course.id,
      sequence: 1,
    },
  });

  const lessonOne = await (existingLessonOne
    ? prisma.lesson.update({
        where: { id: existingLessonOne.id },
        data: {
          title: 'Counting up to 20',
          summary: 'Practice counting objects up to twenty.',
          contentType: 'TEXT',
          body: 'Use the lesson notes and examples to count classroom items from 1 to 20.',
          isPublished: true,
          publishedAt: new Date('2026-03-06T08:15:00.000Z'),
          createdByUserId: teacherUser.id,
          publishedByUserId: teacherUser.id,
        },
      })
    : prisma.lesson.create({
        data: {
          tenantId: schoolTenant.id,
          courseId: course.id,
          sequence: 1,
          title: 'Counting up to 20',
          summary: 'Practice counting objects up to twenty.',
          contentType: 'TEXT',
          body: 'Use the lesson notes and examples to count classroom items from 1 to 20.',
          isPublished: true,
          publishedAt: new Date('2026-03-06T08:15:00.000Z'),
          createdByUserId: teacherUser.id,
          publishedByUserId: teacherUser.id,
        },
      }));

  const existingLessonTwo = await prisma.lesson.findFirst({
    where: {
      tenantId: schoolTenant.id,
      courseId: course.id,
      sequence: 2,
    },
  });

  const lessonTwo = existingLessonTwo
    ? await prisma.lesson.update({
        where: { id: existingLessonTwo.id },
        data: {
          title: 'Shapes around us',
          summary: 'Watch a short shape recognition lesson.',
          contentType: 'VIDEO',
          externalUrl: 'https://www.youtube.com/watch?v=OEbRDtCAFdU',
          isPublished: true,
          publishedAt: new Date('2026-03-06T08:30:00.000Z'),
          createdByUserId: teacherUser.id,
          publishedByUserId: teacherUser.id,
        },
      })
    : await prisma.lesson.create({
        data: {
          tenantId: schoolTenant.id,
          courseId: course.id,
          sequence: 2,
          title: 'Shapes around us',
          summary: 'Watch a short shape recognition lesson.',
          contentType: 'VIDEO',
          externalUrl: 'https://www.youtube.com/watch?v=OEbRDtCAFdU',
          isPublished: true,
          publishedAt: new Date('2026-03-06T08:30:00.000Z'),
          createdByUserId: teacherUser.id,
          publishedByUserId: teacherUser.id,
        },
      });

  const existingAssignment = await prisma.assignment.findFirst({
    where: {
      tenantId: schoolTenant.id,
      courseId: course.id,
      title: 'Count the classroom objects',
    },
  });

  const assignment = existingAssignment
    ? await prisma.assignment.update({
        where: { id: existingAssignment.id },
        data: {
          lessonId: lessonTwo.id,
          instructions:
            'Count five objects at home or in class and submit your answers in text or link form.',
          dueAt: new Date('2026-03-15T17:00:00.000Z'),
          maxPoints: 20,
          isPublished: true,
          createdByUserId: teacherUser.id,
        },
      })
    : await prisma.assignment.create({
        data: {
          tenantId: schoolTenant.id,
          courseId: course.id,
          lessonId: lessonTwo.id,
          title: 'Count the classroom objects',
          instructions:
            'Count five objects at home or in class and submit your answers in text or link form.',
          dueAt: new Date('2026-03-15T17:00:00.000Z'),
          maxPoints: 20,
          isPublished: true,
          createdByUserId: teacherUser.id,
        },
      });

  await prisma.submission.upsert({
    where: {
      tenantId_assignmentId_studentId: {
        tenantId: schoolTenant.id,
        assignmentId: assignment.id,
        studentId: studentOne.id,
      },
    },
    update: {
      studentUserId: studentUser.id,
      textAnswer: 'Book, pencil, chair, desk, bag.',
      status: 'GRADED',
      submittedAt: new Date('2026-03-06T10:00:00.000Z'),
      gradedAt: new Date('2026-03-06T11:00:00.000Z'),
      gradePoints: 18,
      feedback: 'Good counting work. Check the spelling for desk.',
      gradedByUserId: teacherUser.id,
    },
    create: {
      tenantId: schoolTenant.id,
      assignmentId: assignment.id,
      studentId: studentOne.id,
      studentUserId: studentUser.id,
      textAnswer: 'Book, pencil, chair, desk, bag.',
      status: 'GRADED',
      submittedAt: new Date('2026-03-06T10:00:00.000Z'),
      gradedAt: new Date('2026-03-06T11:00:00.000Z'),
      gradePoints: 18,
      feedback: 'Good counting work. Check the spelling for desk.',
      gradedByUserId: teacherUser.id,
    },
  });

  const existingAssessment = await prisma.assessment.findFirst({
    where: {
      tenantId: schoolTenant.id,
      courseId: course.id,
      title: 'Counting quick check',
    },
  });

  const demoAssessment = existingAssessment
    ? await prisma.assessment.update({
        where: { id: existingAssessment.id },
        data: {
          lessonId: lessonOne.id,
          instructions: '<p>Choose the best answer for each counting question.</p>',
          dueAt: new Date('2026-03-20T17:00:00.000Z'),
          timeLimitMinutes: 10,
          maxAttempts: 2,
          isPublished: true,
          publishedAt: new Date('2026-03-06T09:00:00.000Z'),
          createdByUserId: teacherUser.id,
          updatedByUserId: teacherUser.id,
        },
      })
    : await prisma.assessment.create({
        data: {
          tenantId: schoolTenant.id,
          courseId: course.id,
          lessonId: lessonOne.id,
          title: 'Counting quick check',
          instructions: '<p>Choose the best answer for each counting question.</p>',
          dueAt: new Date('2026-03-20T17:00:00.000Z'),
          timeLimitMinutes: 10,
          maxAttempts: 2,
          isPublished: true,
          publishedAt: new Date('2026-03-06T09:00:00.000Z'),
          createdByUserId: teacherUser.id,
          updatedByUserId: teacherUser.id,
        },
      });

  const demoQuestionDefinitions = [
    {
      sequence: 1,
      prompt: 'How many apples are there if you count 1, 2, 3?',
      explanation: 'Counting 1, 2, 3 means there are three apples.',
      points: 1,
      options: [
        { sequence: 1, label: '2', isCorrect: false },
        { sequence: 2, label: '3', isCorrect: true },
        { sequence: 3, label: '4', isCorrect: false },
        { sequence: 4, label: '5', isCorrect: false },
      ],
    },
    {
      sequence: 2,
      prompt: 'Which number comes after 4?',
      explanation: 'The next number after 4 is 5.',
      points: 1,
      options: [
        { sequence: 1, label: '3', isCorrect: false },
        { sequence: 2, label: '4', isCorrect: false },
        { sequence: 3, label: '5', isCorrect: true },
        { sequence: 4, label: '6', isCorrect: false },
      ],
    },
  ] as const;

  const seededQuestions: Array<{
    id: string;
    sequence: number;
    options: Array<{ id: string; sequence: number; isCorrect: boolean }>;
  }> = [];

  for (const definition of demoQuestionDefinitions) {
    const existingQuestion = await prisma.assessmentQuestion.findFirst({
      where: {
        tenantId: schoolTenant.id,
        assessmentId: demoAssessment.id,
        sequence: definition.sequence,
      },
    });

    const question = existingQuestion
      ? await prisma.assessmentQuestion.update({
          where: { id: existingQuestion.id },
          data: {
            prompt: definition.prompt,
            explanation: definition.explanation,
            points: definition.points,
          },
        })
      : await prisma.assessmentQuestion.create({
          data: {
            tenantId: schoolTenant.id,
            assessmentId: demoAssessment.id,
            prompt: definition.prompt,
            explanation: definition.explanation,
            type: 'MCQ_SINGLE',
            sequence: definition.sequence,
            points: definition.points,
          },
        });

    for (const option of definition.options) {
      await prisma.assessmentOption.upsert({
        where: {
          tenantId_questionId_sequence: {
            tenantId: schoolTenant.id,
            questionId: question.id,
            sequence: option.sequence,
          },
        },
        update: {
          label: option.label,
          isCorrect: option.isCorrect,
        },
        create: {
          tenantId: schoolTenant.id,
          questionId: question.id,
          label: option.label,
          isCorrect: option.isCorrect,
          sequence: option.sequence,
        },
      });
    }

    const refreshedQuestion = await prisma.assessmentQuestion.findFirst({
      where: {
        id: question.id,
        tenantId: schoolTenant.id,
      },
      include: {
        options: {
          orderBy: {
            sequence: 'asc',
          },
        },
      },
    });

    if (refreshedQuestion) {
      seededQuestions.push({
        id: refreshedQuestion.id,
        sequence: refreshedQuestion.sequence,
        options: refreshedQuestion.options.map((option) => ({
          id: option.id,
          sequence: option.sequence,
          isCorrect: option.isCorrect,
        })),
      });
    }
  }

  const demoAttempt = await prisma.assessmentAttempt.upsert({
    where: {
      tenantId_assessmentId_studentId_attemptNumber: {
        tenantId: schoolTenant.id,
        assessmentId: demoAssessment.id,
        studentId: studentOne.id,
        attemptNumber: 1,
      },
    },
    update: {
      studentUserId: studentUser.id,
      status: 'SUBMITTED',
      startedAt: new Date('2026-03-06T09:10:00.000Z'),
      submittedAt: new Date('2026-03-06T09:14:00.000Z'),
      autoScore: 1,
      maxScore: 2,
      manualScore: null,
      manualFeedback: null,
      manuallyGradedAt: null,
      manuallyGradedByUserId: null,
    },
    create: {
      tenantId: schoolTenant.id,
      assessmentId: demoAssessment.id,
      studentId: studentOne.id,
      studentUserId: studentUser.id,
      attemptNumber: 1,
      status: 'SUBMITTED',
      startedAt: new Date('2026-03-06T09:10:00.000Z'),
      submittedAt: new Date('2026-03-06T09:14:00.000Z'),
      autoScore: 1,
      maxScore: 2,
    },
  });

  for (const question of seededQuestions) {
    const selectedOption =
      question.sequence === 1
        ? question.options.find((option) => option.isCorrect)
        : question.options.find((option) => option.sequence === 2);
    const isCorrect = Boolean(selectedOption?.isCorrect);

    if (!selectedOption) {
      continue;
    }

    await prisma.assessmentAnswer.upsert({
      where: {
        tenantId_attemptId_questionId: {
          tenantId: schoolTenant.id,
          attemptId: demoAttempt.id,
          questionId: question.id,
        },
      },
      update: {
        selectedOptionId: selectedOption.id,
        isCorrect,
        pointsAwarded: isCorrect ? 1 : 0,
        manualPointsAwarded: null,
      },
      create: {
        tenantId: schoolTenant.id,
        attemptId: demoAttempt.id,
        questionId: question.id,
        selectedOptionId: selectedOption.id,
        isCorrect,
        pointsAwarded: isCorrect ? 1 : 0,
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      tenantId: schoolTenant.id,
      actorUserId: schoolAdminUser.id,
      event: 'SEED_COMPLETED',
      entity: 'Tenant',
      entityId: schoolTenant.id,
      payload: {
        createdRoles: [
          schoolAdminRole.name,
          teacherRole.name,
          studentRole.name,
          parentRole.name,
        ],
        sampleLogins: {
          superAdmin: 'superadmin@smartschool.rw / SuperAdmin@12345',
          schoolAdmin: 'admin@school.rw / Admin@12345',
          teacher: 'teacher@school.rw / Teacher@12345',
          student: 'student@school.rw / Student@12345',
          parent: 'parent@school.rw / Parent@12345',
        },
        sampleSchoolCode: 'gs-rwanda',
      },
    },
  });
}

void main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
