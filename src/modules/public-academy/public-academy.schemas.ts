import { z } from 'zod';

export const academyPlanCheckoutSchema = z.object({
  planId: z.enum(['test', 'weekly', 'monthly', 'quarterly', 'yearly']),
  phoneNumber: z.string().trim().min(10, 'Phone number is required').max(20),
});

export const academyProgramSelectionSchema = z.object({
  programId: z.string().uuid(),
});

export const academyClassSelectionSchema = z.object({
  classRoomId: z.string().uuid(),
});

export type AcademyPlanCheckoutInput = z.infer<typeof academyPlanCheckoutSchema>;
export type AcademyProgramSelectionInput = z.infer<typeof academyProgramSelectionSchema>;
export type AcademyClassSelectionInput = z.infer<typeof academyClassSelectionSchema>;
