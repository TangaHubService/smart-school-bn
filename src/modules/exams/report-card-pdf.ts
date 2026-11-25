import type { MarkStatus } from '@prisma/client';
import PDFDocument from 'pdfkit';

import { pdfText } from '../../common/i18n/pdf-text';
import { officialCountryName } from '../locations/eac-countries.constant';
import { qrCodeService } from '../../services/qr-code.service';

/**
 * Report card PDFs, drawn to match the school's official "REPORTS TEMPLATE.xlsx":
 * - term report cards follow the "Term Report" sheet (portrait A4),
 * - yearly report cards follow the "Annual School Report" sheet (portrait A4),
 * - mid-term progress reports follow the "Mid Term Report" sheet (same grid as the term report).
 */

type GradingBand = {
  min: number;
  max: number;
  grade: string;
  remark?: string;
};

/** Extra facts filled in when the PDF is made (not stored in the locked snapshot). */
export interface ReportCardTemplateData {
  /** "Option" on the annual report, e.g. ORDINARY LEVEL (the class's level group). */
  option?: string | null;
  /** Term report: lates and absences recorded during the term. */
  attendance?: { lates: number; absences: number } | null;
  /** Term report: the student's rank in each subject, keyed by subjectId or subject name. */
  subjectRanks?: Record<string, number>;
  /** Subjects marked as core, keyed by subjectId or subject name. */
  coreSubjectKeys?: string[];
  /** Annual report: position, conduct and teacher comment of terms 1–3 (by sequence). */
  terms?: Array<{
    sequence: number;
    position?: number | null;
    classSize?: number | null;
    conduct?: string | null;
    observation?: string | null;
  }>;
  /** Annual report: school logo image (PNG/JPEG bytes). */
  logo?: Buffer | null;
}

export interface ReportCardPayload {
  verificationUrl?: string;
  schoolName: string;
  school?: {
    displayName?: string;
    code?: string | null;
    registrationNumber?: string | null;
    email?: string | null;
    phone?: string | null;
    district?: string | null;
    country?: string | null;
    logoUrl?: string | null;
  };
  academicYear: { id?: string; name: string };
  term: { id?: string; name: string };
  classRoom: { id?: string; code: string; name: string };
  student: {
    id?: string;
    studentCode: string;
    firstName: string;
    lastName: string;
    dateOfBirth?: string | null;
  };
  gradingScheme?: {
    id?: string;
    name: string;
    version: number;
    rules?: GradingBand[];
  };
  metadata?: {
    teacherComment?: string;
    classTeacherName?: string | null;
    generatedAt?: string;
  };
  totals: {
    totalMarksObtained: number;
    totalMarksPossible: number;
    averagePercentage: number;
    grade: string;
    remark: string;
    position: number;
    classSize: number;
  };
  conduct?: { grade: string; remark?: string | null };
  /** When set, the PDF uses the annual layout (see subjects[].yearlyTermBreakdown). */
  yearlyReport?: {
    layout: 'three_terms';
    caMaxPerTerm: number;
    examMaxPerTerm: number;
    yearGradeMethod?: string;
    yearRawMethod?: string;
  };
  /** Render-time only; see ReportCardTemplateData. */
  template?: ReportCardTemplateData;
  /** MID_TERM: live progress report built from marks entered so far (not a locked snapshot). */
  reportKind?: 'TERM' | 'MID_TERM';
  subjects: Array<{
    subjectId?: string;
    subjectName: string;
    averagePercentage: number;
    continuousAssessmentPercent?: number;
    examPercent?: number;
    finalPercent?: number;
    passMark?: number;
    decision?: 'PASS' | 'FAIL';
    grade: string;
    remark: string;
    /** Yearly report: one block per term, then year summary. */
    yearlyTermBreakdown?: Array<{
      termName: string;
      caObtained: number;
      caMax: number;
      examObtained: number;
      examMax: number;
      termFinalPercent: number;
    }>;
    yearlyAveragePercent?: number;
    yearlyTotalRawObtained?: number;
    yearlyTotalRawMax?: number;
    yearlyTotalRawPercent?: number;
    exams: Array<{
      examId?: string;
      name: string;
      examType?: 'CAT' | 'EXAM';
      marksObtained: number | null;
      status?: MarkStatus;
      totalMarks: number;
      percentage: number;
      weight?: number;
    }>;
  }>;
}

