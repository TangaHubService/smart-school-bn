import { AssessmentAttemptStatus, AssessmentQuestionType, AssessmentType } from '@prisma/client';
import { z } from 'zod';

function htmlToPlainText(value: string | undefined) {
  return (value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const assessmentOptionSchema = z
  .object({
    label: z.string().trim().min(1).max(500),
    isCorrect: z.boolean(),
    sequence: z.number().int().min(1).optional(),
  })
  .strict();

const assessmentQuestionSchema = z
  .object({
    prompt: z.string().trim().min(2).max(5_000),
    explanation: z.string().trim().max(5_000).optional(),
    type: z.nativeEnum(AssessmentQuestionType).default(AssessmentQuestionType.MCQ_SINGLE),
    sequence: z.number().int().min(1).optional(),
    points: z.number().int().min(1).max(100).default(1),
    options: z.array(assessmentOptionSchema).max(6).default([]),
  })
  .superRefine((value, context) => {
    if (value.type === AssessmentQuestionType.MCQ_SINGLE) {
      if (value.options.length < 2) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['options'],
          message: 'MCQ questions require at least two options',
        });
      }

      const correctOptions = (value.options as Array<{ isCorrect: boolean }>).filter(
        (option) => option.isCorrect,
      );
      if (correctOptions.length !== 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['options'],
          message: 'MCQ questions require exactly one correct option',
        });
      }
    }

    if (
      (value.type === AssessmentQuestionType.OPEN_TEXT ||
        value.type === AssessmentQuestionType.SHORT_ANSWER ||
        value.type === AssessmentQuestionType.ESSAY) &&
      value.options.length > 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'Written-response questions do not use options',
      });
    }
  });

export const createAssessmentSchema = z
  .object({
    courseId: z.string().uuid(),
    lessonId: z.string().uuid().optional(),
    type: z.nativeEnum(AssessmentType).default(AssessmentType.GENERAL),
    title: z.string().trim().min(2).max(160),
    instructions: z
      .string()
      .max(20_000)
      .optional()
      .refine((value) => !value || htmlToPlainText(value).length >= 2, 'Instructions must contain readable text'),
    dueAt: z.string().datetime().optional(),
    timeLimitMinutes: z.number().int().min(1).max(240).optional(),
    maxAttempts: z.number().int().min(1).max(5).default(1),
    isPublished: z.boolean().default(false),
    accessCode: z.string().trim().min(4).max(64).optional().nullable(),
    portalAssignOnly: z.boolean().optional(),
  })
  .strict();

export const updateAssessmentPortalSchema = z
  .object({
    accessCode: z.string().trim().min(4).max(64).nullable().optional(),
    portalAssignOnly: z.boolean().optional(),
  })
  .strict()
  .refine((data) => data.accessCode !== undefined || data.portalAssignOnly !== undefined, {
    message: 'Provide at least one of accessCode or portalAssignOnly',
  });

export const replaceAssessmentAssigneesSchema = z
  .object({
    studentIds: z.array(z.string().uuid()).max(500),
  })
  .strict();

export const startAssessmentAttemptSchema = z
  .object({
    accessCode: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export const addQuestionSchema = assessmentQuestionSchema;
export const updateQuestionSchema = assessmentQuestionSchema;

export const publishAssessmentSchema = z
  .object({
    isPublished: z.boolean(),
  })
  .strict();

export const listAssessmentsQuerySchema = z.object({
  courseId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export const listAssessmentResultsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export const listMyAssessmentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(20).default(10),
  q: z.string().trim().max(120).optional(),
});

export const saveAttemptAnswersSchema = z
  .object({
    answers: z
      .array(
        z
          .object({
            questionId: z.string().uuid(),
            selectedOptionId: z.string().uuid().nullable(),
            textResponse: z.string().trim().max(10_000).nullable().optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const regradeAttemptSchema = z
  .object({
    manualFeedback: z.string().trim().max(5_000).optional(),
    answers: z
      .array(
        z
          .object({
            questionId: z.string().uuid(),
            pointsAwarded: z.number().int().min(0).max(100),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const listAssessmentAttemptsQuerySchema = z.object({
  status: z.nativeEnum(AssessmentAttemptStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export type CreateAssessmentInput = z.infer<typeof createAssessmentSchema>;
export type UpdateAssessmentPortalInput = z.infer<typeof updateAssessmentPortalSchema>;
export type ReplaceAssessmentAssigneesInput = z.infer<typeof replaceAssessmentAssigneesSchema>;
export type StartAssessmentAttemptInput = z.infer<typeof startAssessmentAttemptSchema>;
export type AddQuestionInput = z.infer<typeof addQuestionSchema>;
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;
export type PublishAssessmentInput = z.infer<typeof publishAssessmentSchema>;
export type ListAssessmentsQueryInput = z.infer<typeof listAssessmentsQuerySchema>;
export type ListAssessmentResultsQueryInput = z.infer<typeof listAssessmentResultsQuerySchema>;
export type ListMyAssessmentsQueryInput = z.infer<typeof listMyAssessmentsQuerySchema>;
export type SaveAttemptAnswersInput = z.infer<typeof saveAttemptAnswersSchema>;
export type RegradeAttemptInput = z.infer<typeof regradeAttemptSchema>;
export type ListAssessmentAttemptsQueryInput = z.infer<typeof listAssessmentAttemptsQuerySchema>;
