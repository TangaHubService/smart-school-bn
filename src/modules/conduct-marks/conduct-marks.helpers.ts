import { prisma } from '../../db/prisma';

export const DEFAULT_CONDUCT_TOTAL_MARKS = 100;

export type ConductNumbers = {
  finalScore: number;
  totalMarks: number;
  remark: string | null;
};

function conductLedgerKey(termId: string, classRoomId: string, studentId: string) {
  return `${termId}:${classRoomId}:${studentId}`;
}

/**
 * Per-student term conduct: totalMarks from ConductTermSetting (default 100) minus sum of deductions;
 * remark from optional ConductGrade row (teacher note).
 */
export async function loadTermConductNumbersMap(params: {
  tenantId: string;
  academicYearId: string;
  termId: string;
  classRoomId: string;
  studentIds: string[];
}): Promise<Map<string, ConductNumbers>> {
  const { tenantId, academicYearId, termId, classRoomId, studentIds } = params;
  const out = new Map<string, ConductNumbers>();
  if (!studentIds.length) {
    return out;
  }

  const setting = await prisma.conductTermSetting.findUnique({
    where: { tenantId_termId: { tenantId, termId } },
    select: { totalMarks: true },
  });
  const totalMarks = setting?.totalMarks ?? DEFAULT_CONDUCT_TOTAL_MARKS;

  const [deductionRows, gradeRows] = await Promise.all([
    prisma.conductDeduction.findMany({
      where: { tenantId, termId, classRoomId, studentId: { in: studentIds } },
      select: { studentId: true, pointsDeducted: true },
    }),
    prisma.conductGrade.findMany({
      where: { tenantId, academicYearId, termId, classRoomId, studentId: { in: studentIds } },
      select: { studentId: true, remark: true },
    }),
  ]);

  const deductedByStudent = new Map<string, number>();
  for (const d of deductionRows) {
    deductedByStudent.set(d.studentId, (deductedByStudent.get(d.studentId) ?? 0) + d.pointsDeducted);
  }
  const remarkByStudent = new Map(gradeRows.map((g) => [g.studentId, g.remark ?? null]));

  for (const sid of studentIds) {
    const deducted = deductedByStudent.get(sid) ?? 0;
    const finalScore = Math.max(0, totalMarks - deducted);
    out.set(sid, {
      finalScore,
      totalMarks,
      remark: remarkByStudent.get(sid) ?? null,
    });
  }
  return out;
}

export async function loadTermConductDisplayMap(params: {
  tenantId: string;
  academicYearId: string;
  termId: string;
  classRoomId: string;
  studentIds: string[];
}): Promise<Map<string, { grade: string; remark: string | null }>> {
  const nums = await loadTermConductNumbersMap(params);
  return new Map(
    [...nums].map(([id, n]) => [id, { grade: `${n.finalScore}/${n.totalMarks}`, remark: n.remark }]),
  );
}

/**
 * Marks ledger page: resolve conduct for many (term, class, student) triples on the current page.
 */
export async function loadLedgerConductDisplayMap(params: {
  tenantId: string;
  keys: Array<{ academicYearId: string; termId: string; classRoomId: string; studentId: string }>;
}): Promise<Map<string, { grade: string; remark: string | null }>> {
  const { tenantId, keys } = params;
  const result = new Map<string, { grade: string; remark: string | null }>();
  if (!keys.length) {
    return result;
  }

  const uniqueTermIds = [...new Set(keys.map((k) => k.termId))];
  const settings = await prisma.conductTermSetting.findMany({
    where: { tenantId, termId: { in: uniqueTermIds } },
    select: { termId: true, totalMarks: true },
  });
  const totalByTerm = new Map(settings.map((s) => [s.termId, s.totalMarks]));

  const orTriple = keys.map((k) => ({
    termId: k.termId,
    classRoomId: k.classRoomId,
    studentId: k.studentId,
  }));

  const [deductionRows, gradeRows] = await Promise.all([
    prisma.conductDeduction.findMany({
      where: { tenantId, OR: orTriple },
      select: { termId: true, classRoomId: true, studentId: true, pointsDeducted: true },
    }),
    prisma.conductGrade.findMany({
      where: {
        tenantId,
        OR: keys.map((k) => ({
          academicYearId: k.academicYearId,
          termId: k.termId,
          classRoomId: k.classRoomId,
          studentId: k.studentId,
        })),
      },
      select: {
        academicYearId: true,
        termId: true,
        classRoomId: true,
        studentId: true,
        remark: true,
      },
    }),
  ]);

  const deductedMap = new Map<string, number>();
  for (const d of deductionRows) {
    const ck = conductLedgerKey(d.termId, d.classRoomId, d.studentId);
    deductedMap.set(ck, (deductedMap.get(ck) ?? 0) + d.pointsDeducted);
  }

  const remarkMap = new Map<string, string | null>();
  for (const g of gradeRows) {
    const ck = conductLedgerKey(g.termId, g.classRoomId, g.studentId);
    remarkMap.set(ck, g.remark ?? null);
  }

  for (const k of keys) {
    const ck = conductLedgerKey(k.termId, k.classRoomId, k.studentId);
    const total = totalByTerm.get(k.termId) ?? DEFAULT_CONDUCT_TOTAL_MARKS;
    const deducted = deductedMap.get(ck) ?? 0;
    const finalScore = Math.max(0, total - deducted);
    result.set(ck, {
      grade: `${finalScore}/${total}`,
      remark: remarkMap.get(ck) ?? null,
    });
  }

  return result;
}

/** Yearly conduct = sum of term final scores / sum of term totals (Term 1–3). */
export async function loadYearlyConductDisplayMap(params: {
  tenantId: string;
  academicYearId: string;
  classRoomId: string;
  teachingTermIds: string[];
  studentIds: string[];
}): Promise<Map<string, { grade: string; remark: string | null }>> {
  const { teachingTermIds, studentIds } = params;
  const out = new Map<string, { grade: string; remark: string | null }>();
  if (!studentIds.length || !teachingTermIds.length) {
    return out;
  }

  const termMaps = await Promise.all(
    teachingTermIds.map((termId) =>
      loadTermConductNumbersMap({
        tenantId: params.tenantId,
        academicYearId: params.academicYearId,
        termId,
        classRoomId: params.classRoomId,
        studentIds,
      }),
    ),
  );

  for (const sid of studentIds) {
    let sumFinal = 0;
    let sumTotal = 0;
    for (const m of termMaps) {
      const n = m.get(sid);
      if (n) {
        sumFinal += n.finalScore;
        sumTotal += n.totalMarks;
      }
    }
    if (sumTotal <= 0) {
      out.set(sid, { grade: '0/0', remark: null });
    } else {
      out.set(sid, {
        grade: `${sumFinal}/${sumTotal}`,
        remark: `Year total (sum of term conduct): ${sumFinal}/${sumTotal}`,
      });
    }
  }
  return out;
}
