import { z } from 'zod';

export const listAuditLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
  search: z.string().trim().max(200).optional(),
  event: z.string().trim().max(120).optional(),
  tenantId: z.string().uuid().optional(),
  actorUserId: z.string().uuid().optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

export type ListAuditLogsQueryInput = z.infer<typeof listAuditLogsQuerySchema>;
