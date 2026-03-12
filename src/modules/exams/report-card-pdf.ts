import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

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
  };
  academicYear: { name: string };
  term: { name: string };
  classRoom: { code: string; name: string };
  student: { studentCode: string; firstName: string; lastName: string };
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
      marksObtained: number;
      totalMarks: number;
      percentage: number;
    }>;
  }>;
}

interface ReportCardPdfOptions {
  verificationCode: string;
  verificationUrl: string;
}

function drawBox(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  fillColor?: string,
) {
  doc.save();
  if (fillColor) {
    doc.rect(x, y, width, height).fillAndStroke(fillColor, '#111827');
  } else {
    doc.rect(x, y, width, height).stroke('#111827');
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
    .fillColor(options.color ?? '#111827')
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
  } = {},
) {
  drawBox(doc, x, y, width, height, options.fillColor);
  drawText(
    doc,
    text,
    x + (options.paddingX ?? 6),
    y + (options.paddingY ?? 5),
    width - (options.paddingX ?? 6) * 2,
    {
      size: options.size ?? 9,
      bold: options.bold,
      align: options.align,
      color: options.color,
    },
  );
}

function displayValue(value?: string | number | null) {
  if (value == null || value === '') {
    return 'N/A';
  }
  return String(value);
}

function deriveSchoolLevel(classLabel: string) {
  const match = classLabel.match(/(\d+)/);
  const gradeNumber = match ? Number(match[1]) : null;
  if (!gradeNumber) {
    return 'SCHOOL';
  }
  if (gradeNumber <= 3) {
    return 'LOWER PRIMARY';
  }
  if (gradeNumber <= 6) {
    return 'UPPER PRIMARY';
  }
  return 'SECONDARY';
}

function formatBands(rules: GradingBand[]) {
  return [...rules].sort((left, right) => right.max - left.max || right.min - left.min);
}

