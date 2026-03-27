import { z } from 'zod';

export const listUsersQuerySchema = z.object({
  search: z.string().trim().optional(),
  role: z.string().trim().optional(),
  tenantId: z.string().uuid().optional(),
  status: z.enum(['active', 'inactive', 'all']).default('all'),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
  createdFrom: z.string().trim().optional(),
  createdTo: z.string().trim().optional(),
});

export type ListUsersQueryInput = z.infer<typeof listUsersQuerySchema>;

export const updateUserStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE']),
});
