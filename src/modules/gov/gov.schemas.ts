import { FileAssetResourceType } from '@prisma/client';
import { z } from 'zod';

export const academicAuditModuleSchema = z.enum([
  'ATTENDANCE',
  'COURSE_MANAGEMENT',
  'LEARNING_INSIGHTS',
  'CONTINUOUS_ASSESSMENTS',
  'MARKS',
  'TIMETABLE',
  'FINANCE',
  'TEACHERS',
  'STUDENT_RECORDS',
  'INFRASTRUCTURE',
  'ICT',
  'SAFETY',
  'COMPLIANCE',
]);

export const academicAuditStatusSchema = z.enum([
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'NEEDS_REVISION',
]);

export const academicAuditAttachmentUploadSchema = z.object({
  publicId: z.string().trim().min(1).max(255),
  secureUrl: z.string().trim().url(),
  originalName: z.string().trim().min(1).max(255),
  bytes: z.number().int().positive().max(1_000_000_000).optional(),
  format: z.string().trim().max(40).optional(),
  mimeType: z.string().trim().max(120).optional(),
  resourceType: z.nativeEnum(FileAssetResourceType),
});

export const submitAcademicAuditSchema = z
  .object({
    schoolId: z.string().uuid(),
    module: academicAuditModuleSchema,
    score: z.number().min(0).max(100),
    comment: z.string().max(2000).optional(),
    recommendation: z.string().max(2000).optional(),
    attachments: z.array(academicAuditAttachmentUploadSchema).max(10).default([]),
    asDraft: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (!value.asDraft && !value.comment?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['comment'],
        message: 'Comment is required when submitting (not saving as a draft)',
      });
    }
  });

export const updateAcademicAuditSchema = z.object({
  score: z.number().min(0).max(100).optional(),
  comment: z.string().min(1).max(2000).optional(),
  recommendation: z.string().max(2000).nullable().optional(),
  attachments: z.array(academicAuditAttachmentUploadSchema).max(10).optional(),
});

export const reviewAcademicAuditSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED', 'NEEDS_REVISION']),
  reviewNote: z.string().trim().max(2000).optional(),
});

export const reopenAcademicAuditSchema = z.object({
  reviewNote: z.string().trim().max(2000).optional(),
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

export type AcademicAuditAttachmentUploadInput = z.infer<typeof academicAuditAttachmentUploadSchema>;
export type SubmitAcademicAuditInput = z.infer<typeof submitAcademicAuditSchema>;
export type UpdateAcademicAuditInput = z.infer<typeof updateAcademicAuditSchema>;
export type ReviewAcademicAuditInput = z.infer<typeof reviewAcademicAuditSchema>;
export type ReopenAcademicAuditInput = z.infer<typeof reopenAcademicAuditSchema>;
export type AcademicAuditQueryInput = z.infer<typeof academicAuditQuerySchema>;