type Subject = ReportCardPayload['subjects'][number];
type Doc = PDFKit.PDFDocument;
type Align = 'left' | 'center' | 'right';
type Font = 'Helvetica' | 'Helvetica-Bold' | 'Times-Roman' | 'Times-Bold';

const DASH = '-';

// ---------------------------------------------------------------------------
// Drawing primitives
// ---------------------------------------------------------------------------

function line(doc: Doc, x1: number, y1: number, x2: number, y2: number, width = 0.5) {
  doc.save().lineWidth(width).strokeColor('#000000').moveTo(x1, y1).lineTo(x2, y2).stroke().restore();
}

function rect(doc: Doc, x: number, y: number, w: number, h: number, width = 0.5) {
  doc.save().lineWidth(width).strokeColor('#000000').rect(x, y, w, h).stroke().restore();
}

function doubleRule(doc: Doc, x: number, y: number, w: number) {
  line(doc, x, y, x + w, y, 0.9);
  line(doc, x, y + 2.5, x + w, y + 2.5, 0.9);
}

/** One line of text, shrunk until it fits the width, vertically centred in [y, y+h]. */
function text(
  doc: Doc,
  value: string,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { font?: Font; size?: number; align?: Align; pad?: number; minSize?: number } = {}
) {
  value = pdfText(value);
  const pad = opts.pad ?? 2;
  const font = opts.font ?? 'Helvetica';
  let size = opts.size ?? 8;
  const minSize = opts.minSize ?? 5;
  const avail = Math.max(w - pad * 2, 1);
  doc.font(font);
  while (size > minSize && doc.fontSize(size).widthOfString(value) > avail) size -= 0.25;
  doc.fontSize(size).fillColor('#000000');
  let out = value;
  if (doc.widthOfString(out) > avail) {
    while (out.length > 1 && doc.widthOfString(`${out}…`) > avail) out = out.slice(0, -1);
    out = `${out}…`;
  }
  const ty = y + (h - size) / 2 + size * 0.08;
  doc.text(out, x + pad, ty, { width: avail, align: opts.align ?? 'left', lineBreak: false });
}

/** Wrapped text inside a box (for comments / observations). */
function paragraph(doc: Doc, value: string, x: number, y: number, w: number, h: number, size = 8) {
  if (!value) return;
  value = pdfText(value);
  let s = size;
  doc.font('Helvetica');
  while (s > 5.5 && doc.fontSize(s).heightOfString(value, { width: w - 6 }) > h - 4) s -= 0.25;
  doc.fontSize(s).fillColor('#000000').text(value, x + 3, y + 2, { width: w - 6, height: h - 4, ellipsis: true });
}

function cell(
  doc: Doc,
  x: number,
  y: number,
  w: number,
  h: number,
  value: string,
  opts: { font?: Font; size?: number; align?: Align; border?: number; pad?: number } = {}
) {
  if (opts.border !== 0) rect(doc, x, y, w, h, opts.border ?? 0.5);
  if (value) text(doc, value, x, y, w, h, opts);
}

function checkbox(doc: Doc, x: number, y: number, size = 7) {
  rect(doc, x, y, size, size, 0.6);
}

function fmt(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  return Number.isInteger(value) ? String(value) : value.toFixed(decimals);
}

