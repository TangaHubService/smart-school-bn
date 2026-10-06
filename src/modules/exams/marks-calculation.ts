/**
 * Central marks-calculation service.
 *
 * OFFICIAL FORMULA (Revision #27):
 *   Total = CAT Marks + Exam Marks  (raw sum, NOT an average)
 *
 * For a 0–100 scale the percentage is derived from raw sums:
 *   catObtained  = Σ marksObtained over PRESENT CAT exams
 *   catMax       = Σ totalMarks over CAT exams
 *   examObtained = Σ marksObtained over PRESENT EXAM exams
 *   examMax      = Σ totalMarks over EXAM exams
 *   totalObtained = catObtained + examObtained
 *   totalMax      = catMax + examMax
 *   totalPercent  = totalMax > 0 ? (totalObtained / totalMax) * 100 : 0
 *
 * Example from requirements:
 *   CAT = 30, Exam = 60  →  Total = 90   (NOT (30+60)/2 = 45)
 *
 * Absent / excused / missing marks are EXCLUDED from obtained but their
 * exam's max stays in the denominator only when the exam exists — actually
 * we exclude missing from BOTH obtained and max so a missed paper does not
 * unfairly zero the denominator when the student never sat it? No:
 * decision: missing/absent contributes 0 obtained AND keeps max (student
 * scores 0 for that paper). Only exams with no mark record at all are
 * ignored for hasAny detection. PRESENT with null → treated as missing.
 *
 * SubjectAssessmentPolicy weights (continuousWeight/examWeight) are
 * intentionally NOT used for the total — they remain for passMark only.
 * If a school ever needs weighted totals, pass an explicit option.
 */

export type MarkEntry = {
  obtained: number | null | undefined;
  max: number;
  present: boolean;
};

export type SubjectScoreInput = {
  cat: MarkEntry[];
  exam: MarkEntry[];
};

export type SubjectScore = {
  catObtained: number;
  catMax: number;
  examObtained: number;
  examMax: number;
  totalObtained: number;
  totalMax: number;
  /** CAT percentage (null when no CAT papers with max > 0) */
  testPercent: number | null;
  /** EXAM percentage (null when no EXAM papers with max > 0) */
  examPercent: number | null;
  /** Canonical subject total: raw-sum percentage 0–100 */
  total: number;
  hasAny: boolean;
};

const round2 = (n: number) => Number(n.toFixed(2));

export function computeSubjectScore(input: SubjectScoreInput): SubjectScore {
  const sumPresent = (entries: MarkEntry[]) => {
    let obtained = 0;
    let max = 0;
    let hasAny = false;
    for (const e of entries) {
      const maxMarks = Number(e.max) || 0;
      if (maxMarks <= 0) continue;
      if (e.present && e.obtained != null) {
        obtained += Number(e.obtained);
        max += maxMarks;
        hasAny = true;
      } else if (!e.present) {
        // Absent/excused with a scheduled paper: counts 0 toward obtained,
        // keeps max so the miss is penalised.
        max += maxMarks;
        hasAny = true;
      }
      // No record at all (present=false + obtained=null because exam not
      // taken) is skipped by callers — they only pass entries for exams
      // the student was expected in. Callers decide inclusion.
    }
    return { obtained, max, hasAny };
  };

  const cat = sumPresent(input.cat);
  const exam = sumPresent(input.exam);
  const totalObtained = cat.obtained + exam.obtained;
  const totalMax = cat.max + exam.max;
  const hasAny = cat.hasAny || exam.hasAny;

  const testPercent = cat.max > 0 ? round2((cat.obtained / cat.max) * 100) : null;
  const examPercent = exam.max > 0 ? round2((exam.obtained / exam.max) * 100) : null;
  const total = hasAny && totalMax > 0 ? round2((totalObtained / totalMax) * 100) : 0;

  return {
    catObtained: cat.obtained,
    catMax: cat.max,
    examObtained: exam.obtained,
    examMax: exam.max,
    totalObtained,
    totalMax,
    testPercent,
    examPercent,
    total,
    hasAny,
  };
}

/**
 * Student Success Rate (Revision #2).
 * successRate = students with termAverage >= passMark / students with any marks * 100
 */
export function computeSuccessRate(
  studentAverages: Array<number | null>,
  passMark = 50
): { successRate: number | null; passed: number; eligible: number } {
  const eligible = studentAverages.filter(v => v != null).length;
  if (!eligible) return { successRate: null, passed: 0, eligible: 0 };
  const passed = studentAverages.filter(v => v != null && (v as number) >= passMark).length;
  return { successRate: round2((passed / eligible) * 100), passed, eligible };
}
