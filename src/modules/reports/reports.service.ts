import { AttendanceStatus, Prisma } from '@prisma/client';

import { AppError } from '../../common/errors/app-error';
import { JwtUser } from '../../common/types/auth.types';
import { prisma } from '../../db/prisma';
import type {
  AcademicByClassQueryInput,
  AcademicClassQueryInput,
  AcademicStudentQueryInput,
  AcademicSubjectQueryInput,
  AttendanceAbsenteeismQueryInput,
  AttendanceByClassQueryInput,
  AttendanceSchoolQueryInput,
} from './reports.schemas';

type GradingBand = {
  min: number;
  max: number;
  grade: string;
  remark?: string;
};

/** Exam rows with subject + marks — matches report-card weighting logic. */
type ExamWithMarks = Prisma.ExamGetPayload<{
  include: {
    subject: { select: { id: true; name: true } };
    marks: { select: { studentId: true; marksObtained: true } };
  };
}>;

export class ReportsService {
  private isTeacherOnly(actor: JwtUser) {
    return (
      actor.roles.includes('TEACHER') &&
      !actor.roles.includes('SUPER_ADMIN') &&
      !actor.roles.includes('SCHOOL_ADMIN')
    );
  }

  private resolveBand(rules: GradingBand[], percentage: number) {
    const band = rules.find((item) => percentage >= item.min && percentage <= item.max);
    return {
      grade: band?.grade ?? 'N/A',
      remark: band?.remark ?? 'No remark',
    };
  }

  private async getDefaultGradingRules(tenantId: string): Promise<GradingBand[]> {
    const scheme = await prisma.gradingScheme.findFirst({
      where: { tenantId, isActive: true, isDefault: true },
    });
    if (!scheme) {
      throw new AppError(409, 'GRADING_SCHEME_NOT_FOUND', 'Create a default grading scheme first');
    }
    return scheme.rules as unknown as GradingBand[];
  }

  private async getTeacherClassRoomIds(tenantId: string, academicYearId: string, actor: JwtUser) {
    if (!this.isTeacherOnly(actor)) {
      return null;
    }
    const rows = await prisma.course.findMany({
      where: {
        tenantId,
        academicYearId,
        teacherUserId: actor.sub,
        isActive: true,
      },
      select: { classRoomId: true },
      distinct: ['classRoomId'],
    });
    return rows.map((r) => r.classRoomId);
  }

  private ensureClassAllowed(classRoomId: string, allowed: string[] | null) {
    if (allowed && !allowed.includes(classRoomId)) {
      throw new AppError(403, 'REPORTS_FORBIDDEN', 'You do not have access to this class');
    }
  }

