import { z } from 'zod';

const auditActionTypeSchema = z.enum(['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT']);
const auditStatusSchema = z.enum(['SUCCESS', 'FAILED']);

export const listAuditLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
  search: z.string().trim().max(200).optional(),
  event: z.string().trim().max(120).optional(),
  actionType: auditActionTypeSchema.optional(),
  module: z.string().trim().max(120).optional(),
  role: z.string().trim().max(120).optional(),
  status: auditStatusSchema.optional(),
  tenantId: z.string().uuid().optional(),
  actorUserId: z.string().uuid().optional(),
  sessionId: z.string().trim().max(120).optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

export type ListAuditLogsQueryInput = z.infer<typeof listAuditLogsQuerySchema>;
