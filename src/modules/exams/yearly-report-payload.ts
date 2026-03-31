import { MarkStatus } from '@prisma/client';

import type { ReportCardPayload } from './report-card-pdf';

export type GradingBand = {
  min: number;
  max: number;
  grade: string;
  remark?: string;
};

export type TermAssessmentPolicy = {
  continuousWeight: number;
  examWeight: number;
  passMark: number;
};

/** Exams as loaded for lock/snapshot (marks scoped per exam). */
export type ExamForTermRollup = {
  subjectId: string;
  examType: string | null;
  name: string;
  totalMarks: number;
  weight: number;
  marks: Array<{ studentId: string; marksObtained: number | null; status: MarkStatus }>;
  subject?: { name: string };
  teacherUser?: { firstName: string | null; lastName: string | null } | null;
};

export function isYearlyAggregationTerm(term: { sequence: number; name: string }): boolean {
  if (term.sequence >= 4) {
    return true;
  }
  return /\b(yearly|year\s*end|annual)\b/i.test(term.name);
}

export function resolveBand(rules: GradingBand[], percentage: number) {
  const band = rules.find((item) => percentage >= item.min && percentage <= item.max);
  return {
    grade: band?.grade ?? 'N/A',
    remark: band?.remark ?? 'No remark',
  };
}

/**
 * One subject in one term: weighted CAT/EXAM % (same rules as term report cards) plus raw CA/Exam sums.
 */
export function computeSubjectTermPerformance(
  subjectExams: ExamForTermRollup[],
  studentId: string,
  policy: TermAssessmentPolicy,
): {
  continuousAssessmentPercent: number;
  examPercent: number;
  finalPercent: number;
  caObtained: number;
  caMax: number;
  examObtained: number;
  examMax: number;
} {
  const caExams = subjectExams.filter((e) => e.examType === 'CAT');
  const termExams = subjectExams.filter((e) => e.examType === 'EXAM');

  const pctForStudent = (exam: ExamForTermRollup): number => {
    const m = exam.marks.find((item) => item.studentId === studentId);
    if (!m || m.status !== MarkStatus.PRESENT || m.marksObtained == null) {
      return 0;
    }
    return exam.totalMarks > 0 ? (m.marksObtained / exam.totalMarks) * 100 : 0;
  };

  const weightedPercent = (examList: ExamForTermRollup[]): number => {
    if (!examList.length) {
      return 0;
    }
    const weightTotal = examList.reduce((sum, e) => sum + e.weight, 0) || 1;
    return examList.reduce((sum, e) => sum + pctForStudent(e) * e.weight, 0) / weightTotal;
  };

  const continuousAssessmentPercent = weightedPercent(caExams);
  const examPercent = weightedPercent(termExams);
  const cw = policy.continuousWeight;
  const ew = policy.examWeight;
  const wSum = cw + ew || 1;
  const hasCa = caExams.length > 0;
  const hasTerm = termExams.length > 0;
  let finalPercent: number;
  if (hasCa && hasTerm) {
    finalPercent = (continuousAssessmentPercent * cw + examPercent * ew) / wSum;
  } else if (hasTerm) {
    finalPercent = examPercent;
  } else if (hasCa) {
    finalPercent = continuousAssessmentPercent;
  } else {
    finalPercent = 0;
  }

  let caObtained = 0;
  let caMax = 0;
  for (const e of caExams) {
    const m = e.marks.find((mark) => mark.studentId === studentId);
    if (m?.status === MarkStatus.PRESENT && m.marksObtained != null) {
      caObtained += m.marksObtained;
    }
    caMax += e.totalMarks;
  }
  let examObtained = 0;
  let examMax = 0;
  for (const e of termExams) {
    const m = e.marks.find((mark) => mark.studentId === studentId);
    if (m?.status === MarkStatus.PRESENT && m.marksObtained != null) {
      examObtained += m.marksObtained;
    }
    examMax += e.totalMarks;
  }

  return {
    continuousAssessmentPercent,
    examPercent,
    finalPercent,
    caObtained,
    caMax,
    examObtained,
    examMax,
  };
}

