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

/** Most questions a teacher can ask for in one go (generated in batches behind the scenes). */
export const MAX_AI_QUESTIONS = 200;
/** Longest description a teacher can write for what they want. */
export const MAX_AI_INSTRUCTIONS = 4000;
/** Uploaded knowledge-base documents that can be used in one request. */
const documentIdsSchema = z.array(z.string().uuid()).max(20).default([]);
/** Questions already written in earlier parts of a large request, so they are not repeated. */
const avoidPromptsSchema = z.array(z.string().trim().max(300)).max(400).default([]);

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
    lessonIds: z.array(z.string().uuid()).max(40).default([]),
    documentIds: documentIdsSchema,
    avoidPrompts: avoidPromptsSchema,
    count: z.number().int().min(1).max(MAX_AI_QUESTIONS).default(5),
    types: z.array(z.enum(AI_QUESTION_TYPES)).min(1).default(['MCQ_SINGLE']),
    difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']).default('mixed'),
    instructions: z.string().trim().max(MAX_AI_INSTRUCTIONS).optional(),
    language: z.enum(['en', 'fr', 'rw']).default('en'),
  })
  .strict();

export type DraftLessonPlanInput = z.infer<typeof draftLessonPlanSchema>;
export type GenerateAssessmentQuestionsInput = z.infer<typeof generateAssessmentQuestionsSchema>;

export const STUDY_MATERIAL_FORMATS = ['summary', 'revision-notes', 'key-terms', 'study-guide', 'custom'] as const;

/**
 * Teacher asks for study material from their knowledge base: course lessons and/or uploaded
 * documents. With format "custom" the teacher's own description is the whole brief.
 */
export const generateStudyMaterialSchema = z
  .object({
    courseId: z.string().uuid().optional(),
    /** Lessons to summarize. Empty = every lesson in the course. */
    lessonIds: z.array(z.string().uuid()).max(40).default([]),
    documentIds: documentIdsSchema,
    format: z.enum(STUDY_MATERIAL_FORMATS).default('summary'),
    instructions: z.string().trim().max(MAX_AI_INSTRUCTIONS).optional(),
    language: z.enum(['en', 'fr', 'rw']).default('en'),
  })
  .strict()
  .refine(v => Boolean(v.courseId) || v.documentIds.length > 0, {
    message: 'Pick a course or at least one document',
    path: ['courseId'],
  })
  .refine(v => v.format !== 'custom' || (v.instructions ?? '').length >= 5, {
    message: 'Describe what you want the AI to write',
    path: ['instructions'],
  });

/**
 * Assessment preparation from the knowledge base, before any assessment exists: draft
 * questions with an answer key. Saving goes through the normal assessments API.
 */
export const assessmentPrepSchema = z
  .object({
    courseId: z.string().uuid().optional(),
    lessonIds: z.array(z.string().uuid()).max(40).default([]),
    documentIds: documentIdsSchema,
    avoidPrompts: avoidPromptsSchema,
    count: z.number().int().min(1).max(MAX_AI_QUESTIONS).default(10),
    types: z.array(z.enum(AI_QUESTION_TYPES)).min(1).default(['MCQ_SINGLE', 'OPEN_TEXT']),
    difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']).default('mixed'),
    instructions: z.string().trim().max(MAX_AI_INSTRUCTIONS).optional(),
    language: z.enum(['en', 'fr', 'rw']).default('en'),
  })
  .strict()
  .refine(v => Boolean(v.courseId) || v.documentIds.length > 0, {
    message: 'Pick a course or at least one document',
    path: ['courseId'],
  });

export type GenerateStudyMaterialInput = z.infer<typeof generateStudyMaterialSchema>;
export type AssessmentPrepInput = z.infer<typeof assessmentPrepSchema>;
