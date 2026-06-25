import { z } from 'zod';

export const createLessonPlanSchema = z.object({
  title: z.string().trim().min(2).max(200),
  academicYearId: z.string().uuid(),
  classRoomId: z.string().uuid(),
  subjectId: z.string().uuid(),
  objectives: z.string().trim().max(5000).optional(),
  materials: z.string().trim().max(5000).optional(),
  activities: z.string().trim().max(10000).optional(),
  assessment: z.string().trim().max(5000).optional(),
  weekNumber: z.number().int().min(1).max(52).optional(),
  durationMinutes: z.number().int().min(1).max(600).optional(),
}).strict();

export const updateLessonPlanSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  objectives: z.string().trim().max(5000).nullable().optional(),
  materials: z.string().trim().max(5000).nullable().optional(),
  activities: z.string().trim().max(10000).nullable().optional(),
  assessment: z.string().trim().max(5000).nullable().optional(),
  weekNumber: z.number().int().min(1).max(52).nullable().optional(),
  durationMinutes: z.number().int().min(1).max(600).nullable().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
}).strict();

export const lessonPlanFeedbackSchema = z.object({
  feedback: z.string().trim().max(5000),
}).strict();

export const listLessonPlansQuerySchema = z.object({
  academicYearId: z.string().uuid().optional(),
  classRoomId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  teacherUserId: z.string().uuid().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateLessonPlanInput = z.infer<typeof createLessonPlanSchema>;
export type UpdateLessonPlanInput = z.infer<typeof updateLessonPlanSchema>;
export type LessonPlanFeedbackInput = z.infer<typeof lessonPlanFeedbackSchema>;
export type ListLessonPlansQueryInput = z.infer<typeof listLessonPlansQuerySchema>;