export async function buildReportCardPdfBuffer(
  payload: ReportCardPayload,
  options: ReportCardPdfOptions,
) {
  const qrBuffer = await QRCode.toBuffer(options.verificationUrl, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 160,
  });

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 32, size: 'A4' });
    const chunks: Buffer[] = [];
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const outerX = 32;
    const outerY = 32;
    const outerWidth = pageWidth - outerX * 2;
    const outerHeight = pageHeight - outerY * 2;
    const school = payload.school ?? {};
    const rules = formatBands(payload.gradingScheme?.rules ?? []);
    const studentName = `${payload.student.firstName} ${payload.student.lastName}`;
    const schoolTitle = school.displayName ?? payload.schoolName;
    const schoolCode = displayValue(school.registrationNumber ?? school.code);
    const levelLabel = deriveSchoolLevel(payload.classRoom.name || payload.classRoom.code);
    const teacherComment = payload.metadata?.teacherComment ?? payload.totals.remark;
    const generatedAt = payload.metadata?.generatedAt
      ? new Date(payload.metadata.generatedAt)
      : new Date();

    doc.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawBox(doc, outerX, outerY, outerWidth, outerHeight);

    const leftMetaX = 54;
    const leftMetaY = 54;
    const leftMetaWidth = 210;
    drawText(
      doc,
      [
        'REPUBLIC OF RWANDA',
        'MINISTRY OF EDUCATION',
        `DISTRICT : ${displayValue(school.district)}`,
        `School : ${schoolTitle}`,
        `School Code : ${schoolCode}`,
        `E-mail : ${displayValue(school.email)}`,
        `Phone : ${displayValue(school.phone)}`,
      ].join('\n'),
      leftMetaX,
      leftMetaY,
      leftMetaWidth,
      { size: 9.5, lineGap: 1.2 },
    );

    drawBox(doc, 250, 42, 250, 60);
    drawText(doc, 'STUDENT REPORT CARD:', 250, 55, 250, {
      size: 16,
      bold: true,
      align: 'center',
    });
    drawText(doc, levelLabel, 250, 76, 250, {
      size: 14,
      bold: true,
      align: 'center',
    });

    const infoY = 150;
    drawBox(doc, 48, infoY, 500, 48);
    drawText(doc, `Names: ${studentName}`, 58, infoY + 10, 270, {
      size: 11,
      bold: true,
    });
    drawText(doc, `Registration ID: ${payload.student.studentCode}`, 58, infoY + 28, 270, {
      size: 10.5,
      bold: true,
    });
    drawText(
      doc,
      [
        `Academic Year: ${payload.academicYear.name}`,
        `Level: ${levelLabel.replace('LOWER ', '').replace('UPPER ', '')}`,
        `Class: ${payload.classRoom.name}`,
      ].join('\n'),
      368,
      infoY + 8,
      168,
      { size: 10.5, bold: true, align: 'left' },
    );

    const tableX = 48;
    let tableY = 210;
    const columnWidths = [165, 130, 48, 48, 44, 34, 46];
    const headers = ['SUBJECT', 'ASSESSMENTS', 'SCORE', 'MAX', '%', 'GR', 'REMARK'];
    let cursorX = tableX;

    for (let index = 0; index < headers.length; index += 1) {
      drawCell(doc, cursorX, tableY, columnWidths[index], 24, headers[index], {
        fillColor: '#f3f4f6',
        bold: true,
        size: 9.5,
        align: index === 0 ? 'left' : 'center',
      });
      cursorX += columnWidths[index];
    }
    tableY += 24;

    for (const subject of payload.subjects) {
      const assessmentText = subject.exams
        .map((exam) => `${exam.name}: ${exam.marksObtained}/${exam.totalMarks}`)
        .join('\n');
      const subjectScore = subject.exams.reduce((sum, exam) => sum + exam.marksObtained, 0);
      const subjectMax = subject.exams.reduce((sum, exam) => sum + exam.totalMarks, 0);
      const rowHeight = Math.max(
        28,
        doc.heightOfString(assessmentText, {
          width: columnWidths[1] - 12,
        }) + 10,
      );

      cursorX = tableX;
      drawCell(doc, cursorX, tableY, columnWidths[0], rowHeight, subject.subjectName, {
        size: 9.5,
        bold: true,
      });
      cursorX += columnWidths[0];
      drawCell(doc, cursorX, tableY, columnWidths[1], rowHeight, assessmentText, {
        size: 8.2,
      });
      cursorX += columnWidths[1];
      drawCell(doc, cursorX, tableY, columnWidths[2], rowHeight, subjectScore.toFixed(1), {
        size: 9.2,
        bold: true,
        align: 'center',
      });
      cursorX += columnWidths[2];
      drawCell(doc, cursorX, tableY, columnWidths[3], rowHeight, String(subjectMax), {
        size: 9.2,
        bold: true,
        align: 'center',
      });
      cursorX += columnWidths[3];
      drawCell(doc, cursorX, tableY, columnWidths[4], rowHeight, subject.averagePercentage.toFixed(1), {
        size: 9.2,
        align: 'center',
      });
      cursorX += columnWidths[4];
      drawCell(doc, cursorX, tableY, columnWidths[5], rowHeight, subject.grade, {
        size: 9.5,
        bold: true,
        align: 'center',
      });
      cursorX += columnWidths[5];
      drawCell(doc, cursorX, tableY, columnWidths[6], rowHeight, subject.remark, {
        size: 8.6,
        align: 'center',
      });
      tableY += rowHeight;
    }

    const summaryRows: Array<[string, string]> = [
      ['Total', `${payload.totals.totalMarksObtained.toFixed(1)} / ${payload.totals.totalMarksPossible}`],
      ['Percentage', `${payload.totals.averagePercentage.toFixed(1)} %`],
      ['Final Grade', payload.totals.grade],
      ['Position', `${payload.totals.position} out of ${payload.totals.classSize}`],
    ];
    if (payload.conduct) {
      summaryRows.push(['Conduct', `${payload.conduct.grade}${payload.conduct.remark ? ` - ${payload.conduct.remark}` : ''}`]);
    }

    for (const [label, value] of summaryRows) {
      drawCell(doc, tableX, tableY, 180, 22, label, {
        fillColor: '#f3f4f6',
        bold: true,
        size: 9.5,
      });
      drawCell(doc, tableX + 180, tableY, 335, 22, value, {
        bold: true,
        size: 9.5,
        align: 'center',
      });
      tableY += 22;
    }

    drawCell(doc, tableX, tableY, 330, 92, `Comment\n\n${teacherComment}`, {
      size: 9.3,
      paddingY: 6,
    });
    drawCell(
      doc,
      tableX + 330,
      tableY,
      185,
      92,
      [
        'Verification',
        '',
        `Code: ${options.verificationCode}`,
        `Issued: ${generatedAt.toLocaleDateString('en-RW')}`,
        '',
        'Scan the QR code below to validate this report card.',
      ].join('\n'),
      {
        size: 9,
        paddingY: 6,
      },
    );
    tableY += 92;

    drawCell(
      doc,
      tableX,
      tableY,
      257.5,
      24,
      `Class Teacher Signature: ${displayValue(payload.metadata?.classTeacherName)}`,
      { size: 9.2, bold: true },
    );
    drawCell(doc, tableX + 257.5, tableY, 257.5, 24, 'Parent Signature:', {
      size: 9.2,
      bold: true,
    });
    tableY += 36;

    const gradingScaleWidth = 380;
    drawBox(doc, tableX, tableY, gradingScaleWidth, 86);
    drawText(doc, 'Grading scale', tableX + 8, tableY + 10, 110, {
      size: 11,
      bold: true,
    });

    if (rules.length) {
      const labelColumnWidth = 96;
      const bandColumnWidth = (gradingScaleWidth - labelColumnWidth) / rules.length;
      const bandStartX = tableX + labelColumnWidth;
      const rangeY = tableY;
      const gradeY = tableY + 28;
      const remarkY = tableY + 56;

      drawCell(doc, tableX, rangeY, labelColumnWidth, 28, 'Range', {
        fillColor: '#f3f4f6',
        bold: true,
      });
      drawCell(doc, tableX, gradeY, labelColumnWidth, 28, 'Grade', {
        fillColor: '#f3f4f6',
        bold: true,
      });
      drawCell(doc, tableX, remarkY, labelColumnWidth, 30, 'Remark', {
        fillColor: '#f3f4f6',
        bold: true,
      });

      rules.forEach((rule, index) => {
        const x = bandStartX + bandColumnWidth * index;
        drawCell(doc, x, rangeY, bandColumnWidth, 28, `${rule.min}-${rule.max}`, {
          size: 8.6,
          align: 'center',
        });
        drawCell(doc, x, gradeY, bandColumnWidth, 28, rule.grade, {
          size: 9.2,
          bold: true,
          align: 'center',
        });
        drawCell(doc, x, remarkY, bandColumnWidth, 30, rule.remark ?? '', {
          size: 7.8,
          align: 'center',
        });
      });
    }

    const qrBoxX = tableX + gradingScaleWidth + 16;
    drawBox(doc, qrBoxX, tableY, 119, 158);
    drawText(doc, 'Scan to verify', qrBoxX + 10, tableY + 10, 99, {
      size: 10,
      bold: true,
      align: 'center',
    });
    doc.image(qrBuffer, qrBoxX + 14, tableY + 30, {
      fit: [92, 92],
      align: 'center',
      valign: 'center',
    });
    drawText(doc, options.verificationCode, qrBoxX + 10, tableY + 124, 99, {
      size: 8.5,
      bold: true,
      align: 'center',
    });
    drawText(doc, 'Generated by Smart School Rwanda', qrBoxX + 8, tableY + 140, 103, {
      size: 7.5,
      align: 'center',
      color: '#475569',
    });

    const footerY = pageHeight - 122;
    drawBox(doc, 48, footerY, 500, 84);
    drawText(doc, 'Final decision', 56, footerY + 10, 100, {
      size: 11,
      bold: true,
    });
    drawText(
      doc,
      [
        'Abbreviations',
        'GR : Grade',
        '% : Percentage',
        'MAX : Maximum marks',
        'TOT : Total marks',
      ].join('\n'),
      170,
      footerY + 10,
      160,
      {
        size: 9.2,
        bold: true,
      },
    );
    drawText(doc, 'HEADTEACHER', 360, footerY + 10, 90, {
      size: 11,
      bold: true,
      align: 'center',
    });
    drawText(doc, schoolTitle, 340, footerY + 48, 130, {
      size: 9.8,
      bold: true,
      align: 'center',
    });
    drawText(doc, 'Signature', 474, footerY + 10, 60, {
      size: 11,
      align: 'center',
    });

    doc.end();
  });
}
