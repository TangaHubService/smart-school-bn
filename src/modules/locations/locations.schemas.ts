import { z } from 'zod';

export const listDivisionsQuerySchema = z.object({
  level: z.coerce.number().int().min(1).max(4),
  parentId: z.string().trim().min(1).optional(),
});

export type ListDivisionsQueryInput = z.infer<typeof listDivisionsQuerySchema>;
