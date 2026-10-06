import { computeSubjectScore, computeSuccessRate } from '../../src/modules/exams/marks-calculation';

describe('marks-calculation: CAT + Exam = Total (Revision #27)', () => {
  it('example from requirements: CAT=30 Exam=60 → Total=90 (not 45)', () => {
    const s = computeSubjectScore({
      cat: [{ obtained: 30, max: 30, present: true }],
      exam: [{ obtained: 60, max: 70, present: true }],
    });
    expect(s.totalObtained).toBe(90);
    expect(s.totalMax).toBe(100);
    expect(s.total).toBe(90);
  });

  it('does not average: 100% CAT + 0% EXAM over equal maxes = 50, not weighted 40/60', () => {
    const s = computeSubjectScore({
      cat: [{ obtained: 50, max: 50, present: true }],
      exam: [{ obtained: 0, max: 50, present: true }],
    });
    // raw sum: 50/100 = 50%
    expect(s.total).toBe(50);
    expect(s.testPercent).toBe(100);
    expect(s.examPercent).toBe(0);
  });

  it('absent paper keeps max (penalised) while missing record is ignored via hasAny=false', () => {
    const absent = computeSubjectScore({
      cat: [],
      exam: [{ obtained: null, max: 100, present: false }],
    });
    expect(absent.total).toBe(0);
    expect(absent.hasAny).toBe(true);

    const empty = computeSubjectScore({ cat: [], exam: [] });
    expect(empty.hasAny).toBe(false);
    expect(empty.total).toBe(0);
    expect(empty.testPercent).toBeNull();
    expect(empty.examPercent).toBeNull();
  });

  it('success rate: passed / eligible * 100, null when no data', () => {
    expect(computeSuccessRate([], 50).successRate).toBeNull();
    expect(computeSuccessRate([null, null], 50).successRate).toBeNull();
    const r = computeSuccessRate([80, 40, 60, null], 50);
    expect(r.eligible).toBe(3);
    expect(r.passed).toBe(2);
    expect(r.successRate).toBeCloseTo(66.67, 1);
  });
});
