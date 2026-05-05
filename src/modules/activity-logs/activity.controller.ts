import { Request, Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

const prisma = new PrismaClient();

export const getLogs = async (req: Request, res: Response) => {
  const { userId, role, module, actionType, start, end, page = '1', limit = '50' } = req.query;
  const where: Prisma.AuditLogWhereInput = {};
  if (typeof userId === 'string' && userId.trim()) where.actorUserId = userId;
  if (typeof role === 'string' && role.trim()) {
    where.actorRole = { equals: role.trim(), mode: 'insensitive' };
  }
  if (typeof module === 'string' && module.trim()) {
    where.module = { equals: module.trim(), mode: 'insensitive' };
  }
  if (typeof actionType === 'string' && actionType.trim()) where.actionType = actionType as any;
  const createdAt: Prisma.DateTimeFilter = {};
  if (typeof start === 'string') createdAt.gte = new Date(start);
  if (typeof end === 'string') createdAt.lte = new Date(end);
  if (Object.keys(createdAt).length) where.createdAt = createdAt;

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: (Number(page) - 1) * Number(limit),
    take: Number(limit),
  });
  res.json(logs);
};

export const exportLogsExcel = async (req: Request, res: Response) => {
  const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' } });
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Activity Logs');
  sheet.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'User ID', key: 'userId', width: 10 },
    { header: 'User Name', key: 'userName', width: 20 },
    { header: 'Role', key: 'role', width: 15 },
    { header: 'School', key: 'schoolName', width: 20 },
    { header: 'Action', key: 'actionType', width: 10 },
    { header: 'Module', key: 'module', width: 15 },
    { header: 'Description', key: 'description', width: 30 },
    { header: 'Record ID', key: 'recordId', width: 10 },
    { header: 'IP', key: 'ipAddress', width: 15 },
    { header: 'Device', key: 'device', width: 20 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Timestamp', key: 'createdAt', width: 20 },
    { header: 'Session ID', key: 'sessionId', width: 25 },
  ];
  logs.forEach((log) =>
    sheet.addRow({
      id: String(log.id),
      userId: log.actorUserId,
      userName: log.actorName,
      role: log.actorRole,
      schoolName: log.schoolName,
      actionType: log.actionType,
      module: log.module,
      description: log.description,
      recordId: log.recordId ?? log.entityId,
      ipAddress: log.ipAddress,
      device: log.device ?? log.userAgent,
      status: log.status,
      createdAt: log.createdAt.toISOString(),
      sessionId: log.sessionId,
    }),
  );
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="activity-logs.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
};

export const exportLogsPdf = async (req: Request, res: Response) => {
  const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' } });
  const doc = new PDFDocument({ margin: 30, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="activity-logs.pdf"');
  doc.pipe(res);
  doc.fontSize(12).text('Activity Logs', { align: 'center' });
  doc.moveDown();
  logs.forEach((log) => {
    doc.text(
      `${String(log.id)} | ${log.actorUserId ?? '-'} | ${log.actionType ?? '-'} | ${log.module ?? '-'} | ${log.status ?? '-'} | ${log.createdAt.toISOString()}`,
    );
  });
  doc.end();
};
