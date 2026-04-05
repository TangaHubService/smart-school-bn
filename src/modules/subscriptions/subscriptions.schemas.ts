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

export const grantAcademyAccessSchema = z
  .object({
    userId: z.string().uuid().optional(),
    email: z.string().email().optional(),
    programId: z.string().uuid(),
    durationDays: z.number().int().positive().max(3650).optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.userId && !val.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide userId or email',
        path: ['email'],
      });
    }
  });

export type GrantAcademyAccessInput = z.infer<typeof grantAcademyAccessSchema>;
