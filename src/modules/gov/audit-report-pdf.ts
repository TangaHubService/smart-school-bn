import PDFDocument from 'pdfkit';

export interface AuditReportPdfPayload {
  id: string;
  module: string;
  status: string;
  score: number;
  comment: string | null;
  recommendation: string | null;
  reviewNote: string | null;
  school: { displayName: string; province: string | null; district: string | null; sector: string | null };
  auditor: { firstName: string; lastName: string; email: string };
  reviewedBy: { firstName: string; lastName: string } | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  attachments: Array<{ originalName: string }>;
}

function formatModule(value: string): string {
  return value
    .split('_')
    .map(word => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export function buildAuditReportPdfBuffer(payload: AuditReportPdfPayload): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc
      .fontSize(20)
      .font('Helvetica-Bold')
      .text('School Audit Report', { align: 'center' });
    doc.moveDown(0.3);
    doc
      .fontSize(11)
      .font('Helvetica')
      .fillColor('#555')
      .text(`${formatModule(payload.module)} Audit`, { align: 'center' });
    doc.fillColor('#000');
    doc.moveDown(1.2);

    const scoreColor = payload.score >= 80 ? '#15803d' : payload.score >= 60 ? '#b45309' : '#b91c1c';

    doc.fontSize(12).font('Helvetica-Bold').text('School');
    doc.font('Helvetica').fontSize(11);
    doc.text(payload.school.displayName);
    doc.text(
      [payload.school.sector, payload.school.district, payload.school.province]
        .filter(Boolean)
        .join(', ') || '—'
    );
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(12).text('Audit Summary');
    doc.font('Helvetica').fontSize(11);
    doc.text(`Status: ${payload.status.replace(/_/g, ' ')}`);
    doc.fillColor(scoreColor).text(`Score: ${payload.score}%`).fillColor('#000');
    doc.text(`Submitted: ${formatDate(payload.submittedAt)}`);
    doc.text(`Reviewed: ${formatDate(payload.reviewedAt)}`);
    if (payload.reviewedBy) {
      doc.text(`Reviewed by: ${payload.reviewedBy.firstName} ${payload.reviewedBy.lastName}`);
    }
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(12).text('Findings');
    doc.font('Helvetica').fontSize(11).text(payload.comment || 'No findings recorded.', {
      align: 'justify',
    });
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(12).text('Recommendation');
    doc.font('Helvetica').fontSize(11).text(payload.recommendation || 'None provided.', {
      align: 'justify',
    });

    if (payload.reviewNote) {
      doc.moveDown(0.8);
      doc.font('Helvetica-Bold').fontSize(12).text('Reviewer Note');
      doc.font('Helvetica').fontSize(11).text(payload.reviewNote, { align: 'justify' });
    }

    if (payload.attachments.length) {
      doc.moveDown(0.8);
      doc.font('Helvetica-Bold').fontSize(12).text('Evidence Attached');
      doc.font('Helvetica').fontSize(11);
      for (const att of payload.attachments) {
        doc.text(`• ${att.originalName}`);
      }
    }

    doc.moveDown(1.2);
    doc
      .fontSize(9)
      .fillColor('#888')
      .text(`Auditor: ${payload.auditor.firstName} ${payload.auditor.lastName} (${payload.auditor.email})`);
    doc.text(`Report ID: ${payload.id}`);
    doc.text(`Generated ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`);

    doc.end();
  });
}