function formatBorn(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function subjectKey(subject: Subject) {
  return subject.subjectId ?? subject.subjectName;
}

function lookup<T>(map: Record<string, T> | undefined, subject: Subject): T | undefined {
  if (!map) return undefined;
  return (subject.subjectId ? map[subject.subjectId] : undefined) ?? map[subject.subjectName];
}

function isYearlyReport(payload: ReportCardPayload) {
  return payload.yearlyReport?.layout === 'three_terms';
}

async function makeQr(url?: string): Promise<string | null> {
  if (!url) return null;
  try {
    return await qrCodeService.generateQrCodeDataUrl(url, {
      width: 600,
      margin: 2,
      // Long (mid-term) links: less redundancy keeps the modules big enough to scan on paper.
      errorCorrectionLevel: url.length > 120 ? 'M' : 'H',
    });
  } catch {
    return null;
  }
}

function schoolLines(payload: ReportCardPayload) {
  const school = payload.school ?? {};
  return {
    state: officialCountryName(school.country).toUpperCase(),
    name: (school.displayName ?? payload.schoolName ?? '').toUpperCase(),
    district: (school.district ?? '').toUpperCase(),
    contact: school.phone ?? school.registrationNumber ?? school.code ?? '',
  };
}

// ---------------------------------------------------------------------------
// Term figures
// ---------------------------------------------------------------------------

interface TermRow {
  max: [number | null, number | null, number | null];
  obt: [number | null, number | null, number | null];
}

function sumExams(exams: Subject['exams']) {
  if (!exams.length) return null;
  const max = exams.reduce((acc, e) => acc + (e.totalMarks || 0), 0);
  const complete = exams.every(e => e.marksObtained != null);
  const obt = complete ? exams.reduce((acc, e) => acc + (e.marksObtained ?? 0), 0) : null;
  return max > 0 ? { max, obt } : null;
}

/** TEST (CAT) / EX (exam) / TOT, as maximum points and obtained points. */
function termRow(subject: Subject): TermRow {
  const test = sumExams(subject.exams?.filter(e => e.examType === 'CAT') ?? []);
  const exam = sumExams(subject.exams?.filter(e => e.examType === 'EXAM') ?? []);
  if (test || exam) {
    const maxTot = (test?.max ?? 0) + (exam?.max ?? 0);
    const obtParts = [test, exam].filter(Boolean) as Array<{ max: number; obt: number | null }>;
    const obtTot = obtParts.every(p => p.obt != null) ? obtParts.reduce((a, p) => a + (p.obt ?? 0), 0) : null;
    return {
      max: [test?.max ?? null, exam?.max ?? null, maxTot],
      obt: [test?.obt ?? null, exam?.obt ?? null, obtTot],
    };
  }
  // No raw marks stored: show percentages out of 100.
  const final = subject.finalPercent ?? subject.averagePercentage;
  return {
    max: [null, null, 100],
    obt: [subject.continuousAssessmentPercent ?? null, subject.examPercent ?? null, final ?? null],
  };
}

function addInto(acc: Array<number | null>, values: Array<number | null>) {
  values.forEach((v, i) => {
    if (v != null) acc[i] = (acc[i] ?? 0) + v;
  });
}

// ---------------------------------------------------------------------------
// Term Report (sheet "Term Report")
// ---------------------------------------------------------------------------

function drawTermReport(doc: Doc, payload: ReportCardPayload, qr: string | null) {
  const M = 28;
  const W = doc.page.width - M * 2;
  const pageBottom = doc.page.height - M;
  const u = W / 13; // template columns B..N
  const X = (i: number) => M + i * u;
  const school = schoolLines(payload);
  const tpl = payload.template ?? {};

  // Header
  let y = 30;
  const lh = 13;
  text(doc, school.state, X(0), y, W / 2, lh, { font: 'Helvetica-Bold', size: 9.5, pad: 0 });
  text(doc, 'MINISTRY OF EDUCATION', X(0), y, W, lh, { font: 'Helvetica-Bold', size: 9.5, align: 'right', pad: 0 });
  y += lh;
  text(doc, school.name, X(0), y, W * 0.55, lh, { size: 9.5, pad: 0 });
  text(doc, `School Year: ${payload.academicYear.name}`, X(0), y, W, lh, { size: 9.5, align: 'right', pad: 0 });
  y += lh;
  text(doc, school.district, X(0), y, W * 0.55, lh, { size: 9.5, pad: 0 });
  text(doc, payload.term.name, X(0), y, W, lh, { size: 9.5, align: 'right', pad: 0 });
  y += lh;
  text(doc, school.contact, X(0), y, W * 0.55, lh, { size: 9.5, pad: 0 });
  y += lh + 3;

  // Title
  doubleRule(doc, X(0), y, W);
  const title = payload.reportKind === 'MID_TERM' ? 'MID TERM - REPORT CARD' : 'REPORT CARD';
  text(doc, title, X(0), y + 3, W, 20, { font: 'Times-Bold', size: 15, align: 'center' });
  doubleRule(doc, X(0), y + 24, W);
  y += 31;

  // Student details
  const rh = 15;
  const studentName = `${payload.student.firstName} ${payload.student.lastName}`.trim();
  text(doc, 'Student Name:', X(0), y, 3 * u, rh, { size: 9.5, pad: 0 });
  rect(doc, X(3), y + 1, 10 * u, rh - 2, 0.7);
  text(doc, studentName, X(3), y + 1, 10 * u, rh - 2, { font: 'Helvetica-Bold', size: 9.5 });
  y += rh;
  text(doc, 'Born:', X(0), y, u, rh, { size: 9.5, pad: 0 });
  text(doc, formatBorn(payload.student.dateOfBirth), X(1), y, 3 * u, rh, { size: 9.5 });
  text(doc, 'at', X(4), y, u, rh, { size: 9.5 });
  text(doc, 'Class:', X(8), y, 2 * u, rh, { size: 9.5 });
  text(doc, payload.classRoom.name || payload.classRoom.code, X(11), y, 2 * u, rh, { size: 9.5 });
  y += rh;
  text(doc, 'ID No.:', X(0), y, u, rh, { size: 9.5, pad: 0 });
  text(doc, payload.student.studentCode, X(1), y, 4 * u, rh, { size: 9.5 });
  text(doc, 'N. Students:', X(5), y, 2 * u, rh, { size: 9.5 });
  text(doc, String(payload.totals.classSize || DASH), X(7), y, u, rh, { size: 9.5, align: 'center' });
  text(doc, 'Conduct:', X(9), y, u * 1.2, rh, { size: 9.5 });
  text(doc, payload.conduct?.grade ?? '', X(10.2), y, 2.8 * u, rh, { size: 9.5 });
  y += rh + 8;

  // Marks table: SUBJECTS | TEST EX TOT (max) || TEST EX TOT (obtained) | Rank | Comments
  const tableTop = y;
  const headH = 16;
  cell(doc, X(0), y, 3 * u, headH, 'SUBJECTS', { font: 'Times-Bold', size: 10 });
  ['TEST', 'EX', 'TOT', 'TEST', 'EX', 'TOT'].forEach((label, i) =>
    cell(doc, X(3 + i), y, u, headH, label, { font: 'Times-Bold', size: 8, align: 'center' })
  );
  cell(doc, X(9), y, u, headH, 'Rank', { font: 'Times-Bold', size: 8, align: 'center' });
  cell(doc, X(10), y, 3 * u, headH, 'Comments', { font: 'Times-Bold', size: 8.5, align: 'center' });
  line(doc, X(0), y + headH, X(13), y + headH, 1.6);
  y += headH;

  // Mid-term QR codes hold more data, so they get a taller footer.
  const footerRowH = payload.reportKind === 'MID_TERM' && qr ? 21 : 16;
  const footerNeeds = 15 + 17 + 18 + footerRowH * 4;
  // One row per subject only: no blank filler rows under the last subject.
  const rowCount = Math.max(payload.subjects.length, 1);
  const rowH = Math.max(10, Math.min(15, (pageBottom - footerNeeds - y) / rowCount));

  const maxTotals: Array<number | null> = [null, null, null];
  const obtTotals: Array<number | null> = [null, null, null];
  for (const subject of payload.subjects) {
    const row = termRow(subject);
    addInto(maxTotals, row.max);
    addInto(obtTotals, row.obt);
    const rank = lookup(tpl.subjectRanks, subject);
    cell(doc, X(0), y, 3 * u, rowH, subject.subjectName.toUpperCase(), { font: 'Times-Roman', size: 9 });
    [...row.max, ...row.obt].forEach((v, i) =>
      cell(doc, X(3 + i), y, u, rowH, fmt(v), { size: 8.5, align: 'center' })
    );
    cell(doc, X(9), y, u, rowH, rank ? String(rank) : DASH, { size: 8.5, align: 'center' });
    cell(doc, X(10), y, 3 * u, rowH, subject.remark || subject.grade || '', { size: 8 });
    y += rowH;
  }

  // Total
  const totalH = 15;
  cell(doc, X(0), y, 3 * u, totalH, 'Total', { font: 'Helvetica-Bold', size: 9 });
  [...maxTotals, ...obtTotals].forEach((v, i) =>
    cell(doc, X(3 + i), y, u, totalH, fmt(v), { font: 'Helvetica-Bold', size: 8.5, align: 'center' })
  );
  cell(doc, X(9), y, 4 * u, totalH, '');
  // double rule between maximum and obtained blocks, header to total
  line(doc, X(6) - 1.2, tableTop, X(6) - 1.2, y + totalH, 0.8);
  line(doc, X(6) + 1.2, tableTop, X(6) + 1.2, y + totalH, 0.8);
  y += totalH;

  // Average | value | Rank | pos/size | Lates | n | Absences | n
  const avgH = 17;
  const att = tpl.attendance;
  cell(doc, X(0), y, 2 * u, avgH, 'Average', { font: 'Helvetica-Bold', size: 9.5 });
  const average = payload.totals.averagePercentage;
  cell(doc, X(2), y, 2 * u, avgH, Number.isFinite(average) ? `${average.toFixed(1)}%` : DASH, {
    font: 'Helvetica-Bold',
    size: 9,
    align: 'center',
  });
  cell(doc, X(4), y, u, avgH, 'Rank', { size: 9, align: 'center' });
  cell(
    doc,
    X(5),
    y,
    u,
    avgH,
    payload.totals.position ? `${payload.totals.position}/${payload.totals.classSize}` : DASH,
    { size: 9, align: 'center' }
  );
  cell(doc, X(6), y, 2 * u, avgH, 'Lates', { size: 9, align: 'center' });
  cell(doc, X(8), y, u, avgH, att ? String(att.lates) : DASH, { size: 9, align: 'center' });
  cell(doc, X(9), y, 3 * u, avgH, 'Absences', { size: 9, align: 'center' });
  cell(doc, X(12), y, u, avgH, att ? String(att.absences) : DASH, { size: 9, align: 'center' });
  rect(doc, X(0), y, W, avgH, 1.8);
  y += avgH;
  rect(doc, X(0), tableTop, W, y - tableTop, 1.6);

  // Observations | Teacher / Parent signature | QR
  y += 18;
  const fh = footerRowH;
  const footerTop = y;
  const footerH = fh * 4;
  cell(doc, X(0), y, 6 * u, fh, 'Observations', { font: 'Helvetica-Bold', size: 9, align: 'center' });
  paragraph(doc, payload.metadata?.teacherComment || payload.totals.remark || '', X(0), y + fh, 6 * u, fh * 3, 8.5);
  text(doc, 'Teacher Signature', X(6), y, 5 * u, fh, { font: 'Helvetica-Bold', size: 9, align: 'center' });
  if (payload.metadata?.classTeacherName) {
    text(doc, payload.metadata.classTeacherName, X(6), y + fh, 5 * u, fh, { size: 8, align: 'center' });
  }
  line(doc, X(6), y + fh * 2.5, X(11), y + fh * 2.5, 0.4);
  text(doc, 'Parent Signature', X(6), y + fh * 3, 5 * u, fh, { font: 'Helvetica-Bold', size: 9, align: 'center' });
  if (qr) {
    const size = Math.min(footerH - 6, 2 * u - 4);
    doc.image(qr, X(11) + (2 * u - size) / 2, footerTop + (footerH - size) / 2, { fit: [size, size] });
  }
  line(doc, X(6), footerTop, X(6), footerTop + footerH, 1.6);
  line(doc, X(0), footerTop + fh, X(6), footerTop + fh, 0.5);
  rect(doc, X(0), footerTop, W, footerH, 1.8);
}

// ---------------------------------------------------------------------------
// Annual School Report (sheet "Annual School Report")
// ---------------------------------------------------------------------------

function drawAnnualReport(doc: Doc, payload: ReportCardPayload, qr: string | null) {
  const M = 24;
  const W = doc.page.width - M * 2;
  const pageBottom = doc.page.height - M;
  const subjectWeight = 2.7;
  const u = W / (subjectWeight + 17); // template columns A (wide) + B..R
  const subjW = subjectWeight * u;
  /** Left edge of template column k (0 = A, 1 = B, … 17 = R, 18 = right edge). */
  const X = (k: number) => (k === 0 ? M : M + subjW + (k - 1) * u);
  const span = (from: number, to: number) => X(to + 1) - X(from);
  const school = schoolLines(payload);
  const tpl = payload.template ?? {};

  // Header: logo on the left, ministry block on the right
  let y = 24;
  if (tpl.logo) {
    try {
      doc.image(tpl.logo, X(3), y, { fit: [86, 86] });
    } catch {
      // unsupported image: leave the space empty
    }
  }
  const hx = X(10);
  const hw = X(16) - hx;
  const lines: Array<[string, number]> = [
    [school.state, 11.5],
    ['MINISTRY OF EDUCATION', 11.5],
    [school.name, 11],
    [school.district, 10],
    [school.contact, 10],
  ];
  let hy = y + 6;
  for (const [value, size] of lines) {
    if (value) text(doc, value, hx, hy, hw + 2 * u, 14, { font: 'Helvetica-Bold', size, pad: 0 });
    hy += 14;
  }
  y = Math.max(hy, y + 90) + 8;

  // Title
  text(doc, 'ANNUAL SCHOOL REPORT', X(0), y, span(0, 15), 24, { font: 'Times-Bold', size: 19, align: 'center' });
  y += 26;
  doubleRule(doc, X(0), y, W);
  y += 12;

  // Student details
  const rh = 14;
  const studentName = `${payload.student.firstName} ${payload.student.lastName}`.trim();
  text(doc, "Student's name:", X(0), y, subjW, rh, { size: 8.5, align: 'right' });
  cell(doc, X(1), y, span(1, 11), rh, studentName, { font: 'Helvetica-Bold', size: 9 });
  text(doc, `School Year: ${payload.academicYear.name}`, X(12), y, span(12, 17), rh, { size: 8.5 });
  y += rh;
  text(doc, "Student's number:", X(0), y, subjW, rh, { size: 8.5, align: 'right' });
  cell(doc, X(1), y, span(1, 11), rh, payload.student.studentCode, { size: 9 });
  y += rh + 6;
  text(doc, 'Class:', X(0), y, subjW, rh, { size: 8.5, align: 'right' });
  text(doc, payload.classRoom.name || payload.classRoom.code, X(1), y, span(1, 6), rh, { font: 'Helvetica-Bold', size: 9 });
  text(doc, 'Option:', X(10), y, u * 1.4, rh, { size: 8.5, align: 'right' });
  text(doc, (tpl.option ?? '').toUpperCase(), X(11) + u * 0.4, y, span(11, 16), rh, { font: 'Times-Roman', size: 8.5 });
  y += rh + 6;

  // Table header (3 rows)
  const tableTop = y;
  const h1 = 11;
  const bold = { font: 'Helvetica-Bold' as Font, size: 7.5, align: 'center' as Align };
  cell(doc, X(0), y, subjW, h1 * 3, 'Subjects', { font: 'Helvetica-Bold', size: 8 });
  cell(doc, X(1), y, span(1, 3), h1 * 2, 'MAX POINTS', bold);
  ['1st TERM', '2nd TERM', '3rd TERM'].forEach((label, t) => {
    const k = 4 + t * 3;
    cell(doc, X(k), y, span(k, k + 2), h1, label, bold);
    cell(doc, X(k), y + h1, span(k, k + 2), h1, 'O.P.', bold);
  });
  cell(doc, X(13), y, span(13, 15), h1, 'ANNUAL POINTS', bold);
  cell(doc, X(13), y + h1, span(13, 14), h1, 'TOT', bold);
  cell(doc, X(15), y + h1, u, h1 * 2, '%', bold);
  cell(doc, X(16), y, span(16, 17), h1 * 2, '2nd SITTING', bold);
  const y3 = y + h1 * 2;
  for (let b = 0; b < 4; b += 1) {
    ['TEST', 'EX', 'TOT'].forEach((label, i) => cell(doc, X(1 + b * 3 + i), y3, u, h1, label, bold));
  }
  cell(doc, X(13), y3, u, h1, 'MAX', bold);
  cell(doc, X(14), y3, u, h1, 'O.P.', bold);
  cell(doc, X(16), y3, u, h1, 'O.P.', bold);
  cell(doc, X(17), y3, u, h1, '%', bold);
  y += h1 * 3;

  // Rows: Core Subjects, then the others
  const coreKeys = new Set(tpl.coreSubjectKeys ?? []);
  const isCore = (s: Subject) => coreKeys.has(subjectKey(s)) || coreKeys.has(s.subjectName);
  const core = payload.subjects.filter(isCore);
  const other = payload.subjects.filter(s => !isCore(s));
  const groups: Array<{ label: string | null; items: Subject[] }> = core.length
    ? [
        { label: 'Core Subjects', items: core },
        ...(other.length ? [{ label: 'Other Subjects', items: other }] : []),
      ]
    : [{ label: null, items: other }];

  const groupRows = groups.filter(g => g.label).length;
  const bodyRows = payload.subjects.length + groupRows + 3; // + TOTAL, %, Position
  const afterTable = 2 * 16 + 12 + 7 * 12 + 10 + 14 + 3 * 18;
  const rowH = Math.max(8, Math.min(12.5, (pageBottom - afterTable - y) / bodyRows));
  const size = Math.min(7.5, rowH - 3);

  // column totals: 0..2 max, 3..11 terms, 12 annual max, 13 annual o.p.
  const totals: Array<number | null> = Array.from({ length: 14 }, () => null);
  const termMaxTotals: Array<number | null> = [null, null, null];

  for (const group of groups) {
    if (group.label) {
      cell(doc, X(0), y, W, rowH, group.label, { font: 'Helvetica-Bold', size: size + 0.5 });
      y += rowH;
    }
    for (const subject of group.items) {
      const terms = subject.yearlyTermBreakdown ?? [];
      const first = terms.find(Boolean);
      const maxTest = first ? first.caMax : null;
      const maxEx = first ? first.examMax : null;
      const values: Array<number | null> = [maxTest, maxEx, first ? first.caMax + first.examMax : null];
      for (let t = 0; t < 3; t += 1) {
        const term = terms[t];
        values.push(term ? term.caObtained : null, term ? term.examObtained : null, term ? term.caObtained + term.examObtained : null);
        if (term) termMaxTotals[t] = (termMaxTotals[t] ?? 0) + term.caMax + term.examMax;
      }
      const annualMax =
        subject.yearlyTotalRawMax ?? (terms.length ? terms.reduce((a, t) => a + t.caMax + t.examMax, 0) : null);
      const annualObt =
        subject.yearlyTotalRawObtained ?? (terms.length ? terms.reduce((a, t) => a + t.caObtained + t.examObtained, 0) : null);
      values.push(annualMax, annualObt);
      addInto(totals, values);
      const pct =
        subject.yearlyTotalRawPercent ??
        (annualMax && annualObt != null ? (annualObt / annualMax) * 100 : subject.yearlyAveragePercent ?? null);

      cell(doc, X(0), y, subjW, rowH, subject.subjectName.toUpperCase(), { size });
      values.forEach((v, i) => cell(doc, X(1 + i), y, u, rowH, fmt(v), { size, align: 'center' }));
      cell(doc, X(15), y, u, rowH, pct != null ? pct.toFixed(1) : DASH, { size, align: 'center' });
      cell(doc, X(16), y, u, rowH, DASH, { size, align: 'center' });
      cell(doc, X(17), y, u, rowH, DASH, { size, align: 'center' });
      y += rowH;
    }
  }

  // TOTAL
  const b = { font: 'Helvetica-Bold' as Font, size, align: 'center' as Align };
  cell(doc, X(0), y, subjW, rowH, 'TOTAL', { font: 'Helvetica-Bold', size });
  totals.forEach((v, i) => cell(doc, X(1 + i), y, u, rowH, fmt(v), b));
  cell(doc, X(15), y, u, rowH, '');
  cell(doc, X(16), y, span(16, 17), rowH, '');
  y += rowH;

  // %
  cell(doc, X(0), y, subjW, rowH, '%', { font: 'Helvetica-Bold', size });
  cell(doc, X(1), y, span(1, 3), rowH, '');
  for (let t = 0; t < 3; t += 1) {
    const k = 4 + t * 3;
    const obt = totals[3 + t * 3 + 2];
    const max = termMaxTotals[t];
    cell(doc, X(k), y, span(k, k + 1), rowH, '');
    cell(doc, X(k + 2), y, u, rowH, obt != null && max ? ((obt / max) * 100).toFixed(1) : '', b);
  }
  cell(doc, X(13), y, span(13, 14), rowH, '');
  cell(doc, X(15), y, u, rowH, `${payload.totals.averagePercentage.toFixed(1)}`, b);
  cell(doc, X(16), y, span(16, 17), rowH, '');
  y += rowH;

  // Position
  const termInfo = (seq: number) => tpl.terms?.find(t => t.sequence === seq);
  cell(doc, X(0), y, subjW, rowH, 'Position', { font: 'Helvetica-Bold', size });
  cell(doc, X(1), y, span(1, 3), rowH, '');
  for (let t = 0; t < 3; t += 1) {
    const k = 4 + t * 3;
    const info = termInfo(t + 1);
    const value = info?.position ? `${info.position} / ${info.classSize ?? DASH}` : '';
    cell(doc, X(k), y, span(k, k + 2), rowH, value, b);
  }
  cell(
    doc,
    X(13),
    y,
    span(13, 15),
    rowH,
    payload.totals.position ? `${payload.totals.position} / ${payload.totals.classSize}` : '',
    b
  );
  cell(doc, X(16), y, span(16, 17), rowH, '');
  y += rowH;

  // Signatures (one box per term block)
  for (const label of ["Teacher's signature", "Parent's signature"]) {
    cell(doc, X(0), y, subjW, 16, label, { size: 7.5 });
    cell(doc, X(1), y, span(1, 3), 16, '');
    for (let t = 0; t < 4; t += 1) cell(doc, X(4 + t * 3), y, span(4 + t * 3, 6 + t * 3), 16, '');
    cell(doc, X(16), y, span(16, 17), 16, '');
    y += 16;
  }

  // thick separators between the blocks, and the outer frame
  const tableBottom = y;
  [1, 4, 7, 10, 13].forEach(k => line(doc, X(k), tableTop, X(k), tableBottom, 1.4));
  line(doc, X(16) - 1.2, tableTop, X(16) - 1.2, tableBottom, 0.8);
  line(doc, X(16) + 1.2, tableTop, X(16) + 1.2, tableBottom, 0.8);
  line(doc, X(0), tableTop + h1 * 3, X(18), tableTop + h1 * 3, 1.2);
  rect(doc, X(0), tableTop, W, tableBottom - tableTop, 1.6);

  // Verdict of the jury
  y += 12;
  const vh = 12;
  const verdictTop = y;
  text(doc, 'VERDICT OF THE JURY', X(0), y, span(0, 2), vh, { font: 'Helvetica-Bold', size: 8.5, pad: 0 });
  const verdicts = ['Promoted', 'Advised to repeat', 'Discontinued', 'Proposed to resit', '', '2nd sitting, promoted', '2nd sitting, advised to repeat'];
  verdicts.forEach((label, i) => {
    const ry = verdictTop + i * vh;
    if (!label) return;
    checkbox(doc, X(3) - 11, ry + 2.5, 7);
    text(doc, label, X(3), ry, span(3, 8), vh, { size: 8 });
  });
  text(doc, 'Headmaster', X(9), verdictTop + 2 * vh, span(9, 14), vh, { size: 8.5 });
  text(doc, '(Name, signature and stamp)', X(9), verdictTop + 3 * vh, span(9, 14), vh, { size: 8 });
  y = verdictTop + verdicts.length * vh + 10;

  // Observations and conduct
  const oh = 18;
  text(doc, 'OBSERVATIONS', X(0), y, subjW, 14, { font: 'Helvetica-Bold', size: 8.5, pad: 0 });
  text(doc, 'CONDUCT', X(10), y, span(10, 13), 14, { font: 'Helvetica-Bold', size: 8.5 });
  const obsTop = y + 14;
  ['1st Term:', '2nd Term:', '3rd Term:'].forEach((label, i) => {
    const ry = obsTop + i * oh;
    const info = termInfo(i + 1);
    text(doc, label, X(0), ry, subjW - 4, oh, { size: 8, align: 'right' });
    rect(doc, X(1), ry, span(1, 8), oh, 0.5);
    paragraph(doc, info?.observation ?? '', X(1), ry, span(1, 8), oh, 7.5);
    text(doc, label, X(10), ry, span(10, 11), oh, { size: 8 });
    text(doc, info?.conduct ?? '', X(12), ry, span(12, 13), oh, { font: 'Helvetica-Bold', size: 8 });
  });
  const totalRow = obsTop + 3 * oh;
  text(doc, 'Total Annual:', X(10), totalRow, span(10, 11), oh, { size: 8 });
  text(doc, payload.conduct?.grade ?? '', X(12), totalRow, span(12, 13), oh, { font: 'Helvetica-Bold', size: 8 });

  if (qr) {
    const qrSize = Math.min(span(15, 17) - 6, totalRow + oh - verdictTop - 4);
    doc.image(qr, X(18) - qrSize - 3, verdictTop + 2, { fit: [qrSize, qrSize] });
  }
}

// ---------------------------------------------------------------------------

/**
 * Builds the report card PDF. Yearly results use the Annual School Report layout,
 * every other term uses the Term Report layout (Mid Term Report for mid-term reports).
 */
export function buildReportCardPdfBuffer(payload: ReportCardPayload): Promise<Buffer> {
  return buildReportCardsPdfBuffer([payload]);
}

/** Several report cards in one PDF, one page each (e.g. a whole class for printing). */
export async function buildReportCardsPdfBuffer(payloads: ReportCardPayload[]): Promise<Buffer> {
  const qrs = await Promise.all(payloads.map(p => makeQr(p.verificationUrl)));
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: 0, autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      payloads.forEach((payload, i) => {
        doc.addPage({ size: 'A4', layout: 'portrait', margin: 0 });
        if (isYearlyReport(payload)) drawAnnualReport(doc, payload, qrs[i]);
        else drawTermReport(doc, payload, qrs[i]);
      });
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
