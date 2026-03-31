import type { MarkStatus } from '@prisma/client';
import PDFDocument from 'pdfkit';

type GradingBand = {
  min: number;
  max: number;
  grade: string;
  remark?: string;
};

export interface ReportCardPayload {
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
  /** When set, yearly PDF uses Term 1–3 + year summary columns (see subjects[].yearlyTermBreakdown). */
  yearlyReport?: {
    layout: 'three_terms';
    caMaxPerTerm: number;
    examMaxPerTerm: number;
    yearGradeMethod?: string;
    yearRawMethod?: string;
  };
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

function drawBox(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  fillColor?: string,
  lineWidth = 0.5,
) {
  doc.save();
  doc.lineWidth(lineWidth);
  if (fillColor) {
    doc.rect(x, y, width, height).fillAndStroke(fillColor, '#000000');
  } else {
    doc.rect(x, y, width, height).stroke('#000000');
  }
  doc.restore();
}

function drawText(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  width: number,
  options: {
    size?: number;
    bold?: boolean;
    align?: 'left' | 'center' | 'right';
    color?: string;
    lineGap?: number;
  } = {},
) {
  doc
    .font(options.bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(options.size ?? 10)
    .fillColor(options.color ?? '#000000')
    .text(text, x, y, {
      width,
      align: options.align ?? 'left',
      lineGap: options.lineGap ?? 0,
    });
}

function drawCell(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  options: {
    fillColor?: string;
    size?: number;
    bold?: boolean;
    align?: 'left' | 'center' | 'right';
    color?: string;
    paddingX?: number;
    paddingY?: number;
    lineWidth?: number;
    /** Tighter horizontal padding in narrow columns (full text wraps; no truncation). */
    compact?: boolean;
  } = {},
) {
  const px = options.paddingX ?? (options.compact ? 2 : 4);
  const py = options.paddingY ?? (options.compact ? 3 : 4);
  const innerW = width - px * 2;
  drawBox(doc, x, y, width, height, options.fillColor, options.lineWidth ?? 0.5);
  drawText(
    doc,
    text,
    x + px,
    y + py,
    innerW,
    {
      size: options.size ?? 8.5,
      bold: options.bold,
      align: options.align,
      color: options.color,
    },
  );
}

/**
 * Term table header: [max CAT|EXAM|TOTAL] | thick sep | [obt CAT|EXAM|TOTAL] | Rank | Comments
 * First triple = caps; second triple = marks (same labels as official form).
 */
function drawTermTableHeader(
  doc: PDFKit.PDFDocument,
  tableX: number,
  y: number,
  colW: number[],
  headerFill: string,
  headerH: number,
): number {
  drawCell(doc, tableX, y, colW[0], headerH, 'SUBJECT', {
    fillColor: headerFill,
    bold: true,
    size: 8.5,
    align: 'left',
    paddingY: 5,
  });
  const labels = ['CAT', 'EXAM', 'TOTAL', 'CAT', 'EXAM', 'TOTAL', 'Rank', 'Comments'];
  let gx = tableX + colW[0];
  for (let i = 0; i < labels.length; i += 1) {
    drawCell(doc, gx, y, colW[1 + i], headerH, labels[i], {
      fillColor: headerFill,
      bold: true,
      size: i < 6 ? 7.8 : 7.5,
      align: 'center',
      paddingY: 5,
      compact: true,
    });
    gx += colW[1 + i];
  }
  const sepX = tableX + colW[0] + colW[1] + colW[2] + colW[3];
  drawThickColumnSeparator(doc, sepX, y, headerH);
  return headerH;
}

/** Same six-cell layout as term (raw CAT / EXAM / TOTAL max then obtained) from yearly term breakdown. */
function yearlyTermBreakdownSixCells(
  t:
    | {
        caMax: number;
        caObtained: number;
        examMax: number;
        examObtained: number;
      }
    | undefined,
): [string, string, string, string, string, string] {
  if (!t) {
    return ['—', '—', '—', '—', '—', '—'];
  }
  const mCat = t.caMax;
  const mEx = t.examMax;
  const mTot = mCat + mEx;
  const oCat = t.caObtained;
  const oEx = t.examObtained;
  const oTot = oCat + oEx;
  return [String(mCat), String(mEx), String(mTot), String(oCat), String(oEx), String(oTot)];
}

/**
 * Yearly: same grid as term report (CAT/EXAM/TOTAL max | thick sep | obt) × 3 terms,
 * then Year avg, Year total (max / Σ / %), Rank, Comments.
 * Row0 = term band labels + Year bands; Row1 = same labels as term (CAT…TOTAL × 2).
 */
function drawYearlyTableHeader(
  doc: PDFKit.PDFDocument,
  tableX: number,
  y: number,
  colWY: number[],
  headerFill: string,
  h0: number,
  h1: number,
  termBandLabels: [string, string, string],
): number {
  const headerH = h0 + h1;
  const y1 = y + h0;

  drawCell(doc, tableX, y, colWY[0], headerH, 'SUBJECT', {
    fillColor: headerFill,
    bold: true,
    size: 7.5,
    align: 'left',
    paddingY: 4,
  });

  let gx = tableX + colWY[0];
  for (let t = 0; t < 3; t += 1) {
    const o = 1 + t * 6;
    const bandW = colWY[o] + colWY[o + 1] + colWY[o + 2] + colWY[o + 3] + colWY[o + 4] + colWY[o + 5];
    drawCell(doc, gx, y, bandW, h0, termBandLabels[t], {
      fillColor: headerFill,
      bold: true,
      size: 7.5,
      align: 'center',
      paddingY: 3,
    });
    gx += bandW;
  }

  drawCell(doc, gx, y, colWY[19], h0, 'Year avg', {
    fillColor: headerFill,
    bold: true,
    size: 6.8,
    align: 'center',
    paddingY: 2,
  });
  gx += colWY[19];
  drawCell(doc, gx, y, colWY[20] + colWY[21] + colWY[22], h0, 'Year total', {
    fillColor: headerFill,
    bold: true,
    size: 6.8,
    align: 'center',
    paddingY: 2,
  });
  gx += colWY[20] + colWY[21] + colWY[22];
  drawCell(doc, gx, y, colWY[23], h0 + h1, 'Rank', {
    fillColor: headerFill,
    bold: true,
    size: 7.5,
    align: 'center',
    paddingY: 5,
  });
  gx += colWY[23];
  drawCell(doc, gx, y, colWY[24], h0 + h1, 'Comments', {
    fillColor: headerFill,
    bold: true,
    size: 7.5,
    align: 'center',
    paddingY: 5,
  });

  gx = tableX + colWY[0];
  const labels = ['CAT', 'EXAM', 'TOTAL', 'CAT', 'EXAM', 'TOTAL'];
  for (let t = 0; t < 3; t += 1) {
    const o = 1 + t * 6;
    for (let i = 0; i < 6; i += 1) {
      drawCell(doc, gx, y1, colWY[o + i], h1, labels[i], {
        fillColor: headerFill,
        bold: true,
        size: i < 3 ? 7.8 : 7.5,
        align: 'center',
        paddingY: 5,
        compact: true,
      });
      gx += colWY[o + i];
    }
    const sepX =
      tableX + colWY[0] + colWY[o] + colWY[o + 1] + colWY[o + 2];
    drawThickColumnSeparator(doc, sepX, y, headerH);
  }

  drawCell(doc, gx, y1, colWY[19], h1, 'AVG', {
    fillColor: headerFill,
    bold: true,
    size: 7.5,
    align: 'center',
    paddingY: 5,
    compact: true,
  });
  gx += colWY[19];
  drawCell(doc, gx, y1, colWY[20], h1, 'max', {
    fillColor: headerFill,
    bold: true,
    size: 7.5,
    align: 'center',
    paddingY: 5,
    compact: true,
  });
  drawCell(doc, gx + colWY[20], y1, colWY[21], h1, 'Σ', {
    fillColor: headerFill,
    bold: true,
    size: 7.5,
    align: 'center',
    paddingY: 5,
    compact: true,
  });
  drawCell(doc, gx + colWY[20] + colWY[21], y1, colWY[22], h1, '%', {
    fillColor: headerFill,
    bold: true,
    size: 7.5,
    align: 'center',
    paddingY: 5,
    compact: true,
  });

  return headerH;
}

/** Draw thick separators between max and obtained blocks for each term column (yearly table). */
function drawYearlyRowThickSeparators(
  doc: PDFKit.PDFDocument,
  tableX: number,
  y: number,
  rowH: number,
  colWY: number[],
) {
  for (let t = 0; t < 3; t += 1) {
    const o = 1 + t * 6;
    const sepX = tableX + colWY[0] + colWY[o] + colWY[o + 1] + colWY[o + 2];
    drawThickColumnSeparator(doc, sepX, y, rowH);
  }
}

function displayValue(value?: string | number | null) {
  if (value == null || value === '') {
    return '—';
  }
  return String(value);
}

/** Six mark cells: max CAT/EXAM/TOTAL then obtained CAT/EXAM/TOTAL (screenshot layout). */
function termMaxObtSixColumns(
  catEx: { totalMarks: number; marksObtained: number | null } | undefined,
  exPaper: { totalMarks: number; marksObtained: number | null } | undefined,
  useRawMarks: boolean,
  caPct: number | null,
  exPct: number | null,
  totPct: number,
): {
  cells: [string, string, string, string, string, string];
  nums: {
    mCat: number;
    mEx: number;
    mTot: number;
    oCat: number;
    oEx: number;
    oTot: number;
  } | null;
} {
  if (
    useRawMarks &&
    catEx &&
    exPaper &&
    catEx.totalMarks > 0 &&
    exPaper.totalMarks > 0
  ) {
    const mCat = catEx.totalMarks;
    const mEx = exPaper.totalMarks;
    const mTot = mCat + mEx;
    const hasO =
      catEx.marksObtained != null &&
      exPaper.marksObtained != null;
    const oCat = hasO ? catEx.marksObtained! : null;
    const oEx = hasO ? exPaper.marksObtained! : null;
    const oTot = hasO ? oCat! + oEx! : null;
    return {
      cells: [
        String(mCat),
        String(mEx),
        String(mTot),
        hasO ? String(oCat) : '—',
        hasO ? String(oEx) : '—',
        hasO ? String(oTot) : '—',
      ],
      nums: hasO ? { mCat, mEx, mTot, oCat: oCat!, oEx: oEx!, oTot: oTot! } : null,
    };
  }
  const mCat = 100;
  const mEx = 100;
  const mTot = 200;
  const oCat = caPct ?? NaN;
  const oEx = exPct ?? NaN;
  const oTot = totPct;
  return {
    cells: [
      String(mCat),
      String(mEx),
      String(mTot),
      caPct != null && !Number.isNaN(caPct) ? caPct.toFixed(1) : '—',
      exPct != null && !Number.isNaN(exPct) ? exPct.toFixed(1) : '—',
      totPct.toFixed(1),
    ],
    nums:
      caPct != null && exPct != null
        ? { mCat, mEx, mTot, oCat: caPct, oEx: exPct, oTot }
        : null,
  };
}

/** Double vertical rule between max-mark and obtained-mark blocks (MoE-style). */
function drawThickColumnSeparator(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  height: number,
) {
  doc.save();
  doc.strokeColor('#000000');
  doc.lineWidth(1.1);
  doc.moveTo(x, y).lineTo(x, y + height).stroke();
  doc.moveTo(x + 2.2, y).lineTo(x + 2.2, y + height).stroke();
  doc.restore();
}

function formatBorn(iso?: string | null): string {
  if (!iso) {
    return '';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Double horizontal rules (full width), like the official form */
function drawDoubleRule(doc: PDFKit.PDFDocument, x: number, y: number, width: number) {
  doc.save();
  doc.lineWidth(0.75);
  doc.strokeColor('#000000');
  doc.moveTo(x, y).lineTo(x + width, y).stroke();
  doc.moveTo(x, y + 2.5).lineTo(x + width, y + 2.5).stroke();
  doc.restore();
}

function drawOuterFrame(
  doc: PDFKit.PDFDocument,
  outerX: number,
  margin: number,
  contentW: number,
  pageHeight: number,
) {
  doc.save();
  doc.lineWidth(1.25);
  doc.strokeColor('#000000');
  doc.rect(outerX, margin, contentW, pageHeight - margin * 2).stroke();
  doc.restore();
}

function isYearlyThreeTermReport(payload: ReportCardPayload): boolean {
  return (
    payload.yearlyReport?.layout === 'three_terms' &&
    payload.subjects.length > 0 &&
    Array.isArray(payload.subjects[0].yearlyTermBreakdown) &&
    (payload.subjects[0].yearlyTermBreakdown?.length ?? 0) >= 3
  );
}

/**
 * Official-style report card: full page width, bordered grid, no QR/verification.
 * Layout matches the MoE / Smart School Rwanda paper form.
 * Yearly (three-term) cards use landscape A4 so the wide marks grid fits without clipping.
 */
export function buildReportCardPdfBuffer(payload: ReportCardPayload): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const yearlyLandscape = isYearlyThreeTermReport(payload);
    const doc = new PDFDocument({
      size: 'A4',
      layout: yearlyLandscape ? 'landscape' : 'portrait',
      margin: 0,
    });
    const chunks: Buffer[] = [];
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 8;
    const contentW = pageWidth - margin * 2;
    const outerX = margin;
    const school = payload.school ?? {};
    const studentName = `${payload.student.firstName} ${payload.student.lastName}`.trim();
    const schoolTitle = (school.displayName ?? payload.schoolName).toUpperCase();
    const schoolCodeOrPhone = displayValue(school.phone ?? school.registrationNumber ?? school.code);
    const district = displayValue(school.district);
    const teacherComment = payload.metadata?.teacherComment ?? payload.totals.remark;
    const conductText = payload.conduct
      ? `${payload.conduct.grade}${payload.conduct.remark ? ` (${payload.conduct.remark})` : ''}`
      : '';

    doc.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    let y = margin;

    const innerPad = 6;
    drawOuterFrame(doc, outerX, margin, contentW, pageHeight);

    const innerX = outerX + innerPad;
    const innerW = contentW - innerPad * 2;
    y += innerPad;

    // —— Header: left block | right block (screenshot) ——
    const headMid = innerW * 0.52;
    const leftW = headMid;
    const rightW = innerW - headMid;
    const headH = 11;
    drawText(doc, 'REPUBLIC OF RWANDA', innerX, y, leftW, { size: 9.5, bold: true });
    drawText(doc, 'MINISTRY OF EDUCATION', innerX + headMid, y, rightW, {
      size: 9.5,
      bold: true,
      align: 'right',
    });
    y += headH + 2;
    drawText(doc, schoolTitle, innerX, y, leftW, { size: 10, bold: true });
    drawText(doc, `School Year: ${payload.academicYear.name}`, innerX, y, innerW, {
      size: 10,
      bold: true,
      align: 'right',
    });
    y += headH + 2;
    drawText(doc, district, innerX, y, leftW, { size: 10, bold: true });
    drawText(doc, payload.term.name, innerX, y, innerW, { size: 10, bold: true, align: 'right' });
    y += headH + 2;
    drawText(doc, schoolCodeOrPhone, innerX, y, leftW, { size: 10, bold: true });
    y += headH + 6;

    // REPORT CARD between double rules (full inner width)
    drawDoubleRule(doc, innerX, y, innerW);
    y += 6;
    drawText(doc, 'REPORT CARD', innerX, y, innerW, { size: 14, bold: true, align: 'center' });
    y += 18;
    drawDoubleRule(doc, innerX, y, innerW);
    y += 10;

    // —— Student info: bordered rows (screenshot) ——
    const bornStr = formatBorn(payload.student.dateOfBirth);
    const row1H = 22;
    const split = innerW * 0.58;
    drawCell(doc, innerX, y, split, row1H, `Student Name: ${studentName}`, {
      size: 9.5,
      bold: false,
      paddingY: 5,
    });
    drawCell(doc, innerX + split, y, innerW - split, row1H, `Class: ${(payload.classRoom.name || payload.classRoom.code).toUpperCase()}`, {
      size: 9.5,
      bold: false,
      paddingY: 5,
    });
    y += row1H;

    const row2H = 22;
    const bornPart = bornStr ? `${bornStr}` : '';
    const row2Text = `Born: ${bornPart || '        '} at ${'        '}    N. Students: ${payload.totals.classSize}    Conduct: ${conductText || '        '}`;
    drawCell(doc, innerX, y, innerW, row2H, row2Text, { size: 9, paddingY: 5 });
    y += row2H;

    const row3H = 20;
    drawCell(doc, innerX, y, innerW, row3H, `ID No.: ${payload.student.studentCode}`, {
      size: 9.5,
      paddingY: 4,
    });
    y += row3H + 4;

    const tableX = innerX;
    const rowH = 22;
    const headerFill = '#eeeeee';

    if (yearlyLandscape) {
      const weightsY = [
        2.05,
        ...Array.from({ length: 18 }, () => 0.52),
        0.44,
        0.4,
        0.4,
        0.4,
        0.55,
        1.9,
      ];
      const wSumY = weightsY.reduce((a, b) => a + b, 0);
      const colWY = weightsY.map((w) => (w / wSumY) * innerW);
      const h0y = 11;
      const h1y = 13;
      const br0 = payload.subjects[0].yearlyTermBreakdown ?? [];
      const termBandLabels: [string, string, string] = [
        br0[0]?.termName?.trim() || 'Term 1',
        br0[1]?.termName?.trim() || 'Term 2',
        br0[2]?.termName?.trim() || 'Term 3',
      ];
      const headerH = drawYearlyTableHeader(
        doc,
        tableX,
        y,
        colWY,
        headerFill,
        h0y,
        h1y,
        termBandLabels,
      );
      y += headerH;

      let cx = tableX;

      const accT: [number, number, number, number, number, number][] = [
        [0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0],
      ];
      const nPerTerm = [0, 0, 0];
      let sumYrAvg = 0;
      let sumYrMax = 0;
      let sumYrObt = 0;
      let sumYrPct = 0;
      let nYr = 0;

      const addTermNums = (
        ti: number,
        t:
          | {
              caMax: number;
              caObtained: number;
              examMax: number;
              examObtained: number;
            }
          | undefined,
      ) => {
        if (!t) {
          return;
        }
        nPerTerm[ti] += 1;
        const mCat = t.caMax;
        const mEx = t.examMax;
        const mTot = mCat + mEx;
        const oCat = t.caObtained;
        const oEx = t.examObtained;
        const oTot = oCat + oEx;
        const row = accT[ti];
        row[0] += mCat;
        row[1] += mEx;
        row[2] += mTot;
        row[3] += oCat;
        row[4] += oEx;
        row[5] += oTot;
      };

      for (const subject of payload.subjects) {
        const br = subject.yearlyTermBreakdown ?? [];
        const t1 = br[0];
        const t2 = br[1];
        const t3 = br[2];
        const s1 = yearlyTermBreakdownSixCells(t1);
        const s2 = yearlyTermBreakdownSixCells(t2);
        const s3 = yearlyTermBreakdownSixCells(t3);
        const cells = [
          subject.subjectName,
          ...s1,
          ...s2,
          ...s3,
          subject.yearlyAveragePercent != null ? subject.yearlyAveragePercent.toFixed(1) : '—',
          subject.yearlyTotalRawMax != null ? String(subject.yearlyTotalRawMax) : '—',
          subject.yearlyTotalRawObtained != null ? String(subject.yearlyTotalRawObtained) : '—',
          subject.yearlyTotalRawPercent != null ? subject.yearlyTotalRawPercent.toFixed(1) : '—',
          '—',
          subject.remark || subject.grade,
        ];
        cx = tableX;
        for (let i = 0; i < cells.length; i += 1) {
          const isCommentsCol = i === 24;
          drawCell(doc, cx, y, colWY[i], rowH, cells[i], {
            size: i === 0 ? 8.5 : 8,
            bold: i === 0,
            align: i === 0 ? 'left' : 'center',
            compact: i !== 0 && !isCommentsCol,
          });
          cx += colWY[i];
        }
        drawYearlyRowThickSeparators(doc, tableX, y, rowH, colWY);
        y += rowH;

        addTermNums(0, t1);
        addTermNums(1, t2);
        addTermNums(2, t3);
        if (subject.yearlyAveragePercent != null) {
          sumYrAvg += subject.yearlyAveragePercent;
          nYr += 1;
        }
        if (subject.yearlyTotalRawMax != null) {
          sumYrMax += subject.yearlyTotalRawMax;
        }
        if (subject.yearlyTotalRawObtained != null) {
          sumYrObt += subject.yearlyTotalRawObtained;
        }
        if (subject.yearlyTotalRawPercent != null) {
          sumYrPct += subject.yearlyTotalRawPercent;
        }

        if (y > pageHeight - margin - 160) {
          doc.addPage();
          drawOuterFrame(doc, outerX, margin, contentW, pageHeight);
          y = margin + innerPad;
        }
      }

      const avgY = nYr ? sumYrAvg / nYr : 0;
      const nYrMax = payload.subjects.filter((s) => s.yearlyTotalRawMax != null).length;
      const nYrObt = payload.subjects.filter((s) => s.yearlyTotalRawObtained != null).length;
      const nYrPct = payload.subjects.filter((s) => s.yearlyTotalRawPercent != null).length;
      const totCells = [
        'Avg',
        ...accT.flatMap((row, ti) =>
          nPerTerm[ti]
            ? row.map((v) => (v / nPerTerm[ti]).toFixed(1))
            : ['—', '—', '—', '—', '—', '—'],
        ),
        avgY.toFixed(1),
        nYrMax ? (sumYrMax / nYrMax).toFixed(1) : '—',
        nYrObt ? (sumYrObt / nYrObt).toFixed(1) : '—',
        nYrPct ? (sumYrPct / nYrPct).toFixed(1) : '—',
        '—',
        '',
      ];
      cx = tableX;
      for (let i = 0; i < totCells.length; i += 1) {
        drawCell(doc, cx, y, colWY[i], rowH, totCells[i], {
          fillColor: '#f0f0f0',
          bold: true,
          size: 8.5,
          align: i === 0 ? 'left' : 'center',
          compact: i !== 0 && i !== 24,
        });
        cx += colWY[i];
      }
      drawYearlyRowThickSeparators(doc, tableX, y, rowH, colWY);
      y += rowH;

      const avgRow = [
        'Avg',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        `${payload.totals.averagePercentage.toFixed(1)}`,
        '',
        '',
        '',
        `${payload.totals.position}/${payload.totals.classSize}`,
        payload.totals.grade,
      ];
      cx = tableX;
      for (let i = 0; i < avgRow.length; i += 1) {
        drawCell(doc, cx, y, colWY[i], rowH, avgRow[i], {
          fillColor: '#fafafa',
          bold: i === 0,
          size: 7.8,
          align: i === 0 ? 'left' : 'center',
          compact: i !== 0 && i !== 24,
        });
        cx += colWY[i];
      }
      drawYearlyRowThickSeparators(doc, tableX, y, rowH, colWY);
      y += rowH + 6;

      const leftObsW =
        colWY[0] +
        colWY[1] +
        colWY[2] +
        colWY[3] +
        colWY[4] +
        colWY[5] +
        colWY[6] +
        colWY[7] +
        colWY[8] +
        colWY[9] +
        colWY[10] +
        colWY[11] +
        colWY[12] +
        colWY[13] +
        colWY[14] +
        colWY[15] +
        colWY[16] +
        colWY[17] +
        colWY[18] +
        colWY[19] +
        colWY[20] +
        colWY[21] +
        colWY[22];
      const rightSigW = colWY[23] + colWY[24];
      const headSig = 20;
      drawCell(doc, tableX, y, leftObsW, headSig, 'Observations', {
        bold: true,
        size: 9,
        paddingY: 5,
      });
      drawCell(doc, tableX + leftObsW, y, rightSigW, headSig, 'Teacher Signature', {
        bold: true,
        size: 9,
        align: 'center',
        paddingY: 5,
      });
      y += headSig;

      const bodyH = 56;
      drawCell(doc, tableX, y, leftObsW, bodyH, teacherComment, { size: 8.5, paddingY: 6 });
      drawCell(doc, tableX + leftObsW, y, rightSigW, bodyH, displayValue(payload.metadata?.classTeacherName), {
        size: 8,
        align: 'center',
        paddingY: 22,
      });
      y += bodyH;

      const parentRowH = 30;
      drawCell(doc, tableX, y, leftObsW, parentRowH, '', {});
      drawCell(doc, tableX + leftObsW, y, rightSigW, parentRowH, 'Parent Signature', {
        bold: true,
        size: 9,
        align: 'center',
        paddingY: 8,
      });

      doc.end();
      return;
    }

    // —— Grades table: [max CAT|EXAM|TOTAL] | [obt CAT|EXAM|TOTAL] | Rank | Comments ——
    const weights = [2.0, 0.54, 0.54, 0.54, 0.54, 0.54, 0.54, 0.58, 1.88];
    const wSum = weights.reduce((a, b) => a + b, 0);
    const colW = weights.map((w) => (w / wSum) * innerW);
    const termHeaderH = 26;
    const sepXTerm = tableX + colW[0] + colW[1] + colW[2] + colW[3];
    y += drawTermTableHeader(doc, tableX, y, colW, headerFill, termHeaderH);

    let cx = tableX;

    const acc = { mCat: 0, mEx: 0, mTot: 0, oCat: 0, oEx: 0, oTot: 0 };
    let nAcc = 0;

    for (const subject of payload.subjects) {
      const catEx = subject.exams?.find((e) => e.examType === 'CAT');
      const exPaper = subject.exams?.find((e) => e.examType === 'EXAM');
      const useRawMarks = Boolean(
        catEx &&
          exPaper &&
          catEx.marksObtained != null &&
          exPaper.marksObtained != null &&
          catEx.totalMarks > 0 &&
          exPaper.totalMarks > 0,
      );

      const caPct = subject.continuousAssessmentPercent ?? null;
      const exPct = subject.examPercent ?? null;
      const totPct = subject.finalPercent ?? subject.averagePercentage;

      const { cells: six, nums } = termMaxObtSixColumns(
        catEx,
        exPaper,
        useRawMarks,
        caPct,
        exPct,
        totPct,
      );
      if (nums) {
        acc.mCat += nums.mCat;
        acc.mEx += nums.mEx;
        acc.mTot += nums.mTot;
        acc.oCat += nums.oCat;
        acc.oEx += nums.oEx;
        acc.oTot += nums.oTot;
        nAcc += 1;
      }

      const cells = [
        subject.subjectName,
        ...six,
        '—',
        subject.remark || subject.grade,
      ];
      cx = tableX;
      for (let i = 0; i < cells.length; i += 1) {
        drawCell(doc, cx, y, colW[i], rowH, cells[i], {
          size: i === 0 ? 8.5 : 8,
          bold: i === 0,
          align: i === 0 ? 'left' : 'center',
          compact: i !== 0 && i !== 8,
        });
        cx += colW[i];
      }
      drawThickColumnSeparator(doc, sepXTerm, y, rowH);
      y += rowH;

      if (y > pageHeight - margin - 180) {
        doc.addPage();
        drawOuterFrame(doc, outerX, margin, contentW, pageHeight);
        y = margin + innerPad;
      }
    }

    const totalCells = [
      'Avg',
      nAcc ? (acc.mCat / nAcc).toFixed(1) : '—',
      nAcc ? (acc.mEx / nAcc).toFixed(1) : '—',
      nAcc ? (acc.mTot / nAcc).toFixed(1) : '—',
      nAcc ? (acc.oCat / nAcc).toFixed(1) : '—',
      nAcc ? (acc.oEx / nAcc).toFixed(1) : '—',
      nAcc ? (acc.oTot / nAcc).toFixed(1) : '—',
      '—',
      '',
    ];
    cx = tableX;
    for (let i = 0; i < totalCells.length; i += 1) {
      drawCell(doc, cx, y, colW[i], rowH, totalCells[i], {
        fillColor: '#f0f0f0',
        bold: true,
        size: 8.5,
        align: i === 0 ? 'left' : 'center',
        compact: i !== 0 && i !== 8,
      });
      cx += colW[i];
    }
    drawThickColumnSeparator(doc, sepXTerm, y, rowH);
    y += rowH;

    const avgCells = [
      'Avg',
      '',
      '',
      '',
      '',
      '',
      `${payload.totals.averagePercentage.toFixed(1)}`,
      `${payload.totals.position}/${payload.totals.classSize}`,
      payload.totals.grade,
    ];
    cx = tableX;
    for (let i = 0; i < avgCells.length; i += 1) {
      drawCell(doc, cx, y, colW[i], rowH, avgCells[i], {
        fillColor: '#fafafa',
        bold: i === 0,
        size: 7.8,
        align: i === 0 ? 'left' : 'center',
        compact: i !== 0 && i !== 8,
      });
      cx += colW[i];
    }
    drawThickColumnSeparator(doc, sepXTerm, y, rowH);
    y += rowH + 6;

    // Footer: Observations (left) | Teacher (top right) / Parent (bottom right)
    const leftObsW = colW[0] + colW[1] + colW[2] + colW[3] + colW[4] + colW[5] + colW[6];
    const rightSigW = colW[7] + colW[8];
    const headSig = 20;
    drawCell(doc, tableX, y, leftObsW, headSig, 'Observations', {
      bold: true,
      size: 9,
      paddingY: 5,
    });
    drawCell(doc, tableX + leftObsW, y, rightSigW, headSig, 'Teacher Signature', {
      bold: true,
      size: 9,
      align: 'center',
      paddingY: 5,
    });
    y += headSig;

    const bodyH = 56;
    drawCell(doc, tableX, y, leftObsW, bodyH, teacherComment, { size: 8.5, paddingY: 6 });
    drawCell(doc, tableX + leftObsW, y, rightSigW, bodyH, displayValue(payload.metadata?.classTeacherName), {
      size: 8,
      align: 'center',
      paddingY: 22,
    });
    y += bodyH;

    const parentRowH = 30;
    drawCell(doc, tableX, y, leftObsW, parentRowH, '', {});
    drawCell(doc, tableX + leftObsW, y, rightSigW, parentRowH, 'Parent Signature', {
      bold: true,
      size: 9,
      align: 'center',
      paddingY: 8,
    });

    doc.end();
  });
}
