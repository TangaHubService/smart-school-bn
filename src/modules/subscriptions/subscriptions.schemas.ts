import { z } from 'zod';

export const updateSchoolSubscriptionSchema = z.object({
  planId: z.string().uuid(),
  status: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED']),
  trialEndsAt: z.string().datetime().nullable().optional(),
  currentPeriodStart: z.string().datetime().nullable().optional(),
  currentPeriodEnd: z.string().datetime().nullable().optional(),
  cancelAtPeriodEnd: z.boolean().optional(),
});

export type UpdateSchoolSubscriptionInput = z.infer<typeof updateSchoolSubscriptionSchema>;
