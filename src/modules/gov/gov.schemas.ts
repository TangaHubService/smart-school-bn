import { z } from 'zod';

export const academicAuditModuleSchema = z.enum([
  'ATTENDANCE',
  'COURSE_MANAGEMENT',
  'LEARNING_INSIGHTS',
  'CONTINUOUS_ASSESSMENTS',
  'MARKS',
  'TIMETABLE',
]);

export const academicAuditStatusSchema = z.enum([
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'NEEDS_REVISION',
]);

export const submitAcademicAuditSchema = z.object({
  schoolId: z.string().uuid(),
  module: academicAuditModuleSchema,
  score: z.number().min(0).max(100),
  comment: z.string().min(1).max(2000),
  recommendation: z.string().max(2000).optional(),
});

export const academicAuditQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  schoolId: z.string().uuid().optional(),
  module: academicAuditModuleSchema.optional(),
  status: academicAuditStatusSchema.optional(),
  auditorId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  province: z.string().optional(),
  district: z.string().optional(),
  sector: z.string().optional(),
});

export type SubmitAcademicAuditInput = z.infer<typeof submitAcademicAuditSchema>;
export type AcademicAuditQueryInput = z.infer<typeof academicAuditQuerySchema>;
