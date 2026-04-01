import { z } from 'zod';

const gradingBandSchema = z
  .object({
    min: z.number().min(0).max(100),
    max: z.number().min(0).max(100),
    grade: z.string().trim().min(1).max(20),
    remark: z.string().trim().max(120).optional(),
  })
  .strict()
  .refine((value) => value.min <= value.max, {
    message: 'Band min must be less than or equal to max',
    path: ['min'],
  });

export const createGradingSchemeSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(240).optional(),
    isDefault: z.boolean().default(false),
    rules: z.array(gradingBandSchema).min(1).max(12),
  })
  .strict();

export const examTypeSchema = z.enum(['CAT', 'EXAM']);

export const createExamSchema = z
  .object({
    termId: z.string().uuid(),
    classRoomId: z.string().uuid(),
    subjectId: z.string().uuid(),
    gradingSchemeId: z.string().uuid().optional(),
    examType: examTypeSchema.optional().default('EXAM'),
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).optional(),
    totalMarks: z.number().int().min(1).max(500).default(100),
    weight: z.number().int().min(1).max(500).default(100),
    examDate: z.string().datetime().optional(),
  })
  .strict();

export const listExamsQuerySchema = z.object({
  termId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

const markStatusSchema = z.enum(['PRESENT', 'ABSENT', 'EXCUSED']);

export const bulkExamMarksSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            studentId: z.string().uuid(),
            marksObtained: z.number().int().min(0).max(500).nullable(),
            status: markStatusSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

export const resultsActionSchema = z
  .object({
    termId: z.string().uuid(),
    classRoomId: z.string().uuid(),
    gradingSchemeId: z.string().uuid().optional(),
  })
  .strict();

export const bulkConductGradesSchema = z
  .object({
    termId: z.string().uuid(),
    classRoomId: z.string().uuid(),
    entries: z
      .array(
        z
          .object({
            studentId: z.string().uuid(),
            grade: z.string().trim().min(1).max(20),
            remark: z.string().trim().max(200).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

export const reportCardsQuerySchema = z.object({
  termId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
});

/** Admin listing: mixed report-card snapshots for a tenant. */
export const reportCardsCatalogQuerySchema = z.object({
  /** Omit to list report cards across all academic years (still paginated). */
  academicYearId: z.string().uuid().optional(),
  termId: z.string().uuid().optional(),
  classRoomId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});

export const myExamScheduleQuerySchema = z.object({
  upcomingOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const conductGradesQuerySchema = z.object({
  termId: z.string().uuid(),
  classRoomId: z.string().uuid(),
});

export const parentReportCardsQuerySchema = z.object({
  studentId: z.string().uuid().optional(),
  termId: z.string().uuid().optional(),
});

export const marksGridQuerySchema = z.object({
  termId: z.string().uuid(),
  classRoomId: z.string().uuid(),
});

export const allMarksLedgerQuerySchema = z.object({
  /** Omit to include marks across all active academic years (still paginated). */
  academicYearId: z.string().uuid().optional(),
  termId: z.string().uuid().optional(),
  classRoomId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
  sortBy: z
    .enum(['rank', 'studentName', 'classCode', 'term', 'subject', 'total', 'average'])
    .optional()
    .default('rank'),
  sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
});

export const marksGridSaveSchema = z
  .object({
    termId: z.string().uuid(),
    classRoomId: z.string().uuid(),
    entries: z
      .array(
        z
          .object({
            studentId: z.string().uuid(),
            subjectId: z.string().uuid(),
            testMarks: z.number().int().min(0).max(500).nullable().optional(),
            examMarks: z.number().int().min(0).max(500).nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(2000),
  })
  .strict();

export type CreateGradingSchemeInput = z.infer<typeof createGradingSchemeSchema>;
export type CreateExamInput = z.infer<typeof createExamSchema>;
export type ListExamsQueryInput = z.infer<typeof listExamsQuerySchema>;
export type BulkExamMarksInput = z.infer<typeof bulkExamMarksSchema>;
export type ResultsActionInput = z.infer<typeof resultsActionSchema>;
export type ReportCardsQueryInput = z.infer<typeof reportCardsQuerySchema>;
export type ReportCardsCatalogQueryInput = z.infer<typeof reportCardsCatalogQuerySchema>;
export type MyExamScheduleQueryInput = z.infer<typeof myExamScheduleQuerySchema>;
export type ParentReportCardsQueryInput = z.infer<typeof parentReportCardsQuerySchema>;
export type BulkConductGradesInput = z.infer<typeof bulkConductGradesSchema>;
export type ConductGradesQueryInput = z.infer<typeof conductGradesQuerySchema>;
export type MarksGridQueryInput = z.infer<typeof marksGridQuerySchema>;
export type MarksGridSaveInput = z.infer<typeof marksGridSaveSchema>;
export type AllMarksLedgerQueryInput = z.infer<typeof allMarksLedgerQuerySchema>;