  private parseSchoolDate(value: string): Date {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  private toSchoolDateString(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private computeStudentTermBreakdown(
    exams: ExamWithMarks[],
    studentId: string,
    rules: GradingBand[],
  ) {
    const bySubject = new Map<string, ExamWithMarks[]>();
    for (const exam of exams) {
      if (!bySubject.has(exam.subjectId)) {
        bySubject.set(exam.subjectId, []);
      }
      bySubject.get(exam.subjectId)!.push(exam);
    }

    const subjects: Array<{
      subjectId: string;
      subjectName: string;
      averagePercentage: number;
      grade: string;
      remark: string;
      exams: Array<{
        examId: string;
        name: string;
        examType: 'CAT' | 'EXAM';
        marksObtained: number;
        totalMarks: number;
        percentage: number;
        weight: number;
      }>;
    }> = [];

    for (const [, subjectExams] of bySubject) {
      const examParts = subjectExams.map((e) => {
        const mark = e.marks.find((m) => m.studentId === studentId);
        const marksObtained = mark?.marksObtained ?? 0;
        const percentage = e.totalMarks > 0 ? (marksObtained / e.totalMarks) * 100 : 0;
        return {
          examId: e.id,
          name: e.name,
          examType: e.examType,
          marksObtained,
          totalMarks: e.totalMarks,
          percentage,
          weight: e.weight,
        };
      });

      const catExams = examParts.filter((e) => e.examType === 'CAT');
      const examExams = examParts.filter((e) => e.examType === 'EXAM');
      let weightedAverage: number;
      if (catExams.length && examExams.length) {
        const catAvg =
          catExams.reduce((sum, e) => sum + e.percentage * e.weight, 0) /
          (catExams.reduce((s, e) => s + e.weight, 0) || 1);
        const examAvg =
          examExams.reduce((sum, e) => sum + e.percentage * e.weight, 0) /
          (examExams.reduce((s, e) => s + e.weight, 0) || 1);
        const catWeightTotal = catExams.reduce((s, e) => s + e.weight, 0);
        const examWeightTotal = examExams.reduce((s, e) => s + e.weight, 0);
        const totalWeight = catWeightTotal + examWeightTotal || 1;
        weightedAverage = (catAvg * catWeightTotal + examAvg * examWeightTotal) / totalWeight;
      } else {
        const weightTotal = examParts.reduce((sum, exam) => sum + exam.weight, 0) || 1;
        weightedAverage =
          examParts.reduce((sum, exam) => sum + exam.percentage * exam.weight, 0) / weightTotal;
      }

      const band = this.resolveBand(rules, weightedAverage);
      subjects.push({
        subjectId: subjectExams[0].subjectId,
        subjectName: subjectExams[0].subject.name,
        averagePercentage: Number(weightedAverage.toFixed(2)),
        grade: band.grade,
        remark: band.remark,
        exams: examParts,
      });
    }

    subjects.sort((a, b) => a.subjectName.localeCompare(b.subjectName));

    const averagePercentage = subjects.length
      ? subjects.reduce((sum, s) => sum + s.averagePercentage, 0) / subjects.length
      : 0;
    const overallBand = this.resolveBand(rules, averagePercentage);

    return {
      subjects,
      overall: {
        averagePercentage: Number(averagePercentage.toFixed(2)),
        grade: overallBand.grade,
        remark: overallBand.remark,
      },
    };
  }

  /** Row total aligned with class marks grid (sum of CAT + EXAM per subject). */
  private computeGridTotal(exams: ExamWithMarks[], studentId: string) {
    const bySubject = new Map<string, ExamWithMarks[]>();
    for (const exam of exams) {
      if (!bySubject.has(exam.subjectId)) {
        bySubject.set(exam.subjectId, []);
      }
      bySubject.get(exam.subjectId)!.push(exam);
    }
    let total = 0;
    for (const [, subjectExams] of bySubject) {
      const cat = subjectExams.find((e) => e.examType === 'CAT');
      const ex = subjectExams.find((e) => e.examType === 'EXAM');
      const testMarks = cat?.marks.find((m) => m.studentId === studentId)?.marksObtained ?? 0;
      const examMarks = ex?.marks.find((m) => m.studentId === studentId)?.marksObtained ?? 0;
      total += testMarks + examMarks;
    }
    return total;
  }

  async academicByClass(tenantId: string, query: AcademicByClassQueryInput, actor: JwtUser) {
    const term = await prisma.term.findFirst({
      where: { id: query.termId, tenantId, isActive: true },
      include: { academicYear: { select: { id: true, name: true } } },
    });
    if (!term) {
      throw new AppError(404, 'TERM_NOT_FOUND', 'Term not found');
    }

    const rules = await this.getDefaultGradingRules(tenantId);
    const allowedClassIds = await this.getTeacherClassRoomIds(tenantId, term.academicYearId, actor);

    if (this.isTeacherOnly(actor) && (!allowedClassIds || allowedClassIds.length === 0)) {
      return {
        term: { id: term.id, name: term.name },
        academicYear: term.academicYear,
        classes: [] as Array<unknown>,
      };
    }

    if (query.classRoomId && allowedClassIds && !allowedClassIds.includes(query.classRoomId)) {
      throw new AppError(403, 'REPORTS_FORBIDDEN', 'You do not have access to this class');
    }

    const classWhere: Prisma.ClassRoomWhereInput = {
      tenantId,
      isActive: true,
      gradeLevel: { isActive: true },
      ...(query.classRoomId
        ? { id: query.classRoomId }
        : allowedClassIds?.length
          ? { id: { in: allowedClassIds } }
          : {}),
    };

    const classes = await prisma.classRoom.findMany({
      where: classWhere,
      select: {
        id: true,
        code: true,
        name: true,
        gradeLevel: { select: { code: true, name: true } },
      },
      orderBy: [{ code: 'asc' }, { name: 'asc' }],
    });

    const classIds = classes.map((c) => c.id);
    if (!classIds.length) {
      return {
        term: { id: term.id, name: term.name },
        academicYear: term.academicYear,
        classes: [],
      };
    }

    const exams = await prisma.exam.findMany({
      where: {
        tenantId,
        termId: query.termId,
        classRoomId: { in: classIds },
        isActive: true,
      },
      include: {
        subject: { select: { id: true, name: true } },
        classRoom: { select: { id: true, code: true, name: true } },
        marks: { select: { studentId: true, marksObtained: true } },
      },
    });

    const examsByClass = new Map<string, ExamWithMarks[]>();
    for (const e of exams) {
      if (!examsByClass.has(e.classRoomId)) {
        examsByClass.set(e.classRoomId, []);
      }
      examsByClass.get(e.classRoomId)!.push(e);
    }

    const qLower = query.q?.trim().toLowerCase();

    const resultClasses = [];

    for (const cls of classes) {
      const classExams = examsByClass.get(cls.id) ?? [];
      const enrollments = await prisma.studentEnrollment.findMany({
        where: {
          tenantId,
          academicYearId: term.academicYearId,
          classRoomId: cls.id,
          isActive: true,
          student: {
            deletedAt: null,
            isActive: true,
            ...(qLower
              ? {
                  OR: [
                    { studentCode: { contains: query.q!, mode: 'insensitive' } },
                    { firstName: { contains: query.q!, mode: 'insensitive' } },
                    { lastName: { contains: query.q!, mode: 'insensitive' } },
                  ],
                }
              : {}),
          },
        },
        select: {
          student: {
            select: {
              id: true,
              studentCode: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
      });

      const studentsPayload = enrollments.map((row) => {
        const breakdown = this.computeStudentTermBreakdown(classExams, row.student.id, rules);
        const gridTotal = this.computeGridTotal(classExams, row.student.id);
        return {
          student: row.student,
          overall: breakdown.overall,
          subjectCount: breakdown.subjects.length,
          gridTotal,
        };
      });

      const ranked = [...studentsPayload]
        .sort((a, b) => b.gridTotal - a.gridTotal)
        .map((row, index) => ({ ...row, rank: index + 1 }));

      resultClasses.push({
        classRoom: cls,
        examCount: classExams.length,
        students: ranked,
      });
    }

    return {
      term: { id: term.id, name: term.name },
      academicYear: term.academicYear,
      classes: resultClasses,
    };
  }

  async academicStudent(
    tenantId: string,
    studentId: string,
    query: AcademicStudentQueryInput,
    actor: JwtUser,
  ) {
    const term = await prisma.term.findFirst({
      where: { id: query.termId, tenantId, isActive: true },
      include: { academicYear: { select: { id: true, name: true } } },
    });
    if (!term) {
      throw new AppError(404, 'TERM_NOT_FOUND', 'Term not found');
    }

    const student = await prisma.student.findFirst({
      where: { id: studentId, tenantId, deletedAt: null },
      select: { id: true, studentCode: true, firstName: true, lastName: true },
    });
    if (!student) {
      throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student not found');
    }

    const enrollment = await prisma.studentEnrollment.findFirst({
      where: {
        tenantId,
        studentId,
        academicYearId: term.academicYearId,
        isActive: true,
      },
      select: { classRoomId: true, classRoom: { select: { id: true, code: true, name: true } } },
    });
    if (!enrollment) {
      throw new AppError(404, 'ENROLLMENT_NOT_FOUND', 'Student is not enrolled for this academic year');
    }

    const allowedClassIds = await this.getTeacherClassRoomIds(tenantId, term.academicYearId, actor);
    this.ensureClassAllowed(enrollment.classRoomId, allowedClassIds);

    const rules = await this.getDefaultGradingRules(tenantId);

    const exams = await prisma.exam.findMany({
      where: {
        tenantId,
        termId: query.termId,
        classRoomId: enrollment.classRoomId,
        isActive: true,
      },
      include: {
        subject: { select: { id: true, name: true } },
        classRoom: { select: { id: true, code: true, name: true } },
        marks: { select: { studentId: true, marksObtained: true } },
      },
    });

    const breakdown = this.computeStudentTermBreakdown(exams, student.id, rules);
    const gridTotal = this.computeGridTotal(exams, student.id);

    const peers = await prisma.studentEnrollment.findMany({
      where: {
        tenantId,
        academicYearId: term.academicYearId,
        classRoomId: enrollment.classRoomId,
        isActive: true,
        student: { deletedAt: null, isActive: true },
      },
      select: { student: { select: { id: true } } },
    });

    const peerTotals = peers.map((p) => ({
      studentId: p.student.id,
      total: this.computeGridTotal(exams, p.student.id),
    }));
    peerTotals.sort((a, b) => b.total - a.total);
    const position = peerTotals.findIndex((p) => p.studentId === student.id) + 1;

    return {
      term: { id: term.id, name: term.name },
      academicYear: term.academicYear,
      classRoom: enrollment.classRoom,
      student,
      ...breakdown,
      gridTotal,
      rank: {
        position: position || null,
        classSize: peerTotals.length,
      },
    };
  }

  async academicClass(
    tenantId: string,
    classRoomId: string,
    query: AcademicClassQueryInput,
    actor: JwtUser,
  ) {
    const term = await prisma.term.findFirst({
      where: { id: query.termId, tenantId, isActive: true },
      include: { academicYear: { select: { id: true, name: true } } },
    });
    if (!term) {
      throw new AppError(404, 'TERM_NOT_FOUND', 'Term not found');
    }

    const classRoom = await prisma.classRoom.findFirst({
      where: { id: classRoomId, tenantId, isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        gradeLevel: { select: { code: true, name: true } },
      },
    });
    if (!classRoom) {
      throw new AppError(404, 'CLASS_ROOM_NOT_FOUND', 'Class not found');
    }

    const allowedClassIds = await this.getTeacherClassRoomIds(tenantId, term.academicYearId, actor);
    this.ensureClassAllowed(classRoomId, allowedClassIds);

    const rules = await this.getDefaultGradingRules(tenantId);

    const exams = await prisma.exam.findMany({
      where: {
        tenantId,
        termId: query.termId,
        classRoomId,
        isActive: true,
      },
      include: {
        subject: { select: { id: true, name: true } },
        marks: { select: { studentId: true, marksObtained: true } },
      },
    });

    const enrollments = await prisma.studentEnrollment.findMany({
      where: {
        tenantId,
        academicYearId: term.academicYearId,
        classRoomId,
        isActive: true,
        student: { deletedAt: null, isActive: true },
      },
      select: {
        student: {
          select: { id: true, studentCode: true, firstName: true, lastName: true },
        },
      },
    });

    const rows = enrollments.map((e) => {
      const breakdown = this.computeStudentTermBreakdown(exams, e.student.id, rules);
      const gridTotal = this.computeGridTotal(exams, e.student.id);
      return {
        student: e.student,
        overall: breakdown.overall,
        gridTotal,
      };
    });

    const withRank = [...rows]
      .sort((a, b) => b.gridTotal - a.gridTotal)
      .map((r, index) => ({ ...r, rank: index + 1 }));

    const averages = withRank.map((r) => r.overall.averagePercentage).filter((n) => n > 0);
    const classAverage =
      averages.length > 0 ? Number((averages.reduce((s, n) => s + n, 0) / averages.length).toFixed(2)) : 0;

    const passCount = withRank.filter((r) => r.overall.averagePercentage >= 50).length;
    const passRatePercent =
      withRank.length > 0 ? Number(((passCount / withRank.length) * 100).toFixed(1)) : 0;

    const sortedByAvg = [...withRank].sort((a, b) => a.overall.averagePercentage - b.overall.averagePercentage);
    const bottom = sortedByAvg.slice(0, Math.min(5, sortedByAvg.length));
    const top = [...sortedByAvg].reverse().slice(0, Math.min(5, sortedByAvg.length));

    return {
      term: { id: term.id, name: term.name },
      academicYear: term.academicYear,
      classRoom,
      examCount: exams.length,
      statistics: {
        classAverage,
        passRatePercent,
        passThresholdNote: 'Pass rate uses overall average ≥ 50%',
        enrolled: withRank.length,
      },
      topStudents: top.map((r) => ({
        student: r.student,
        overall: r.overall,
        gridTotal: r.gridTotal,
        rank: r.rank,
      })),
      bottomStudents: bottom.map((r) => ({
        student: r.student,
        overall: r.overall,
        gridTotal: r.gridTotal,
        rank: r.rank,
      })),
      students: withRank,
    };
  }

  async academicSubject(
    tenantId: string,
    query: AcademicSubjectQueryInput,
    actor: JwtUser,
  ) {
    const term = await prisma.term.findFirst({
      where: { id: query.termId, tenantId, isActive: true },
      include: { academicYear: { select: { id: true, name: true } } },
    });
    if (!term) {
      throw new AppError(404, 'TERM_NOT_FOUND', 'Term not found');
    }

    const subject = await prisma.subject.findFirst({
      where: { id: query.subjectId, tenantId, isActive: true },
      select: { id: true, code: true, name: true },
    });
    if (!subject) {
      throw new AppError(404, 'SUBJECT_NOT_FOUND', 'Subject not found');
    }

    const allowedClassIds = await this.getTeacherClassRoomIds(tenantId, term.academicYearId, actor);

    if (query.classRoomId && allowedClassIds && !allowedClassIds.includes(query.classRoomId)) {
      throw new AppError(403, 'REPORTS_FORBIDDEN', 'You do not have access to this class');
    }

    const examWhere: Prisma.ExamWhereInput = {
      tenantId,
      termId: query.termId,
      subjectId: query.subjectId,
      isActive: true,
      ...(query.classRoomId
        ? { classRoomId: query.classRoomId }
        : allowedClassIds?.length
          ? { classRoomId: { in: allowedClassIds } }
          : {}),
    };

    if (this.isTeacherOnly(actor) && (!allowedClassIds || allowedClassIds.length === 0)) {
      return {
        term: { id: term.id, name: term.name },
        academicYear: term.academicYear,
        subject,
        classes: [],
      };
    }

    const exams = await prisma.exam.findMany({
      where: examWhere,
      include: {
        subject: { select: { id: true, name: true } },
        classRoom: { select: { id: true, code: true, name: true } },
        marks: { select: { studentId: true, marksObtained: true } },
      },
    });

    const rules = await this.getDefaultGradingRules(tenantId);

    const byClass = new Map<
      string,
      { classRoom: { id: string; code: string; name: string }; exams: ExamWithMarks[] }
    >();
    for (const e of exams) {
      if (!byClass.has(e.classRoomId)) {
        byClass.set(e.classRoomId, {
          classRoom: e.classRoom,
          exams: [],
        });
      }
      byClass.get(e.classRoomId)!.exams.push(e as ExamWithMarks);
    }

    const classesOut = [];

    for (const [, { classRoom, exams: classExams }] of byClass) {
      const enrollments = await prisma.studentEnrollment.findMany({
        where: {
          tenantId,
          academicYearId: term.academicYearId,
          classRoomId: classRoom.id,
          isActive: true,
          student: { deletedAt: null, isActive: true },
        },
        select: {
          student: {
            select: { id: true, studentCode: true, firstName: true, lastName: true },
          },
        },
      });

      const studentRows = enrollments.map((en) => {
        const breakdown = this.computeStudentTermBreakdown(classExams, en.student.id, rules);
        const subjectRow = breakdown.subjects.find((s) => s.subjectId === subject.id);
        return {
          student: en.student,
          subject: subjectRow ?? null,
          overall: breakdown.overall,
        };
      });

      const subjectAvgs = studentRows
        .map((r) => r.subject?.averagePercentage)
        .filter((n): n is number => n != null && !Number.isNaN(n));
      const classSubjectAverage =
        subjectAvgs.length > 0
          ? Number((subjectAvgs.reduce((a, b) => a + b, 0) / subjectAvgs.length).toFixed(2))
          : 0;

      classesOut.push({
        classRoom,
        subjectAverage: classSubjectAverage,
        students: studentRows.sort((a, b) =>
          (b.subject?.averagePercentage ?? 0) - (a.subject?.averagePercentage ?? 0),
        ),
      });
    }

    classesOut.sort((a, b) => a.classRoom.code.localeCompare(b.classRoom.code));

    return {
      term: { id: term.id, name: term.name },
      academicYear: term.academicYear,
      subject,
      classes: classesOut,
    };
  }

  private async getAttendanceClassFilter(
    tenantId: string,
    from: Date,
    to: Date,
    actor: JwtUser,
  ): Promise<string[] | null> {
    if (!this.isTeacherOnly(actor)) {
      return null;
    }
    const academicYear = await prisma.academicYear.findFirst({
      where: {
        tenantId,
        isActive: true,
        startDate: { lte: to },
        endDate: { gte: from },
      },
      select: { id: true },
    });
    if (!academicYear) {
      return [];
    }
    const courses = await prisma.course.findMany({
      where: {
        tenantId,
        academicYearId: academicYear.id,
        teacherUserId: actor.sub,
        isActive: true,
      },
      select: { classRoomId: true },
      distinct: ['classRoomId'],
    });
    return courses.map((c) => c.classRoomId);
  }

  async attendanceSchool(tenantId: string, query: AttendanceSchoolQueryInput, actor: JwtUser) {
    const from = this.parseSchoolDate(query.from);
    const to = this.parseSchoolDate(query.to);
    if (from > to) {
      throw new AppError(400, 'REPORTS_RANGE_INVALID', 'from must be on or before to');
    }

    const allowedClassIds = await this.getAttendanceClassFilter(tenantId, from, to, actor);

    const where: Prisma.AttendanceRecordWhereInput = {
      tenantId,
      attendanceDate: { gte: from, lte: to },
      ...(allowedClassIds ? { classRoomId: { in: allowedClassIds } } : {}),
    };

    const records = await prisma.attendanceRecord.findMany({
      where,
      select: { status: true },
    });

    const counts = {
      present: 0,
      absent: 0,
      late: 0,
      excused: 0,
    };
    for (const r of records) {
      if (r.status === AttendanceStatus.PRESENT) counts.present += 1;
      else if (r.status === AttendanceStatus.ABSENT) counts.absent += 1;
      else if (r.status === AttendanceStatus.LATE) counts.late += 1;
      else if (r.status === AttendanceStatus.EXCUSED) counts.excused += 1;
    }

    const total = records.length;
    const denominator = counts.present + counts.absent + counts.late + counts.excused;
    const ratePercent =
      denominator > 0 ? Number(((counts.present / denominator) * 100).toFixed(1)) : 0;

    return {
      range: { from: query.from, to: query.to },
      totals: {
        records: total,
        ...counts,
      },
      ratePercent,
      rateNote: 'Rate = present ÷ (present + absent + late + excused)',
    };
  }

  async attendanceByClass(tenantId: string, query: AttendanceByClassQueryInput, actor: JwtUser) {
    const from = this.parseSchoolDate(query.from);
    const to = this.parseSchoolDate(query.to);
    if (from > to) {
      throw new AppError(400, 'REPORTS_RANGE_INVALID', 'from must be on or before to');
    }

    const allowedClassIds = await this.getAttendanceClassFilter(tenantId, from, to, actor);

    const records = await prisma.attendanceRecord.findMany({
      where: {
        tenantId,
        attendanceDate: { gte: from, lte: to },
        ...(allowedClassIds ? { classRoomId: { in: allowedClassIds } } : {}),
      },
      select: {
        classRoomId: true,
        status: true,
        classRoom: { select: { id: true, code: true, name: true } },
      },
    });

    const byClass = new Map<
      string,
      {
        classRoom: { id: string; code: string; name: string };
        present: number;
        absent: number;
        late: number;
        excused: number;
        records: number;
      }
    >();

    for (const r of records) {
      if (!byClass.has(r.classRoomId)) {
        byClass.set(r.classRoomId, {
          classRoom: r.classRoom,
          present: 0,
          absent: 0,
          late: 0,
          excused: 0,
          records: 0,
        });
      }
      const row = byClass.get(r.classRoomId)!;
      row.records += 1;
      if (r.status === AttendanceStatus.PRESENT) row.present += 1;
      else if (r.status === AttendanceStatus.ABSENT) row.absent += 1;
      else if (r.status === AttendanceStatus.LATE) row.late += 1;
      else if (r.status === AttendanceStatus.EXCUSED) row.excused += 1;
    }

    const rows = Array.from(byClass.values()).map((row) => {
      const d = row.present + row.absent + row.late + row.excused;
      return {
        ...row,
        ratePercent: d > 0 ? Number(((row.present / d) * 100).toFixed(1)) : 0,
      };
    });

    rows.sort((a, b) => a.classRoom.code.localeCompare(b.classRoom.code));

    return {
      range: { from: query.from, to: query.to },
      classes: rows,
    };
  }

  async attendanceAbsenteeism(
    tenantId: string,
    query: AttendanceAbsenteeismQueryInput,
    actor: JwtUser,
  ) {
    const from = this.parseSchoolDate(query.from);
    const to = this.parseSchoolDate(query.to);
    if (from > to) {
      throw new AppError(400, 'REPORTS_RANGE_INVALID', 'from must be on or before to');
    }

    const allowedClassIds = await this.getAttendanceClassFilter(tenantId, from, to, actor);

    const absentRecords = await prisma.attendanceRecord.findMany({
      where: {
        tenantId,
        attendanceDate: { gte: from, lte: to },
        status: AttendanceStatus.ABSENT,
        ...(allowedClassIds ? { classRoomId: { in: allowedClassIds } } : {}),
      },
      select: {
        studentId: true,
        attendanceDate: true,
        classRoom: { select: { id: true, code: true, name: true } },
      },
    });

    const byStudent = new Map<
      string,
      {
        dates: Set<string>;
        classRoom: { id: string; code: string; name: string };
      }
    >();

    for (const r of absentRecords) {
      if (!byStudent.has(r.studentId)) {
        byStudent.set(r.studentId, {
          dates: new Set(),
          classRoom: r.classRoom,
        });
      }
      const entry = byStudent.get(r.studentId)!;
      entry.dates.add(this.toSchoolDateString(r.attendanceDate));
      entry.classRoom = r.classRoom;
    }

    const studentIds = Array.from(byStudent.keys());
    const students = await prisma.student.findMany({
      where: { tenantId, id: { in: studentIds }, deletedAt: null },
      select: { id: true, studentCode: true, firstName: true, lastName: true },
    });
    const studentMap = new Map(students.map((s) => [s.id, s]));

    const flagged = studentIds
      .map((id) => {
        const meta = byStudent.get(id)!;
        const st = studentMap.get(id);
        if (!st) return null;
        const absentDays = meta.dates.size;
        if (absentDays < query.minAbsent) return null;
        return {
          student: st,
          classRoom: meta.classRoom,
          absentDays,
          absentDatesSample: Array.from(meta.dates).sort().slice(0, 10),
        };
      })
      .filter(Boolean) as Array<{
      student: { id: string; studentCode: string; firstName: string; lastName: string };
      classRoom: { id: string; code: string; name: string };
      absentDays: number;
      absentDatesSample: string[];
    }>;

    flagged.sort((a, b) => b.absentDays - a.absentDays);

    return {
      range: { from: query.from, to: query.to },
      minAbsent: query.minAbsent,
      students: flagged,
    };
  }

  async attendanceSummaryCards(tenantId: string, actor: JwtUser) {
    const today = new Date();
    const y = today.getUTCFullYear();
    const m = today.getUTCMonth();
    const d = today.getUTCDate();
    const todayStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const todayDate = this.parseSchoolDate(todayStr);

    const allowedClassIds = await this.getAttendanceClassFilter(
      tenantId,
      todayDate,
      todayDate,
      actor,
    );

    const baseWhere: Prisma.AttendanceRecordWhereInput = {
      tenantId,
      ...(allowedClassIds ? { classRoomId: { in: allowedClassIds } } : {}),
    };

    const [todayRecords, weekStart] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where: {
          ...baseWhere,
          attendanceDate: todayDate,
        },
        select: { status: true },
      }),
      (() => {
        const day = todayDate.getUTCDay();
        const diff = (day + 6) % 7;
        const ws = new Date(todayDate);
        ws.setUTCDate(ws.getUTCDate() - diff);
        return ws;
      })(),
    ]);

    const weekEnd = new Date(todayDate);

    const weekRecords = await prisma.attendanceRecord.findMany({
      where: {
        ...baseWhere,
        attendanceDate: { gte: weekStart, lte: weekEnd },
      },
      select: { status: true },
    });

    function summarize(records: Array<{ status: AttendanceStatus }>) {
      const c = { present: 0, absent: 0, late: 0, excused: 0 };
      for (const r of records) {
        if (r.status === AttendanceStatus.PRESENT) c.present += 1;
        else if (r.status === AttendanceStatus.ABSENT) c.absent += 1;
        else if (r.status === AttendanceStatus.LATE) c.late += 1;
        else if (r.status === AttendanceStatus.EXCUSED) c.excused += 1;
      }
      const denom = c.present + c.absent + c.late + c.excused;
      return {
        ...c,
        records: records.length,
        ratePercent: denom > 0 ? Number(((c.present / denom) * 100).toFixed(1)) : 0,
      };
    }

    return {
      date: todayStr,
      today: summarize(todayRecords),
      weekToDate: {
        range: {
          from: this.toSchoolDateString(weekStart),
          to: this.toSchoolDateString(weekEnd),
        },
        ...summarize(weekRecords),
      },
    };
  }
}