export function buildYearlyReportCardSubjects(params: {
  unionSubjectIds: string[];
  subjectNameById: Map<string, string>;
  teachingTerms: Array<{ termId: string; termName: string; exams: ExamForTermRollup[] }>;
  studentId: string;
  policyByTermAndSubject: Map<string, TermAssessmentPolicy>;
  defaultPolicy: TermAssessmentPolicy;
  gradingRules: GradingBand[];
}): {
  subjects: ReportCardPayload['subjects'];
  yearlyReport: NonNullable<ReportCardPayload['yearlyReport']>;
} {
  const { defaultPolicy, gradingRules } = params;

  const sortedSubjectIds = [...params.unionSubjectIds].sort((a, b) => {
    const na = params.subjectNameById.get(a) ?? '';
    const nb = params.subjectNameById.get(b) ?? '';
    return na.localeCompare(nb);
  });

  const subjects: ReportCardPayload['subjects'] = [];

  for (const subjectId of sortedSubjectIds) {
    const subjectName = params.subjectNameById.get(subjectId) ?? subjectId;
    const yearlyTermBreakdown = params.teachingTerms.map((tt) => {
      const subjectExams = tt.exams.filter((e) => e.subjectId === subjectId);
      const pol =
        params.policyByTermAndSubject.get(`${tt.termId}:${subjectId}`) ?? defaultPolicy;
      const m = computeSubjectTermPerformance(subjectExams, params.studentId, pol);
      return {
        termName: tt.termName,
        caObtained: m.caObtained,
        caMax: m.caMax,
        examObtained: m.examObtained,
        examMax: m.examMax,
        termFinalPercent: Number(m.finalPercent.toFixed(2)),
      };
    });

    const finals = yearlyTermBreakdown.map((t) => t.termFinalPercent);
    const yearlyAveragePercent =
      finals.length > 0 ? finals.reduce((a, b) => a + b, 0) / finals.length : 0;
    const totalRawObtained = yearlyTermBreakdown.reduce(
      (sum, t) => sum + t.caObtained + t.examObtained,
      0,
    );
    const totalRawMax = yearlyTermBreakdown.reduce((sum, t) => sum + t.caMax + t.examMax, 0);
    const yearlyTotalRawPercent =
      totalRawMax > 0 ? (totalRawObtained / totalRawMax) * 100 : 0;

    const passMark =
      params.policyByTermAndSubject.get(`${params.teachingTerms[0].termId}:${subjectId}`)
        ?.passMark ?? defaultPolicy.passMark;

    const decision: 'PASS' | 'FAIL' = yearlyAveragePercent >= passMark ? 'PASS' : 'FAIL';
    const band = resolveBand(gradingRules, yearlyAveragePercent);
    const yAvg = Number(yearlyAveragePercent.toFixed(2));

    subjects.push({
      subjectId,
      subjectName,
      averagePercentage: yAvg,
      yearlyTermBreakdown,
      yearlyAveragePercent: yAvg,
      yearlyTotalRawObtained: totalRawObtained,
      yearlyTotalRawMax: totalRawMax,
      yearlyTotalRawPercent: Number(yearlyTotalRawPercent.toFixed(2)),
      passMark,
      decision,
      grade: band.grade,
      remark: band.remark,
      exams: [],
    });
  }

  const first = subjects[0]?.yearlyTermBreakdown?.[0];
  const yearlyReport: NonNullable<ReportCardPayload['yearlyReport']> = {
    layout: 'three_terms',
    caMaxPerTerm: first?.caMax ?? 30,
    examMaxPerTerm: first?.examMax ?? 70,
    yearGradeMethod: 'average_of_term_final_percentages',
    yearRawMethod: 'sum_of_marks_out_of_three_times_ca_plus_exam_max',
  };

  return { subjects, yearlyReport };
}
