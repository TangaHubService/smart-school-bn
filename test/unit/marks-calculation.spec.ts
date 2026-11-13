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

describe('marks-calculation: CAT and EXAM parts shown on the marks sheet', () => {
  it('shows raw marks when the papers add up to 100 (CAT /30 + EXAM /70)', () => {
    const s = computeSubjectScore({
      cat: [{ obtained: 25, max: 30, present: true }],
      exam: [{ obtained: 53, max: 70, present: true }],
    });
    expect(s.catShare).toBe(25);
    expect(s.examShare).toBe(53);
    expect(s.total).toBe(78);
  });

  it('keeps CAT + EXAM equal to TOT on other scales, even with rounding', () => {
    const s = computeSubjectScore({
      cat: [
        { obtained: 7, max: 10, present: true },
        { obtained: 8, max: 20, present: true },
      ],
      exam: [{ obtained: 41, max: 60, present: true }],
    });
    expect((s.catShare ?? 0) + (s.examShare ?? 0)).toBeCloseTo(s.total, 10);
    expect(s.catShare).toBeCloseTo((15 / 90) * 100, 2);
  });

  it('leaves the part empty when there is no paper of that kind', () => {
    const s = computeSubjectScore({ cat: [], exam: [{ obtained: 40, max: 50, present: true }] });
    expect(s.catShare).toBeNull();
    expect(s.examShare).toBe(80);
    expect(s.total).toBe(80);
  });
});
