import { MarkStatus } from '@prisma/client';

import {
  buildYearlyReportCardSubjects,
  ExamForTermRollup,
} from '../../src/modules/exams/yearly-report-payload';

const exam = (subjectId: string, examType: 'CAT' | 'EXAM', totalMarks: number, obtained: number): ExamForTermRollup => ({
  subjectId,
  examType,
  name: `${subjectId}-${examType}`,
  totalMarks,
  weight: 1,
  marks: [{ studentId: 's1', marksObtained: obtained, status: MarkStatus.PRESENT }],
  subject: { name: subjectId },
});

const rules = [
  { min: 0, max: 49.99, grade: 'F' },
  { min: 50, max: 100, grade: 'A' },
];
const defaultPolicy = { continuousWeight: 40, examWeight: 60, passMark: 50 };

describe('buildYearlyReportCardSubjects', () => {
  it('averages the three term finals for a subject taught all year', () => {
    const { subjects } = buildYearlyReportCardSubjects({
      unionSubjectIds: ['MATH'],
      subjectNameById: new Map([['MATH', 'Math']]),
      teachingTerms: [
        { termId: 't1', termName: 'Term 1', exams: [exam('MATH', 'CAT', 30, 30), exam('MATH', 'EXAM', 70, 70)] },
        { termId: 't2', termName: 'Term 2', exams: [exam('MATH', 'CAT', 30, 15), exam('MATH', 'EXAM', 70, 35)] },
        { termId: 't3', termName: 'Term 3', exams: [exam('MATH', 'CAT', 30, 0), exam('MATH', 'EXAM', 70, 0)] },
      ],
      studentId: 's1',
      policyByTermAndSubject: new Map(),
      defaultPolicy,
      gradingRules: rules,
    });
    expect(subjects[0].yearlyAveragePercent).toBe(50);
    expect(subjects[0].yearlyTotalRawObtained).toBe(150);
    expect(subjects[0].yearlyTotalRawMax).toBe(300);
  });

  it('ignores terms in which a subject was not examined', () => {
    const { subjects } = buildYearlyReportCardSubjects({
      unionSubjectIds: ['ART'],
      subjectNameById: new Map([['ART', 'Art']]),
      teachingTerms: [
        { termId: 't1', termName: 'Term 1', exams: [exam('ART', 'CAT', 30, 24), exam('ART', 'EXAM', 70, 56)] },
        { termId: 't2', termName: 'Term 2', exams: [exam('ART', 'CAT', 30, 24), exam('ART', 'EXAM', 70, 56)] },
        { termId: 't3', termName: 'Term 3', exams: [] },
      ],
      studentId: 's1',
      policyByTermAndSubject: new Map(),
      defaultPolicy,
      gradingRules: rules,
    });
    expect(subjects[0].yearlyAveragePercent).toBe(80);
    expect(subjects[0].decision).toBe('PASS');
  });
});
