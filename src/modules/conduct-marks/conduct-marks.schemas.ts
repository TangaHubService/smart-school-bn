import { z } from 'zod';

export const termSettingBodySchema = z.object({
  totalMarks: z.coerce.number().int().min(1).max(1000),
});

export const createDeductionBodySchema = z.object({
  academicYearId: z.string().uuid(),
  termId: z.string().uuid(),
  classRoomId: z.string().uuid(),
  studentId: z.string().uuid(),
  pointsDeducted: z.coerce.number().int().min(1).max(1000),
  reason: z.string().trim().min(1).max(2000),
  occurredAt: z.string().datetime().optional(),
});

export const termSettingsQuerySchema = z.object({
  academicYearId: z.string().uuid(),
});

export const listStudentDeductionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  termId: z.string().uuid().optional(),
});

export const studentConductSummaryQuerySchema = z.object({
  academicYearId: z.string().uuid(),
});

export type CreateDeductionBodyInput = z.infer<typeof createDeductionBodySchema>;
export type TermSettingsQueryInput = z.infer<typeof termSettingsQuerySchema>;
export type ListStudentDeductionsQueryInput = z.infer<typeof listStudentDeductionsQuerySchema>;
export type StudentConductSummaryQueryInput = z.infer<typeof studentConductSummaryQuerySchema>;
