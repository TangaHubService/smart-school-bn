import PDFDocument from 'pdfkit';

type GradingBand = {
  min: number;
  max: number;
  grade: string;
  remark?: string;
};

interface ReportCardPayload {
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
  academicYear: { name: string };
  term: { name: string };
  classRoom: { code: string; name: string };
  student: {
    studentCode: string;
    firstName: string;
    lastName: string;
    dateOfBirth?: string | null;
  };
  gradingScheme?: {
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
  subjects: Array<{
    subjectName: string;
    averagePercentage: number;
    grade: string;
    remark: string;
    exams: Array<{
      name: string;
      examType?: 'CAT' | 'EXAM';
      marksObtained: number;
      totalMarks: number;
      percentage: number;
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
  } = {},
) {
  drawBox(doc, x, y, width, height, options.fillColor, options.lineWidth ?? 0.5);
  drawText(
    doc,
    text,
    x + (options.paddingX ?? 4),
    y + (options.paddingY ?? 4),
    width - (options.paddingX ?? 4) * 2,
    {
      size: options.size ?? 8.5,
      bold: options.bold,
      align: options.align,
      color: options.color,
    },
  );
}

function displayValue(value?: string | number | null) {
  if (value == null || value === '') {
    return '—';
  }
  return String(value);
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

/**
 * Official-style report card: full page width, bordered grid, no QR/verification.
 * Layout matches the MoE / Smart School Rwanda paper form.
 */
export function buildReportCardPdfBuffer(payload: ReportCardPayload): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
    });
    const chunks: Buffer[] = [];
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 14;
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

    const innerPad = 10;
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

    // —— Grades table: column widths fill innerW exactly ——
    const weights = [2.35, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.78, 2.35];
    const wSum = weights.reduce((a, b) => a + b, 0);
    const colW = weights.map((w) => (w / wSum) * innerW);
    const tableX = innerX;
    const headerH = 22;
    const rowH = 21;
    const headerFill = '#eeeeee';

    const headers = ['SUBJECTS', 'TEST', 'EX', 'TOT', 'TEST', 'EX', 'TOT', 'Rank', 'Comments'];
    let cx = tableX;
    for (let i = 0; i < headers.length; i += 1) {
      drawCell(doc, cx, y, colW[i], headerH, headers[i], {
        fillColor: headerFill,
        bold: true,
        size: 8.5,
        align: i === 0 ? 'left' : 'center',
      });
      cx += colW[i];
    }
    y += headerH;

    let sumTest = 0;
    let sumEx = 0;
    let sumTot = 0;

    for (const subject of payload.subjects) {
      const exams = subject.exams ?? [];
      const catExam = exams.find((e) => e.examType === 'CAT');
      const examExam = exams.find((e) => e.examType === 'EXAM');
      const testVal = catExam?.marksObtained ?? null;
      const examVal = examExam?.marksObtained ?? null;
      const testStr = testVal != null ? String(testVal) : '—';
      const examStr = examVal != null ? String(examVal) : '—';
      const tot =
        testVal != null || examVal != null ? (testVal ?? 0) + (examVal ?? 0) : null;
      const totStr =
        tot != null && tot > 0
          ? String(tot)
          : testVal == null && examVal == null
            ? '—'
            : String(tot ?? 0);

      if (testVal != null) {
        sumTest += testVal;
      }
      if (examVal != null) {
        sumEx += examVal;
      }
      if (tot != null) {
        sumTot += tot;
      }

      const cells = [
        subject.subjectName,
        testStr,
        examStr,
        totStr,
        '—',
        '—',
        '—',
        '—',
        subject.remark || subject.grade,
      ];
      cx = tableX;
      for (let i = 0; i < cells.length; i += 1) {
        drawCell(doc, cx, y, colW[i], rowH, cells[i], {
          size: i === 0 ? 8.5 : 8.2,
          bold: i === 0,
          align: i === 0 ? 'left' : 'center',
        });
        cx += colW[i];
      }
      y += rowH;

      if (y > pageHeight - margin - 180) {
        doc.addPage();
        drawOuterFrame(doc, outerX, margin, contentW, pageHeight);
        y = margin + innerPad;
      }
    }

    const totalCells = ['Total', String(sumTest), String(sumEx), String(sumTot), '—', '—', '—', '', ''];
    cx = tableX;
    for (let i = 0; i < totalCells.length; i += 1) {
      drawCell(doc, cx, y, colW[i], rowH, totalCells[i], {
        fillColor: '#f0f0f0',
        bold: true,
        size: 8.5,
        align: i === 0 ? 'left' : 'center',
      });
      cx += colW[i];
    }
    y += rowH;

    const avgCells = [
      'Average',
      '—',
      '—',
      `${payload.totals.averagePercentage.toFixed(1)}%`,
      '—',
      '—',
      '—',
      `${payload.totals.position}/${payload.totals.classSize}`,
      `Grade ${payload.totals.grade} · Lates: — · Absences: —`,
    ];
    cx = tableX;
    for (let i = 0; i < avgCells.length; i += 1) {
      drawCell(doc, cx, y, colW[i], rowH, avgCells[i], {
        fillColor: '#fafafa',
        bold: i === 0,
        size: 7.8,
        align: i === 0 ? 'left' : 'center',
      });
      cx += colW[i];
    }
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
