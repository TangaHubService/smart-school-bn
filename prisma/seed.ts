import { MarkStatus, Prisma, PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

import {
  buildDefaultTenantRoles,
  GOV_AUDITOR_PERMISSIONS,
  SCHOOL_ADMIN_PERMISSIONS,
  SUPER_ADMIN_PERMISSIONS,
} from '../src/constants/permissions';

const prisma = new PrismaClient();

function schoolDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

type SeedGradingBand = {
  min: number;
  max: number;
  grade: string;
  remark: string;
};

function resolveSeedBand(rules: SeedGradingBand[], score: number) {
  return (
    rules.find((rule) => score >= rule.min && score <= rule.max) ?? {
      grade: 'N/A',
      remark: 'No grade',
    }
  );
}

function buildSeedReportCardPayload(params: {
  schoolName: string;
  school: {
    displayName: string;
    code: string;
    registrationNumber: string | null;
    email: string | null;
    phone: string | null;
    district: string | null;
    country: string | null;
  };
  academicYear: { id: string; name: string };
  term: { id: string; name: string };
  classRoom: { id: string; code: string; name: string };
  student: { id: string; studentCode: string; firstName: string; lastName: string };
  gradingScheme: { id: string; name: string; version: number };
  rules: SeedGradingBand[];
  subjects: Array<{
    subjectId: string;
    subjectName: string;
    exams: Array<{
      id: string;
      name: string;
      totalMarks: number;
      weight: number;
      marksObtained: number;
    }>;
  }>;
  classSize: number;
  position: number;
}) {
  const subjects = params.subjects.map((subject) => {
    const subjectWeightTotal =
      subject.exams.reduce((sum, exam) => sum + exam.weight, 0) || 1;
    const averagePercentage =
      subject.exams.reduce(
        (sum, exam) => sum + (exam.marksObtained / exam.totalMarks) * 100 * exam.weight,
        0,
      ) / subjectWeightTotal;
    const subjectBand = resolveSeedBand(params.rules, averagePercentage);

    return {
      subjectId: subject.subjectId,
      subjectName: subject.subjectName,
      averagePercentage: Number(averagePercentage.toFixed(2)),
      grade: subjectBand.grade,
      remark: subjectBand.remark,
      exams: subject.exams.map((exam) => ({
        examId: exam.id,
        name: exam.name,
        marksObtained: exam.marksObtained,
        totalMarks: exam.totalMarks,
        percentage: Number(((exam.marksObtained / exam.totalMarks) * 100).toFixed(2)),
        weight: exam.weight,
      })),
    };
  });

  const totalMarksObtained = params.subjects.reduce(
    (sum, subject) =>
      sum + subject.exams.reduce((examSum, exam) => examSum + exam.marksObtained, 0),
    0,
  );
  const totalMarksPossible = params.subjects.reduce(
    (sum, subject) =>
      sum + subject.exams.reduce((examSum, exam) => examSum + exam.totalMarks, 0),
    0,
  );
  const overallPercentage = subjects.length
    ? subjects.reduce((sum, subject) => sum + subject.averagePercentage, 0) / subjects.length
    : 0;
  const overallBand = resolveSeedBand(params.rules, overallPercentage);

  return {
    schoolName: params.schoolName,
    school: params.school,
    academicYear: params.academicYear,
    term: params.term,
    classRoom: params.classRoom,
    student: params.student,
    gradingScheme: {
      ...params.gradingScheme,
      rules: params.rules,
    },
    metadata: {
      teacherComment:
        overallPercentage >= 70
          ? 'Good progress. Keep practicing every week.'
          : 'Additional revision and follow-up are recommended.',
      classTeacherName: 'Daily Teacher',
      generatedAt: '2026-08-03T09:00:00.000Z',
    },
    subjects,
    totals: {
      totalMarksObtained,
      totalMarksPossible,
      averagePercentage: Number(overallPercentage.toFixed(2)),
      grade: overallBand.grade,
      remark: overallBand.remark,
      position: params.position,
      classSize: params.classSize,
    },
  };
}

type SeedExamType = 'CAT' | 'EXAM';

function buildRwandaStyleReportSnapshotPayload(params: {
  schoolName: string;
  school: {
    displayName: string;
    code: string;
    registrationNumber: string | null;
    email: string | null;
    phone: string | null;
    district: string | null;
    country: string | null;
  };
  academicYear: { id: string; name: string };
  term: { id: string; name: string };
  classRoom: { id: string; code: string; name: string };
  student: { id: string; studentCode: string; firstName: string; lastName: string };
  gradingScheme: { id: string; name: string; version: number };
  rules: SeedGradingBand[];
  passMark: number;
  cw: number;
  ew: number;
  subjects: Array<{
    subjectId: string;
    subjectName: string;
    exams: Array<{
      examId: string;
      name: string;
      examType: SeedExamType;
      marksObtained: number;
      totalMarks: number;
      weight: number;
    }>;
  }>;
  classSize: number;
  position: number;
}) {
  const subjects = params.subjects.map((subject) => {
    const catExams = subject.exams.filter((e) => e.examType === 'CAT');
    const termExams = subject.exams.filter((e) => e.examType === 'EXAM');
    const weighted = (list: typeof subject.exams) => {
      if (!list.length) {
        return 0;
      }
      const wt = list.reduce((s, e) => s + e.weight, 0) || 1;
      return (
        list.reduce((sum, e) => {
          const pct = e.totalMarks > 0 ? (e.marksObtained / e.totalMarks) * 100 : 0;
          return sum + pct * e.weight;
        }, 0) / wt
      );
    };
    const ca = weighted(catExams);
    const te = weighted(termExams);
    let final = 0;
    if (catExams.length && termExams.length) {
      final = (ca * params.cw + te * params.ew) / (params.cw + params.ew);
    } else if (termExams.length) {
      final = te;
    } else if (catExams.length) {
      final = ca;
    }
    const band = resolveSeedBand(params.rules, final);
    const decision = final >= params.passMark ? 'PASS' : 'FAIL';
    return {
      subjectId: subject.subjectId,
      subjectName: subject.subjectName,
      averagePercentage: Number(final.toFixed(2)),
      continuousAssessmentPercent: Number(ca.toFixed(2)),
      examPercent: Number(te.toFixed(2)),
      finalPercent: Number(final.toFixed(2)),
      passMark: params.passMark,
      decision,
      grade: band.grade,
      remark: band.remark,
      exams: subject.exams.map((e) => ({
        examId: e.examId,
        name: e.name,
        examType: e.examType,
        marksObtained: e.marksObtained,
        status: MarkStatus.PRESENT,
        totalMarks: e.totalMarks,
        percentage: Number(((e.marksObtained / e.totalMarks) * 100).toFixed(2)),
        weight: e.weight,
      })),
    };
  });

  const avg = subjects.length ? subjects.reduce((s, x) => s + x.finalPercent, 0) / subjects.length : 0;
  const overallBand = resolveSeedBand(params.rules, avg);
  const totalMarksObtained = subjects.reduce((s, x) => s + x.finalPercent, 0);
  const totalMarksPossible = subjects.length * 100;

  return {
    schoolName: params.schoolName,
    school: params.school,
    academicYear: params.academicYear,
    term: params.term,
    classRoom: params.classRoom,
    student: params.student,
    gradingScheme: {
      ...params.gradingScheme,
      rules: params.rules,
    },
    metadata: {
      teacherComment:
        avg >= 70
          ? 'Good progress across subjects. Continue consistent study habits.'
          : 'Focus on targeted revision and seek support where needed.',
      classTeacherName: 'Senior 2 Class Teacher',
      generatedAt: new Date().toISOString(),
    },
    subjects,
    totals: {
      totalMarksObtained,
      totalMarksPossible,
      averagePercentage: Number(avg.toFixed(2)),
      grade: overallBand.grade,
      remark: overallBand.remark,
      position: params.position,
      classSize: params.classSize,
    },
  };
}

/** Yearly card: Term 1–3 marks (CA / Exam with max), then year summary (avg of term finals + sum of raw / max). */
function buildThreeTermYearlyReportSnapshotPayload(params: {
  schoolName: string;
  school: {
    displayName: string;
    code: string;
    registrationNumber: string | null;
    email: string | null;
    phone: string | null;
    district: string | null;
    country: string | null;
  };
  academicYear: { id: string; name: string };
  term: { id: string; name: string };
  classRoom: { id: string; code: string; name: string };
  student: { id: string; studentCode: string; firstName: string; lastName: string };
  gradingScheme: { id: string; name: string; version: number };
  rules: SeedGradingBand[];
  passMark: number;
  caMax: number;
  examMax: number;
  termPayloads: Array<{
    termName: string;
    subjects: Array<{
      subjectId: string;
      subjectName: string;
      finalPercent: number;
      exams: Array<{
        examType: SeedExamType;
        marksObtained: number;
        totalMarks: number;
      }>;
    }>;
  }>;
  classSize: number;
  position: number;
}) {
  const termCount = params.termPayloads.length;
  const subjects = params.termPayloads[0].subjects.map((_, subjectIndex) => {
    const yearlyTermBreakdown = params.termPayloads.map((tp) => {
      const s = tp.subjects[subjectIndex];
      const cat = s.exams.find((e) => e.examType === 'CAT');
      const ex = s.exams.find((e) => e.examType === 'EXAM');
      return {
        termName: tp.termName,
        caObtained: cat?.marksObtained ?? 0,
        caMax: cat?.totalMarks ?? params.caMax,
        examObtained: ex?.marksObtained ?? 0,
        examMax: ex?.totalMarks ?? params.examMax,
        termFinalPercent: s.finalPercent,
      };
    });
    const finals = yearlyTermBreakdown.map((t) => t.termFinalPercent);
    const yearlyAveragePercent =
      finals.length > 0 ? finals.reduce((a, b) => a + b, 0) / finals.length : 0;
    const totalRawObtained = yearlyTermBreakdown.reduce(
      (sum, t) => sum + t.caObtained + t.examObtained,
      0,
    );
    const totalRawMax = termCount * (params.caMax + params.examMax);
    const yearlyTotalRawPercent =
      totalRawMax > 0 ? (totalRawObtained / totalRawMax) * 100 : 0;
    const band = resolveSeedBand(params.rules, yearlyAveragePercent);
    const decision = yearlyAveragePercent >= params.passMark ? 'PASS' : 'FAIL';
    const yAvg = Number(yearlyAveragePercent.toFixed(2));
    return {
      subjectId: params.termPayloads[0].subjects[subjectIndex].subjectId,
      subjectName: params.termPayloads[0].subjects[subjectIndex].subjectName,
      averagePercentage: yAvg,
      yearlyTermBreakdown,
      yearlyAveragePercent: yAvg,
      yearlyTotalRawObtained: totalRawObtained,
      yearlyTotalRawMax: totalRawMax,
      yearlyTotalRawPercent: Number(yearlyTotalRawPercent.toFixed(2)),
      passMark: params.passMark,
      decision,
      grade: band.grade,
      remark: band.remark,
      exams: [],
    };
  });

  const avg = subjects.length
    ? subjects.reduce((s, x) => s + x.yearlyAveragePercent, 0) / subjects.length
    : 0;
  const overallBand = resolveSeedBand(params.rules, avg);

  return {
    schoolName: params.schoolName,
    school: params.school,
    academicYear: params.academicYear,
    term: params.term,
    classRoom: params.classRoom,
    student: params.student,
    gradingScheme: {
      ...params.gradingScheme,
      rules: params.rules,
    },
    metadata: {
      teacherComment:
        avg >= 70
          ? 'Solid year overall. Year grade = average of term finals; Total/300 = sum of CA+Exam marks across three terms.'
          : 'Year-end review recommended. Compare term averages and raw totals.',
      classTeacherName: 'Senior 2 Class Teacher',
      generatedAt: new Date().toISOString(),
    },
    yearlyReport: {
      layout: 'three_terms' as const,
      caMaxPerTerm: params.caMax,
      examMaxPerTerm: params.examMax,
      yearGradeMethod: 'average_of_term_final_percentages',
      yearRawMethod: 'sum_of_marks_out_of_three_times_ca_plus_exam_max',
    },
    subjects,
    totals: {
      totalMarksObtained: subjects.reduce((s, x) => s + x.yearlyAveragePercent, 0),
      totalMarksPossible: subjects.length * 100,
      averagePercentage: Number(avg.toFixed(2)),
      grade: overallBand.grade,
      remark: overallBand.remark,
      position: params.position,
      classSize: params.classSize,
    },
  };
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

  await prisma.role.upsert({
    where: {
      tenantId_name: {
        tenantId: platformTenant.id,
        name: 'GOV_AUDITOR',
      },
    },
    update: {
      permissions: GOV_AUDITOR_PERMISSIONS,
    },
    create: {
      tenantId: platformTenant.id,
      name: 'GOV_AUDITOR',
      description: 'Government auditor role',
      isSystem: true,
      permissions: GOV_AUDITOR_PERMISSIONS,
    },
  });

  const superAdminPasswordHash = await bcrypt.hash('Kigali2019@2022', 12);
  const platformSuperAdminEmails = [
    'smartschoolrwanda@gmail.com',
    'sibomanadamascene1999@gmail.com',
  ];

  for (const email of platformSuperAdminEmails) {
    const superAdminUser = await prisma.user.upsert({
      where: {
        tenantId_email: {
          tenantId: platformTenant.id,
          email,
        },
      },
      update: {
        passwordHash: superAdminPasswordHash,
        firstName: 'Sibmana',
        lastName: 'Damascene',
      },
      create: {
        tenantId: platformTenant.id,
        email,
        passwordHash: superAdminPasswordHash,
        firstName: 'Sibmana',
        lastName: 'Damascene',
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
  }

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
      registrationNumber: '131011',
      email: 'info@greenschool.rw',
      phone: '+250788123456',
      city: 'Kigali',
      district: 'Gasabo',
      country: 'Rwanda',
      timezone: 'Africa/Kigali',
      setupCompletedAt: new Date('2026-03-06T08:00:00.000Z'),
    },
    create: {
      tenantId: schoolTenant.id,
      displayName: 'Green School Rwanda',
      registrationNumber: '131011',
      email: 'info@greenschool.rw',
      phone: '+250788123456',
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
    update: {
      passwordHash: schoolAdminHash,
      username: 'school_admin',
    },
    create: {
      tenantId: schoolTenant.id,
      email: 'admin@school.rw',
      username: 'school_admin',
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
    update: {
      passwordHash: teacherHash,
      username: 'school_teacher',
    },
    create: {
      tenantId: schoolTenant.id,
      email: 'teacher@school.rw',
      username: 'school_teacher',
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
    update: {
      passwordHash: studentHash,
      username: 'stu_alice',
    },
    create: {
      tenantId: schoolTenant.id,
      email: 'student@school.rw',
      username: 'stu_alice',
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
    update: {
      passwordHash: parentHash,
      username: 'school_parent',
    },
    create: {
      tenantId: schoolTenant.id,
      email: 'parent@school.rw',
      username: 'school_parent',
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

  const termOne = await prisma.term.upsert({
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

  const termTwo = await prisma.term.upsert({
    where: {
      tenantId_academicYearId_sequence: {
        tenantId: schoolTenant.id,
        academicYearId: academicYear.id,
        sequence: 2,
      },
    },
    update: {
      name: 'Term 2',
      startDate: schoolDate('2026-05-04'),
      endDate: schoolDate('2026-08-14'),
      isActive: false,
    },
    create: {
      tenantId: schoolTenant.id,
      academicYearId: academicYear.id,
      name: 'Term 2',
      sequence: 2,
      startDate: schoolDate('2026-05-04'),
      endDate: schoolDate('2026-08-14'),
      isActive: false,
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

  const englishSubject = await prisma.subject.upsert({
    where: {
      tenantId_code: {
        tenantId: schoolTenant.id,
        code: 'ENG',
      },
    },
    update: {
      name: 'English',
      isCore: true,
      isActive: true,
    },
    create: {
      tenantId: schoolTenant.id,
      code: 'ENG',
      name: 'English',
      description: 'Core English language subject',
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

  const gradingRules: SeedGradingBand[] = [
    { min: 85, max: 100, grade: 'A', remark: 'Excellent' },
    { min: 70, max: 84.99, grade: 'B', remark: 'Very Good' },
    { min: 55, max: 69.99, grade: 'C', remark: 'Good' },
    { min: 40, max: 54.99, grade: 'D', remark: 'Needs improvement' },
    { min: 0, max: 39.99, grade: 'F', remark: 'Support required' },
  ];

  const gradingScheme = await prisma.gradingScheme.upsert({
    where: {
      tenantId_name_version: {
        tenantId: schoolTenant.id,
        name: 'Primary Default',
        version: 1,
      },
    },
    update: {
      description: 'Default primary grading scheme for report cards.',
      rules: gradingRules as unknown as Prisma.InputJsonValue,
      isDefault: true,
      isActive: true,
      updatedByUserId: schoolAdminUser.id,
    },
    create: {
      tenantId: schoolTenant.id,
      name: 'Primary Default',
      version: 1,
      description: 'Default primary grading scheme for report cards.',
      rules: gradingRules as unknown as Prisma.InputJsonValue,
      isDefault: true,
      isActive: true,
      createdByUserId: schoolAdminUser.id,
      updatedByUserId: schoolAdminUser.id,
    },
  });

  const demoExams = [
    {
      subjectId: mathSubject.id,
      subjectName: mathSubject.name,
      name: 'Mathematics Midterm',
      description: 'Term 2 mathematics midterm exam.',
      totalMarks: 50,
      weight: 40,
      examDate: new Date('2026-06-10T09:00:00.000Z'),
      marks: [
        { studentId: studentOne.id, marksObtained: 42 },
        { studentId: studentTwo.id, marksObtained: 34 },
      ],
    },
    {
      subjectId: mathSubject.id,
      subjectName: mathSubject.name,
      name: 'Mathematics End Term',
      description: 'Term 2 mathematics end-term exam.',
      totalMarks: 50,
      weight: 60,
      examDate: new Date('2026-07-29T09:00:00.000Z'),
      marks: [
        { studentId: studentOne.id, marksObtained: 45 },
        { studentId: studentTwo.id, marksObtained: 39 },
      ],
    },
    {
      subjectId: englishSubject.id,
      subjectName: englishSubject.name,
      name: 'English Reading Check',
      description: 'Term 2 English reading comprehension assessment.',
      totalMarks: 40,
      weight: 50,
      examDate: new Date('2026-06-17T09:00:00.000Z'),
      marks: [
        { studentId: studentOne.id, marksObtained: 34 },
        { studentId: studentTwo.id, marksObtained: 31 },
      ],
    },
    {
      subjectId: englishSubject.id,
      subjectName: englishSubject.name,
      name: 'English Writing Task',
      description: 'Term 2 English writing task.',
      totalMarks: 60,
      weight: 50,
      examDate: new Date('2026-07-24T09:00:00.000Z'),
      marks: [
        { studentId: studentOne.id, marksObtained: 49 },
        { studentId: studentTwo.id, marksObtained: 38 },
      ],
    },
  ] as const;

  const seededExams: Array<{
    id: string;
    subjectId: string;
    subjectName: string;
    name: string;
    totalMarks: number;
    weight: number;
  }> = [];

  for (const definition of demoExams) {
    const exam = await prisma.exam.upsert({
      where: {
        tenantId_termId_classRoomId_subjectId_name: {
          tenantId: schoolTenant.id,
          termId: termTwo.id,
          classRoomId: classRoom.id,
          subjectId: definition.subjectId,
          name: definition.name,
        },
      },
      update: {
        academicYearId: academicYear.id,
        gradingSchemeId: gradingScheme.id,
        teacherUserId: teacherUser.id,
        description: definition.description,
        totalMarks: definition.totalMarks,
        weight: definition.weight,
        examDate: definition.examDate,
        isActive: true,
        updatedByUserId: teacherUser.id,
      },
      create: {
        tenantId: schoolTenant.id,
        academicYearId: academicYear.id,
        termId: termTwo.id,
        classRoomId: classRoom.id,
        subjectId: definition.subjectId,
        gradingSchemeId: gradingScheme.id,
        teacherUserId: teacherUser.id,
        name: definition.name,
        description: definition.description,
        totalMarks: definition.totalMarks,
        weight: definition.weight,
        examDate: definition.examDate,
        isActive: true,
        createdByUserId: teacherUser.id,
        updatedByUserId: teacherUser.id,
      },
    });

    seededExams.push({
      id: exam.id,
      subjectId: definition.subjectId,
      subjectName: definition.subjectName,
      name: exam.name,
      totalMarks: exam.totalMarks,
      weight: exam.weight,
    });

    for (const mark of definition.marks) {
      await prisma.examMark.upsert({
        where: {
          tenantId_examId_studentId: {
            tenantId: schoolTenant.id,
            examId: exam.id,
            studentId: mark.studentId,
          },
        },
        update: {
          marksObtained: mark.marksObtained,
          updatedByUserId: teacherUser.id,
        },
        create: {
          tenantId: schoolTenant.id,
          examId: exam.id,
          studentId: mark.studentId,
          marksObtained: mark.marksObtained,
          enteredByUserId: teacherUser.id,
          updatedByUserId: teacherUser.id,
        },
      });
    }
  }

  const seededExamMarksByStudentId = new Map<
    string,
    Map<
      string,
      {
        subjectId: string;
        subjectName: string;
        exams: Array<{
          id: string;
          name: string;
          totalMarks: number;
          weight: number;
          marksObtained: number;
        }>;
      }
    >
  >();
  for (const exam of seededExams) {
    const marks = demoExams.find((item) => item.name === exam.name)?.marks ?? [];
    for (const mark of marks) {
      const studentSubjects = seededExamMarksByStudentId.get(mark.studentId) ?? new Map();
      const subjectEntry = studentSubjects.get(exam.subjectId) ?? {
        subjectId: exam.subjectId,
        subjectName: exam.subjectName,
        exams: [],
      };
      subjectEntry.exams.push({
        id: exam.id,
        name: exam.name,
        totalMarks: exam.totalMarks,
        weight: exam.weight,
        marksObtained: mark.marksObtained,
      });
      studentSubjects.set(exam.subjectId, subjectEntry);
      seededExamMarksByStudentId.set(mark.studentId, studentSubjects);
    }
  }

  const baseReportCards = [studentOne, studentTwo].map((student) => ({
    student,
    payload: buildSeedReportCardPayload({
      schoolName: 'Green School Rwanda',
      school: {
        displayName: 'Green School Rwanda',
        code: schoolTenant.code,
        registrationNumber: '131011',
        email: 'info@greenschool.rw',
        phone: '+250788123456',
        district: 'Gasabo',
        country: 'Rwanda',
      },
      academicYear: { id: academicYear.id, name: academicYear.name },
      term: { id: termTwo.id, name: termTwo.name },
      classRoom: { id: classRoom.id, code: classRoom.code, name: classRoom.name },
      student: {
        id: student.id,
        studentCode: student.studentCode,
        firstName: student.firstName,
        lastName: student.lastName,
      },
      gradingScheme: {
        id: gradingScheme.id,
        name: gradingScheme.name,
        version: gradingScheme.version,
      },
      rules: gradingRules,
      subjects: Array.from(seededExamMarksByStudentId.get(student.id)?.values() ?? []),
      classSize: 2,
      position: 0,
    }),
  }));

  const rankedStudents = baseReportCards
    .slice()
    .sort(
      (left, right) =>
        right.payload.totals.averagePercentage - left.payload.totals.averagePercentage,
    );

  const rankingByStudentId = new Map(
    rankedStudents.map((entry, index) => [entry.student.id, index + 1]),
  );

  for (const { student, payload: basePayload } of baseReportCards) {
    const payload = {
      ...basePayload,
      totals: {
        ...basePayload.totals,
        classSize: 2,
        position: rankingByStudentId.get(student.id) ?? 2,
      },
    };

    await prisma.resultSnapshot.upsert({
      where: {
        tenantId_termId_classRoomId_studentId: {
          tenantId: schoolTenant.id,
          termId: termTwo.id,
          classRoomId: classRoom.id,
          studentId: student.id,
        },
      },
      update: {
        academicYearId: academicYear.id,
        gradingSchemeId: gradingScheme.id,
        gradingSchemeVersion: gradingScheme.version,
        status: 'PUBLISHED',
        payload: payload as Prisma.InputJsonValue,
        lockedAt: new Date('2026-08-02T14:00:00.000Z'),
        lockedByUserId: schoolAdminUser.id,
        publishedAt: new Date('2026-08-03T09:00:00.000Z'),
        publishedByUserId: schoolAdminUser.id,
      },
      create: {
        tenantId: schoolTenant.id,
        academicYearId: academicYear.id,
        termId: termTwo.id,
        classRoomId: classRoom.id,
        studentId: student.id,
        gradingSchemeId: gradingScheme.id,
        gradingSchemeVersion: gradingScheme.version,
        status: 'PUBLISHED',
        payload: payload as Prisma.InputJsonValue,
        lockedAt: new Date('2026-08-02T14:00:00.000Z'),
        lockedByUserId: schoolAdminUser.id,
        publishedAt: new Date('2026-08-03T09:00:00.000Z'),
        publishedByUserId: schoolAdminUser.id,
      },
    });
  }

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

  // —— Nyange Secondary School: Senior 2 student (separate tenant) ——
  const nyangeTenant = await prisma.tenant.upsert({
    where: { code: 'nyange-ss' },
    update: { name: 'Nyange Secondary School' },
    create: {
      code: 'nyange-ss',
      name: 'Nyange Secondary School',
      domain: 'nyange-secondary.local',
    },
  });

  await prisma.school.upsert({
    where: { tenantId: nyangeTenant.id },
    update: {
      displayName: 'Nyange Secondary School',
      registrationNumber: 'NYANGE-SS-REG',
      email: 'info@nyange-secondary.rw',
      phone: '+250788000200',
      city: 'Nyange',
      district: 'Ngororero',
      country: 'Rwanda',
      timezone: 'Africa/Kigali',
      setupCompletedAt: new Date('2026-03-06T08:00:00.000Z'),
    },
    create: {
      tenantId: nyangeTenant.id,
      displayName: 'Nyange Secondary School',
      registrationNumber: 'NYANGE-SS-REG',
      email: 'info@nyange-secondary.rw',
      phone: '+250788000200',
      city: 'Nyange',
      district: 'Ngororero',
      country: 'Rwanda',
      timezone: 'Africa/Kigali',
      setupCompletedAt: new Date('2026-03-06T08:00:00.000Z'),
    },
  });

  const nyangeSchoolAdminRole = await prisma.role.upsert({
    where: {
      tenantId_name: { tenantId: nyangeTenant.id, name: 'SCHOOL_ADMIN' },
    },
    update: { permissions: SCHOOL_ADMIN_PERMISSIONS },
    create: {
      tenantId: nyangeTenant.id,
      name: 'SCHOOL_ADMIN',
      description: 'Default school administrator role',
      isSystem: true,
      permissions: SCHOOL_ADMIN_PERMISSIONS,
    },
  });

  const nyangeTeacherRole = await prisma.role.upsert({
    where: {
      tenantId_name: { tenantId: nyangeTenant.id, name: 'TEACHER' },
    },
    update: { permissions: teacherRoleDefinition.permissions },
    create: {
      tenantId: nyangeTenant.id,
      name: 'TEACHER',
      description: 'Teacher role',
      isSystem: true,
      permissions: teacherRoleDefinition.permissions,
    },
  });

  const nyangeStudentRole = await prisma.role.upsert({
    where: {
      tenantId_name: { tenantId: nyangeTenant.id, name: 'STUDENT' },
    },
    update: { permissions: studentRoleDefinition.permissions },
    create: {
      tenantId: nyangeTenant.id,
      name: 'STUDENT',
      description: 'Student portal role',
      isSystem: true,
      permissions: studentRoleDefinition.permissions,
    },
  });

  await prisma.role.upsert({
    where: {
      tenantId_name: { tenantId: nyangeTenant.id, name: 'PARENT' },
    },
    update: { permissions: parentRoleDefinition.permissions },
    create: {
      tenantId: nyangeTenant.id,
      name: 'PARENT',
      description: 'Parent portal role',
      isSystem: true,
      permissions: parentRoleDefinition.permissions,
    },
  });

  const nyangeAdminUser = await prisma.user.upsert({
    where: {
      tenantId_email: { tenantId: nyangeTenant.id, email: 'admin@nyange-secondary.rw' },
    },
    update: {
      passwordHash: schoolAdminHash,
      username: 'nyange_admin',
    },
    create: {
      tenantId: nyangeTenant.id,
      email: 'admin@nyange-secondary.rw',
      username: 'nyange_admin',
      passwordHash: schoolAdminHash,
      firstName: 'School',
      lastName: 'Administrator',
    },
  });

  const nyangeTeacherUser = await prisma.user.upsert({
    where: {
      tenantId_email: { tenantId: nyangeTenant.id, email: 'teacher@nyange-secondary.rw' },
    },
    update: {
      passwordHash: teacherHash,
      username: 'nyange_teacher',
    },
    create: {
      tenantId: nyangeTenant.id,
      email: 'teacher@nyange-secondary.rw',
      username: 'nyange_teacher',
      passwordHash: teacherHash,
      firstName: 'Marie',
      lastName: 'Nyiraneza',
    },
  });

  const nyangeStudentUser = await prisma.user.upsert({
    where: {
      tenantId_email: { tenantId: nyangeTenant.id, email: 'student.s2@nyange-secondary.rw' },
    },
    update: {
      passwordHash: studentHash,
      username: 'nya_s2_001',
    },
    create: {
      tenantId: nyangeTenant.id,
      email: 'student.s2@nyange-secondary.rw',
      username: 'nya_s2_001',
      passwordHash: studentHash,
      firstName: 'Claudine',
      lastName: 'Uwitonze',
    },
  });

  for (const [userId, roleId] of [
    [nyangeAdminUser.id, nyangeSchoolAdminRole.id],
    [nyangeTeacherUser.id, nyangeTeacherRole.id],
    [nyangeStudentUser.id, nyangeStudentRole.id],
  ] as const) {
    await prisma.userRole.upsert({
      where: {
        tenantId_userId_roleId: {
          tenantId: nyangeTenant.id,
          userId,
          roleId,
        },
      },
      update: {},
      create: {
        tenantId: nyangeTenant.id,
        userId,
        roleId,
      },
    });
  }

  const nyangeAcademicYear = await prisma.academicYear.upsert({
    where: {
      tenantId_name: {
        tenantId: nyangeTenant.id,
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
      tenantId: nyangeTenant.id,
      name: '2026 Academic Year',
      startDate: schoolDate('2026-01-01'),
      endDate: schoolDate('2026-12-31'),
      isCurrent: true,
      isActive: true,
    },
  });

  const nyangeTermOne = await prisma.term.upsert({
    where: {
      tenantId_academicYearId_sequence: {
        tenantId: nyangeTenant.id,
        academicYearId: nyangeAcademicYear.id,
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
      tenantId: nyangeTenant.id,
      academicYearId: nyangeAcademicYear.id,
      name: 'Term 1',
      sequence: 1,
      startDate: schoolDate('2026-01-08'),
      endDate: schoolDate('2026-04-12'),
      isActive: true,
    },
  });

  const nyangeTermTwo = await prisma.term.upsert({
    where: {
      tenantId_academicYearId_sequence: {
        tenantId: nyangeTenant.id,
        academicYearId: nyangeAcademicYear.id,
        sequence: 2,
      },
    },
    update: {
      name: 'Term 2',
      startDate: schoolDate('2026-05-04'),
      endDate: schoolDate('2026-08-14'),
      isActive: true,
    },
    create: {
      tenantId: nyangeTenant.id,
      academicYearId: nyangeAcademicYear.id,
      name: 'Term 2',
      sequence: 2,
      startDate: schoolDate('2026-05-04'),
      endDate: schoolDate('2026-08-14'),
      isActive: true,
    },
  });

  const nyangeTermThree = await prisma.term.upsert({
    where: {
      tenantId_academicYearId_sequence: {
        tenantId: nyangeTenant.id,
        academicYearId: nyangeAcademicYear.id,
        sequence: 3,
      },
    },
    update: {
      name: 'Term 3',
      startDate: schoolDate('2026-09-01'),
      endDate: schoolDate('2026-12-15'),
      isActive: true,
    },
    create: {
      tenantId: nyangeTenant.id,
      academicYearId: nyangeAcademicYear.id,
      name: 'Term 3',
      sequence: 3,
      startDate: schoolDate('2026-09-01'),
      endDate: schoolDate('2026-12-15'),
      isActive: true,
    },
  });

  const nyangeTermYearly = await prisma.term.upsert({
    where: {
      tenantId_academicYearId_sequence: {
        tenantId: nyangeTenant.id,
        academicYearId: nyangeAcademicYear.id,
        sequence: 4,
      },
    },
    update: {
      name: 'Yearly',
      startDate: schoolDate('2026-01-08'),
      endDate: schoolDate('2026-12-31'),
      isActive: true,
    },
    create: {
      tenantId: nyangeTenant.id,
      academicYearId: nyangeAcademicYear.id,
      name: 'Yearly',
      sequence: 4,
      startDate: schoolDate('2026-01-08'),
      endDate: schoolDate('2026-12-31'),
      isActive: true,
    },
  });

  const nyangeSeniorTwoLevel = await prisma.gradeLevel.upsert({
    where: {
      tenantId_code: {
        tenantId: nyangeTenant.id,
        code: 'S2',
      },
    },
    update: {
      name: 'Senior 2',
      rank: 12,
      isActive: true,
    },
    create: {
      tenantId: nyangeTenant.id,
      code: 'S2',
      name: 'Senior 2',
      rank: 12,
      isActive: true,
    },
  });

  const nyangeSeniorTwoClass = await prisma.classRoom.upsert({
    where: {
      tenantId_code: {
        tenantId: nyangeTenant.id,
        code: 'S2-A',
      },
    },
    update: {
      gradeLevelId: nyangeSeniorTwoLevel.id,
      name: 'Senior 2 A',
      capacity: 40,
      isActive: true,
    },
    create: {
      tenantId: nyangeTenant.id,
      gradeLevelId: nyangeSeniorTwoLevel.id,
      code: 'S2-A',
      name: 'Senior 2 A',
      capacity: 40,
      isActive: true,
    },
  });

  const nyangeStudent = await prisma.student.upsert({
    where: {
      tenantId_studentCode: {
        tenantId: nyangeTenant.id,
        studentCode: 'NYA-S2-001',
      },
    },
    update: {
      userId: nyangeStudentUser.id,
      firstName: 'Claudine',
      lastName: 'Uwitonze',
      gender: 'FEMALE',
      isActive: true,
      deletedAt: null,
    },
    create: {
      tenantId: nyangeTenant.id,
      userId: nyangeStudentUser.id,
      studentCode: 'NYA-S2-001',
      firstName: 'Claudine',
      lastName: 'Uwitonze',
      gender: 'FEMALE',
      dateOfBirth: schoolDate('2008-04-12'),
      isActive: true,
    },
  });

  await prisma.studentEnrollment.upsert({
    where: {
      tenantId_studentId_academicYearId: {
        tenantId: nyangeTenant.id,
        studentId: nyangeStudent.id,
        academicYearId: nyangeAcademicYear.id,
      },
    },
    update: {
      classRoomId: nyangeSeniorTwoClass.id,
      isActive: true,
      endedAt: null,
    },
    create: {
      tenantId: nyangeTenant.id,
      studentId: nyangeStudent.id,
      academicYearId: nyangeAcademicYear.id,
      classRoomId: nyangeSeniorTwoClass.id,
      enrolledAt: schoolDate('2026-01-08'),
      isActive: true,
    },
  });

  const nyangeGradingRules: SeedGradingBand[] = [
    { min: 85, max: 100, grade: 'A', remark: 'Excellent' },
    { min: 70, max: 84.99, grade: 'B', remark: 'Very Good' },
    { min: 55, max: 69.99, grade: 'C', remark: 'Good' },
    { min: 40, max: 54.99, grade: 'D', remark: 'Needs improvement' },
    { min: 0, max: 39.99, grade: 'F', remark: 'Support required' },
  ];

  const nyangeGradingScheme = await prisma.gradingScheme.upsert({
    where: {
      tenantId_name_version: {
        tenantId: nyangeTenant.id,
        name: 'Senior 2 Default',
        version: 1,
      },
    },
    update: {
      description: 'Default grading for Nyange Secondary School report cards.',
      rules: nyangeGradingRules as unknown as Prisma.InputJsonValue,
      isDefault: true,
      isActive: true,
      updatedByUserId: nyangeAdminUser.id,
    },
    create: {
      tenantId: nyangeTenant.id,
      name: 'Senior 2 Default',
      version: 1,
      description: 'Default grading for Nyange Secondary School report cards.',
      rules: nyangeGradingRules as unknown as Prisma.InputJsonValue,
      isDefault: true,
      isActive: true,
      createdByUserId: nyangeAdminUser.id,
      updatedByUserId: nyangeAdminUser.id,
    },
  });

  const nyangeSubjectSpecs = [
    { code: 'MATH', name: 'Mathematics', description: 'Core mathematics' },
    { code: 'ENG', name: 'English', description: 'English language' },
    { code: 'KIN', name: 'Kinyarwanda', description: 'Kinyarwanda language' },
    { code: 'PHY', name: 'Physics', description: 'Physics' },
    { code: 'CHEM', name: 'Chemistry', description: 'Chemistry' },
    { code: 'BIO', name: 'Biology', description: 'Biology' },
    { code: 'HIST', name: 'History', description: 'History' },
    { code: 'GEO', name: 'Geography', description: 'Geography' },
  ] as const;

  const nyangeSubjects: Array<{ id: string; name: string }> = [];
  for (const spec of nyangeSubjectSpecs) {
    const sub = await prisma.subject.upsert({
      where: {
        tenantId_code: {
          tenantId: nyangeTenant.id,
          code: spec.code,
        },
      },
      update: {
        name: spec.name,
        description: spec.description,
        isCore: true,
        isActive: true,
      },
      create: {
        tenantId: nyangeTenant.id,
        code: spec.code,
        name: spec.name,
        description: spec.description,
        isCore: true,
        isActive: true,
      },
    });
    nyangeSubjects.push({ id: sub.id, name: sub.name });
  }

  for (const term of [nyangeTermOne, nyangeTermTwo, nyangeTermThree]) {
    for (const sub of nyangeSubjects) {
      await prisma.subjectAssessmentPolicy.upsert({
        where: {
          tenantId_termId_classRoomId_subjectId: {
            tenantId: nyangeTenant.id,
            termId: term.id,
            classRoomId: nyangeSeniorTwoClass.id,
            subjectId: sub.id,
          },
        },
        update: {
          continuousWeight: 40,
          examWeight: 60,
          passMark: 50,
          updatedByUserId: nyangeAdminUser.id,
        },
        create: {
          tenantId: nyangeTenant.id,
          academicYearId: nyangeAcademicYear.id,
          termId: term.id,
          classRoomId: nyangeSeniorTwoClass.id,
          subjectId: sub.id,
          continuousWeight: 40,
          examWeight: 60,
          passMark: 50,
          createdByUserId: nyangeAdminUser.id,
          updatedByUserId: nyangeAdminUser.id,
        },
      });
    }
  }

  type NyangeSubjectExams = {
    subjectId: string;
    subjectName: string;
    exams: Array<{
      examId: string;
      name: string;
      examType: SeedExamType;
      marksObtained: number;
      totalMarks: number;
      weight: number;
    }>;
  };

  /** CA and exam paper caps (shown on report as /30 and /70). */
  const NYANGE_CA_MAX = 30;
  const NYANGE_EXAM_MAX = 70;

  const t1SubjectsForReport: NyangeSubjectExams[] = [];
  const t2SubjectsForReport: NyangeSubjectExams[] = [];
  const t3SubjectsForReport: NyangeSubjectExams[] = [];

  for (let index = 0; index < nyangeSubjects.length; index += 1) {
    const sub = nyangeSubjects[index];
    const t1Ca = Math.min(NYANGE_CA_MAX, 20 + (index % 9));
    const t1Ex = Math.min(NYANGE_EXAM_MAX, 48 + (index % 18));
    const t2Ca = Math.min(NYANGE_CA_MAX, 22 + (index % 8));
    const t2Ex = Math.min(NYANGE_EXAM_MAX, 52 + (index % 15));
    const t3Ca = Math.min(NYANGE_CA_MAX, 24 + (index % 7));
    const t3Ex = Math.min(NYANGE_EXAM_MAX, 55 + (index % 14));

    const catExamT1 = await prisma.exam.upsert({
      where: {
        tenantId_termId_classRoomId_subjectId_name: {
          tenantId: nyangeTenant.id,
          termId: nyangeTermOne.id,
          classRoomId: nyangeSeniorTwoClass.id,
          subjectId: sub.id,
          name: 'Continuous Assessment',
        },
      },
      update: {
        academicYearId: nyangeAcademicYear.id,
        gradingSchemeId: nyangeGradingScheme.id,
        teacherUserId: nyangeTeacherUser.id,
        examType: 'CAT',
        totalMarks: NYANGE_CA_MAX,
        weight: 40,
        isActive: true,
        updatedByUserId: nyangeTeacherUser.id,
      },
      create: {
        tenantId: nyangeTenant.id,
        academicYearId: nyangeAcademicYear.id,
        termId: nyangeTermOne.id,
        classRoomId: nyangeSeniorTwoClass.id,
        subjectId: sub.id,
        gradingSchemeId: nyangeGradingScheme.id,
        teacherUserId: nyangeTeacherUser.id,
        examType: 'CAT',
        name: 'Continuous Assessment',
        totalMarks: NYANGE_CA_MAX,
        weight: 40,
        isActive: true,
        createdByUserId: nyangeTeacherUser.id,
        updatedByUserId: nyangeTeacherUser.id,
      },
    });

    const examExamT1 = await prisma.exam.upsert({
      where: {
        tenantId_termId_classRoomId_subjectId_name: {
          tenantId: nyangeTenant.id,
          termId: nyangeTermOne.id,
          classRoomId: nyangeSeniorTwoClass.id,
          subjectId: sub.id,
          name: 'Term exam',
        },
      },
      update: {
        academicYearId: nyangeAcademicYear.id,
        gradingSchemeId: nyangeGradingScheme.id,
        teacherUserId: nyangeTeacherUser.id,
        examType: 'EXAM',
        totalMarks: NYANGE_EXAM_MAX,
        weight: 60,
        isActive: true,
        updatedByUserId: nyangeTeacherUser.id,
      },
      create: {
        tenantId: nyangeTenant.id,
        academicYearId: nyangeAcademicYear.id,
        termId: nyangeTermOne.id,
        classRoomId: nyangeSeniorTwoClass.id,
        subjectId: sub.id,
        gradingSchemeId: nyangeGradingScheme.id,
        teacherUserId: nyangeTeacherUser.id,
        examType: 'EXAM',
        name: 'Term exam',
        totalMarks: NYANGE_EXAM_MAX,
        weight: 60,
        isActive: true,
        createdByUserId: nyangeTeacherUser.id,
        updatedByUserId: nyangeTeacherUser.id,
      },
    });

    const catExamT2 = await prisma.exam.upsert({
      where: {
        tenantId_termId_classRoomId_subjectId_name: {
          tenantId: nyangeTenant.id,
          termId: nyangeTermTwo.id,
          classRoomId: nyangeSeniorTwoClass.id,
          subjectId: sub.id,
          name: 'Continuous Assessment',
        },
      },
      update: {
        academicYearId: nyangeAcademicYear.id,
        gradingSchemeId: nyangeGradingScheme.id,
        teacherUserId: nyangeTeacherUser.id,
        examType: 'CAT',
        totalMarks: NYANGE_CA_MAX,
        weight: 40,
        isActive: true,
        updatedByUserId: nyangeTeacherUser.id,
      },
      create: {
        tenantId: nyangeTenant.id,
        academicYearId: nyangeAcademicYear.id,
        termId: nyangeTermTwo.id,
        classRoomId: nyangeSeniorTwoClass.id,
        subjectId: sub.id,
        gradingSchemeId: nyangeGradingScheme.id,
        teacherUserId: nyangeTeacherUser.id,
        examType: 'CAT',
        name: 'Continuous Assessment',
        totalMarks: NYANGE_CA_MAX,
        weight: 40,
        isActive: true,
        createdByUserId: nyangeTeacherUser.id,
        updatedByUserId: nyangeTeacherUser.id,
      },
    });

    const examExamT2 = await prisma.exam.upsert({
      where: {
        tenantId_termId_classRoomId_subjectId_name: {
          tenantId: nyangeTenant.id,
          termId: nyangeTermTwo.id,
          classRoomId: nyangeSeniorTwoClass.id,
          subjectId: sub.id,
          name: 'Term exam',
        },
      },
      update: {
        academicYearId: nyangeAcademicYear.id,
        gradingSchemeId: nyangeGradingScheme.id,
        teacherUserId: nyangeTeacherUser.id,
        examType: 'EXAM',
        totalMarks: NYANGE_EXAM_MAX,
        weight: 60,
        isActive: true,
        updatedByUserId: nyangeTeacherUser.id,
      },
      create: {
        tenantId: nyangeTenant.id,
        academicYearId: nyangeAcademicYear.id,
        termId: nyangeTermTwo.id,
        classRoomId: nyangeSeniorTwoClass.id,
        subjectId: sub.id,
        gradingSchemeId: nyangeGradingScheme.id,
        teacherUserId: nyangeTeacherUser.id,
        examType: 'EXAM',
        name: 'Term exam',
        totalMarks: NYANGE_EXAM_MAX,
        weight: 60,
        isActive: true,
        createdByUserId: nyangeTeacherUser.id,
        updatedByUserId: nyangeTeacherUser.id,
      },
    });

    const catExamT3 = await prisma.exam.upsert({
      where: {
        tenantId_termId_classRoomId_subjectId_name: {
          tenantId: nyangeTenant.id,
          termId: nyangeTermThree.id,
          classRoomId: nyangeSeniorTwoClass.id,
          subjectId: sub.id,
          name: 'Continuous Assessment',
        },
      },
      update: {
        academicYearId: nyangeAcademicYear.id,
        gradingSchemeId: nyangeGradingScheme.id,
        teacherUserId: nyangeTeacherUser.id,
        examType: 'CAT',
        totalMarks: NYANGE_CA_MAX,
        weight: 40,
        isActive: true,
        updatedByUserId: nyangeTeacherUser.id,
      },
      create: {
        tenantId: nyangeTenant.id,
        academicYearId: nyangeAcademicYear.id,
        termId: nyangeTermThree.id,
        classRoomId: nyangeSeniorTwoClass.id,
        subjectId: sub.id,
        gradingSchemeId: nyangeGradingScheme.id,
        teacherUserId: nyangeTeacherUser.id,
        examType: 'CAT',
        name: 'Continuous Assessment',
        totalMarks: NYANGE_CA_MAX,
        weight: 40,
        isActive: true,
        createdByUserId: nyangeTeacherUser.id,
        updatedByUserId: nyangeTeacherUser.id,
      },
    });

    const examExamT3 = await prisma.exam.upsert({
      where: {
        tenantId_termId_classRoomId_subjectId_name: {
          tenantId: nyangeTenant.id,
          termId: nyangeTermThree.id,
          classRoomId: nyangeSeniorTwoClass.id,
          subjectId: sub.id,
          name: 'Term exam',
        },
      },
      update: {
        academicYearId: nyangeAcademicYear.id,
        gradingSchemeId: nyangeGradingScheme.id,
        teacherUserId: nyangeTeacherUser.id,
        examType: 'EXAM',
        totalMarks: NYANGE_EXAM_MAX,
        weight: 60,
        isActive: true,
        updatedByUserId: nyangeTeacherUser.id,
      },
      create: {
        tenantId: nyangeTenant.id,
        academicYearId: nyangeAcademicYear.id,
        termId: nyangeTermThree.id,
        classRoomId: nyangeSeniorTwoClass.id,
        subjectId: sub.id,
        gradingSchemeId: nyangeGradingScheme.id,
        teacherUserId: nyangeTeacherUser.id,
        examType: 'EXAM',
        name: 'Term exam',
        totalMarks: NYANGE_EXAM_MAX,
        weight: 60,
        isActive: true,
        createdByUserId: nyangeTeacherUser.id,
        updatedByUserId: nyangeTeacherUser.id,
      },
    });

    for (const [examRow, marks] of [
      [catExamT1, t1Ca],
      [examExamT1, t1Ex],
      [catExamT2, t2Ca],
      [examExamT2, t2Ex],
      [catExamT3, t3Ca],
      [examExamT3, t3Ex],
    ] as const) {
      await prisma.examMark.upsert({
        where: {
          tenantId_examId_studentId: {
            tenantId: nyangeTenant.id,
            examId: examRow.id,
            studentId: nyangeStudent.id,
          },
        },
        update: {
          marksObtained: marks,
          status: MarkStatus.PRESENT,
          updatedByUserId: nyangeTeacherUser.id,
        },
        create: {
          tenantId: nyangeTenant.id,
          examId: examRow.id,
          studentId: nyangeStudent.id,
          marksObtained: marks,
          status: MarkStatus.PRESENT,
          enteredByUserId: nyangeTeacherUser.id,
          updatedByUserId: nyangeTeacherUser.id,
        },
      });
    }

    t1SubjectsForReport.push({
      subjectId: sub.id,
      subjectName: sub.name,
      exams: [
        {
          examId: catExamT1.id,
          name: 'Continuous Assessment',
          examType: 'CAT',
          marksObtained: t1Ca,
          totalMarks: NYANGE_CA_MAX,
          weight: 40,
        },
        {
          examId: examExamT1.id,
          name: 'Term exam',
          examType: 'EXAM',
          marksObtained: t1Ex,
          totalMarks: NYANGE_EXAM_MAX,
          weight: 60,
        },
      ],
    });

    t2SubjectsForReport.push({
      subjectId: sub.id,
      subjectName: sub.name,
      exams: [
        {
          examId: catExamT2.id,
          name: 'Continuous Assessment',
          examType: 'CAT',
          marksObtained: t2Ca,
          totalMarks: NYANGE_CA_MAX,
          weight: 40,
        },
        {
          examId: examExamT2.id,
          name: 'Term exam',
          examType: 'EXAM',
          marksObtained: t2Ex,
          totalMarks: NYANGE_EXAM_MAX,
          weight: 60,
        },
      ],
    });

    t3SubjectsForReport.push({
      subjectId: sub.id,
      subjectName: sub.name,
      exams: [
        {
          examId: catExamT3.id,
          name: 'Continuous Assessment',
          examType: 'CAT',
          marksObtained: t3Ca,
          totalMarks: NYANGE_CA_MAX,
          weight: 40,
        },
        {
          examId: examExamT3.id,
          name: 'Term exam',
          examType: 'EXAM',
          marksObtained: t3Ex,
          totalMarks: NYANGE_EXAM_MAX,
          weight: 60,
        },
      ],
    });
  }

  const nyangeSchoolPayload = {
    displayName: 'Nyange Secondary School',
    code: nyangeTenant.code,
    registrationNumber: 'NYANGE-SS-REG',
    email: 'info@nyange-secondary.rw',
    phone: '+250788000200',
    district: 'Ngororero',
    country: 'Rwanda',
  };

  const nyangeStudentPayload = {
    id: nyangeStudent.id,
    studentCode: 'NYA-S2-001',
    firstName: 'Claudine',
    lastName: 'Uwitonze',
  };

  const nyangeReportBase = {
    schoolName: 'Nyange Secondary School',
    school: nyangeSchoolPayload,
    academicYear: { id: nyangeAcademicYear.id, name: nyangeAcademicYear.name },
    classRoom: {
      id: nyangeSeniorTwoClass.id,
      code: nyangeSeniorTwoClass.code,
      name: nyangeSeniorTwoClass.name,
    },
    student: nyangeStudentPayload,
    gradingScheme: {
      id: nyangeGradingScheme.id,
      name: nyangeGradingScheme.name,
      version: nyangeGradingScheme.version,
    },
    rules: nyangeGradingRules,
    passMark: 50,
    cw: 40,
    ew: 60,
    classSize: 1,
    position: 1,
  };

  const termOneReportPayload = buildRwandaStyleReportSnapshotPayload({
    ...nyangeReportBase,
    term: { id: nyangeTermOne.id, name: nyangeTermOne.name },
    subjects: t1SubjectsForReport,
  });

  const termTwoReportPayload = buildRwandaStyleReportSnapshotPayload({
    ...nyangeReportBase,
    term: { id: nyangeTermTwo.id, name: nyangeTermTwo.name },
    subjects: t2SubjectsForReport,
  });

  const termThreeReportPayload = buildRwandaStyleReportSnapshotPayload({
    ...nyangeReportBase,
    term: { id: nyangeTermThree.id, name: nyangeTermThree.name },
    subjects: t3SubjectsForReport,
  });

  const mapSubjectForYearly = (
    s: (typeof termOneReportPayload)['subjects'][number],
  ): {
    subjectId: string;
    subjectName: string;
    finalPercent: number;
    exams: Array<{ examType: SeedExamType; marksObtained: number; totalMarks: number }>;
  } => ({
    subjectId: s.subjectId ?? '',
    subjectName: s.subjectName,
    finalPercent: s.finalPercent,
    exams: s.exams.map((e) => ({
      examType: e.examType as SeedExamType,
      marksObtained: e.marksObtained ?? 0,
      totalMarks: e.totalMarks,
    })),
  });

  const yearlyReportPayload = buildThreeTermYearlyReportSnapshotPayload({
    schoolName: 'Nyange Secondary School',
    school: nyangeSchoolPayload,
    academicYear: { id: nyangeAcademicYear.id, name: nyangeAcademicYear.name },
    term: { id: nyangeTermYearly.id, name: nyangeTermYearly.name },
    classRoom: {
      id: nyangeSeniorTwoClass.id,
      code: nyangeSeniorTwoClass.code,
      name: nyangeSeniorTwoClass.name,
    },
    student: nyangeStudentPayload,
    gradingScheme: {
      id: nyangeGradingScheme.id,
      name: nyangeGradingScheme.name,
      version: nyangeGradingScheme.version,
    },
    rules: nyangeGradingRules,
    passMark: 50,
    caMax: NYANGE_CA_MAX,
    examMax: NYANGE_EXAM_MAX,
    termPayloads: [
      { termName: 'Term 1', subjects: termOneReportPayload.subjects.map(mapSubjectForYearly) },
      { termName: 'Term 2', subjects: termTwoReportPayload.subjects.map(mapSubjectForYearly) },
      { termName: 'Term 3', subjects: termThreeReportPayload.subjects.map(mapSubjectForYearly) },
    ],
    classSize: 1,
    position: 1,
  });

  const nyangeTermSnapshotData = [
    { term: nyangeTermOne, payload: termOneReportPayload, lockedAt: '2026-04-12T16:00:00.000Z', publishedAt: '2026-04-13T09:00:00.000Z' },
    { term: nyangeTermTwo, payload: termTwoReportPayload, lockedAt: '2026-08-14T16:00:00.000Z', publishedAt: '2026-08-15T09:00:00.000Z' },
    { term: nyangeTermThree, payload: termThreeReportPayload, lockedAt: '2026-12-15T16:00:00.000Z', publishedAt: '2026-12-16T09:00:00.000Z' },
  ] as const;

  for (const row of nyangeTermSnapshotData) {
    await prisma.resultSnapshot.upsert({
      where: {
        tenantId_termId_classRoomId_studentId: {
          tenantId: nyangeTenant.id,
          termId: row.term.id,
          classRoomId: nyangeSeniorTwoClass.id,
          studentId: nyangeStudent.id,
        },
      },
      update: {
        academicYearId: nyangeAcademicYear.id,
        gradingSchemeId: nyangeGradingScheme.id,
        gradingSchemeVersion: nyangeGradingScheme.version,
        status: 'PUBLISHED',
        payload: row.payload as unknown as Prisma.InputJsonValue,
        lockedAt: new Date(row.lockedAt),
        lockedByUserId: nyangeAdminUser.id,
        publishedAt: new Date(row.publishedAt),
        publishedByUserId: nyangeAdminUser.id,
      },
      create: {
        tenantId: nyangeTenant.id,
        academicYearId: nyangeAcademicYear.id,
        termId: row.term.id,
        classRoomId: nyangeSeniorTwoClass.id,
        studentId: nyangeStudent.id,
        gradingSchemeId: nyangeGradingScheme.id,
        gradingSchemeVersion: nyangeGradingScheme.version,
        status: 'PUBLISHED',
        payload: row.payload as unknown as Prisma.InputJsonValue,
        lockedAt: new Date(row.lockedAt),
        lockedByUserId: nyangeAdminUser.id,
        publishedAt: new Date(row.publishedAt),
        publishedByUserId: nyangeAdminUser.id,
      },
    });
  }

  await prisma.resultSnapshot.upsert({
    where: {
      tenantId_termId_classRoomId_studentId: {
        tenantId: nyangeTenant.id,
        termId: nyangeTermYearly.id,
        classRoomId: nyangeSeniorTwoClass.id,
        studentId: nyangeStudent.id,
      },
    },
    update: {
      academicYearId: nyangeAcademicYear.id,
      gradingSchemeId: nyangeGradingScheme.id,
      gradingSchemeVersion: nyangeGradingScheme.version,
      status: 'PUBLISHED',
      payload: yearlyReportPayload as unknown as Prisma.InputJsonValue,
      lockedAt: new Date('2026-12-20T16:00:00.000Z'),
      lockedByUserId: nyangeAdminUser.id,
      publishedAt: new Date('2026-12-21T09:00:00.000Z'),
      publishedByUserId: nyangeAdminUser.id,
    },
    create: {
      tenantId: nyangeTenant.id,
      academicYearId: nyangeAcademicYear.id,
      termId: nyangeTermYearly.id,
      classRoomId: nyangeSeniorTwoClass.id,
      studentId: nyangeStudent.id,
      gradingSchemeId: nyangeGradingScheme.id,
      gradingSchemeVersion: nyangeGradingScheme.version,
      status: 'PUBLISHED',
      payload: yearlyReportPayload as unknown as Prisma.InputJsonValue,
      lockedAt: new Date('2026-12-20T16:00:00.000Z'),
      lockedByUserId: nyangeAdminUser.id,
      publishedAt: new Date('2026-12-21T09:00:00.000Z'),
      publishedByUserId: nyangeAdminUser.id,
    },
  });

  const defaultPlan = await prisma.subscriptionPlan.upsert({
    where: { code: 'standard' },
    update: {},
    create: {
      code: 'standard',
      name: 'Standard',
      description: 'Default school subscription',
      maxStudents: 5000,
      maxStaff: 500,
      sortOrder: 1,
    },
  });

  await prisma.subscriptionPlan.upsert({
    where: { code: 'test_100' },
    update: {
      name: 'Test (100 students)',
      description: 'Small-school / QA plan (max 100 students, 20 staff)',
      maxStudents: 100,
      maxStaff: 20,
      isActive: true,
      sortOrder: 2,
    },
    create: {
      code: 'test_100',
      name: 'Test (100 students)',
      description: 'Small-school / QA plan (max 100 students, 20 staff)',
      maxStudents: 100,
      maxStaff: 20,
      sortOrder: 2,
    },
  });

  const tenantsForSubscription = await prisma.tenant.findMany({
    where: { code: { not: 'platform' } },
    select: { id: true },
  });

  for (const t of tenantsForSubscription) {
    await prisma.schoolSubscription.upsert({
      where: { tenantId: t.id },
      update: {},
      create: {
        tenantId: t.id,
        planId: defaultPlan.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
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
          authLoginBody: {
            identifier: 'email or username (trimmed, stored lowercase for email/username match)',
            password: 'min 8 chars (see auth.schemas loginSchema)',
          },
          superAdmin: [
            { identifier: 'smartschoolrwanda@gmail.com', password: 'Kigali2019@2022' },
            { identifier: 'sibomanadamascene1999@gmail.com', password: 'Kigali2019@2022' },
          ],
          schoolTenant: {
            tenantCode: 'gs-rwanda',
            schoolAdmin: { identifier: 'admin@school.rw', password: 'Admin@12345' },
            schoolAdminUsername: { identifier: 'school_admin', password: 'Admin@12345' },
            teacher: { identifier: 'teacher@school.rw', password: 'Teacher@12345' },
            teacherUsername: { identifier: 'school_teacher', password: 'Teacher@12345' },
            student: { identifier: 'student@school.rw', password: 'Student@12345' },
            studentUsername: { identifier: 'stu_alice', password: 'Student@12345' },
            parent: { identifier: 'parent@school.rw', password: 'Parent@12345' },
            parentUsername: { identifier: 'school_parent', password: 'Parent@12345' },
          },
          nyangeSecondarySchool: {
            tenantCode: 'nyange-ss',
            admin: { identifier: 'admin@nyange-secondary.rw', password: 'Admin@12345' },
            adminUsername: { identifier: 'nyange_admin', password: 'Admin@12345' },
            teacher: { identifier: 'teacher@nyange-secondary.rw', password: 'Teacher@12345' },
            teacherUsername: { identifier: 'nyange_teacher', password: 'Teacher@12345' },
            seniorTwoStudent: {
              identifier: 'student.s2@nyange-secondary.rw',
              password: 'Student@12345',
            },
            seniorTwoStudentUsername: { identifier: 'nya_s2_001', password: 'Student@12345' },
            studentCode: 'NYA-S2-001',
            classRoom: 'S2-A (Senior 2 A)',
            subjectsWithMarks:
              'Mathematics, English, Kinyarwanda, Physics, Chemistry, Biology, History, Geography (CA + term exam per term)',
            publishedReportCards:
              'Term 2 and Yearly (average of Term 1 + Term 2 per subject) for 2026 Academic Year',
          },
          academyCatalogLearner: {
            note: 'User is created by prisma/seed-public-academy.ts (run separately if needed).',
            login: { identifier: 'learner@academy.rw', password: 'Password123!' },
          },
          authRegisterBodyExample: {
            note: 'POST /auth/register — public academy catalog tenant only (see registerSchema).',
            example: {
              firstName: 'Jean',
              lastName: 'Mugabo',
              username: 'jean_mugabo',
              email: 'jean.mugabo@example.com',
              password: 'Password123!',
              confirmPassword: 'Password123!',
            },
          },
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
