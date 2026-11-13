import { z } from 'zod';

/** Teacher asks the AI to draft a lesson plan. Nothing is saved: the draft fills the form. */
export const draftLessonPlanSchema = z
  .object({
    academicYearId: z.string().uuid(),
    classRoomId: z.string().uuid(),
    subjectId: z.string().uuid(),
    topic: z.string().trim().min(2, 'Say what the lesson is about').max(300),
    weekNumber: z.number().int().min(1).max(52).optional(),
    durationMinutes: z.number().int().min(5).max(600).optional(),
    notes: z.string().trim().max(2000).optional(),
    language: z.enum(['en', 'fr', 'rw']).default('en'),
  })
  .strict();

/** Only the types the web app can show and grade today. */
export const AI_QUESTION_TYPES = ['MCQ_SINGLE', 'OPEN_TEXT'] as const;

/**
 * Teacher asks the AI for test questions based on the course lessons. Questions come back
 * as a draft for the teacher to edit; they are only saved through the normal bulk-add API.
 */
export const generateAssessmentQuestionsSchema = z
  .object({
    assessmentId: z.string().uuid(),
    /** Lessons to base the questions on. Empty = the test's lesson, or the whole course. */
    lessonIds: z.array(z.string().uuid()).max(20).default([]),
    count: z.number().int().min(1).max(20).default(5),
    types: z.array(z.enum(AI_QUESTION_TYPES)).min(1).default(['MCQ_SINGLE']),
    difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']).default('mixed'),
    instructions: z.string().trim().max(1000).optional(),
    language: z.enum(['en', 'fr', 'rw']).default('en'),
  })
  .strict();

export type DraftLessonPlanInput = z.infer<typeof draftLessonPlanSchema>;
export type GenerateAssessmentQuestionsInput = z.infer<typeof generateAssessmentQuestionsSchema>;
