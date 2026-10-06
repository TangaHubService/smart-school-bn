import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

import { prisma } from '../../db/prisma';

function buildWhere(req: Request): Prisma.AuditLogWhereInput {
  const { userId, role, module, actionType, start, end, from, to } = req.query;
  const where: Prisma.AuditLogWhereInput = {};
  // Tenant isolation: non-platform users only see their tenant's logs.
  const tenantId = (req as unknown as { tenantId?: string }).tenantId ?? req.user?.tenantId;
  if (tenantId) where.tenantId = tenantId;
  if (typeof userId === 'string' && userId.trim()) where.actorUserId = userId;
  if (typeof role === 'string' && role.trim()) {
    where.actorRole = { equals: role.trim(), mode: 'insensitive' };
  }
  if (typeof module === 'string' && module.trim()) {
    where.module = { equals: module.trim(), mode: 'insensitive' };
  }
  if (typeof actionType === 'string' && actionType.trim()) where.actionType = actionType as never;
  const startRaw = typeof start === 'string' ? start : typeof from === 'string' ? from : null;
  const endRaw = typeof end === 'string' ? end : typeof to === 'string' ? to : null;
  const createdAt: Prisma.DateTimeFilter = {};
  if (startRaw) {
    const d = new Date(startRaw);
    if (Number.isNaN(d.getTime())) throw Object.assign(new Error('Invalid from date'), { status: 400 });
    createdAt.gte = d;
  }
  if (endRaw) {
    const d = new Date(endRaw);
    if (Number.isNaN(d.getTime())) throw Object.assign(new Error('Invalid to date'), { status: 400 });
    createdAt.lte = d;
  }
  if (createdAt.gte && createdAt.lte && createdAt.gte > createdAt.lte) {
    throw Object.assign(new Error('From date must be before To date'), { status: 400 });
  }
  if (Object.keys(createdAt).length) where.createdAt = createdAt;
  return where;
}

export const getLogs = async (req: Request, res: Response) => {
  const { page = '1', limit = '50' } = req.query;
  const where = buildWhere(req);

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: (Number(page) - 1) * Number(limit),
    take: Number(limit),
  });
  res.json(logs);
};

export const exportLogsExcel = async (req: Request, res: Response) => {
  const where = buildWhere(req);
  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 5000,
  });
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
  logs.forEach(log =>
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
    })
  );
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', 'attachment; filename="activity-logs.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
};

export const exportLogsPdf = async (req: Request, res: Response) => {
  const where = buildWhere(req);
  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 2000,
  });
  const doc = new PDFDocument({ margin: 30, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="activity-logs.pdf"');
  doc.pipe(res);
  doc.fontSize(12).text('Activity Logs', { align: 'center' });
  doc.moveDown();
  if (!logs.length) {
    doc.fontSize(10).text('No records found for the selected period.');
  }
  logs.forEach(log => {
    doc.text(
      `${String(log.id)} | ${log.actorUserId ?? '-'} | ${log.actionType ?? '-'} | ${log.module ?? '-'} | ${log.status ?? '-'} | ${log.createdAt.toISOString()}`
    );
  });
  doc.end();
};
