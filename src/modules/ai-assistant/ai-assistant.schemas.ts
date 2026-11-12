import { z } from 'zod';

export const createConversationSchema = z
  .object({
    courseId: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

/**
 * `mode` picks a ready-made request so students can tap a button instead of typing:
 * summarize the course, give worked examples, or quiz them. `ask` is a free question.
 */
export const sendAiMessageSchema = z
  .object({
    content: z.string().trim().max(4000).default(''),
    mode: z.enum(['ask', 'summarize', 'examples', 'quiz']).default('ask'),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === 'ask' && !value.content) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['content'], message: 'Type a question' });
    }
  });

/** School admin settings. `apiKey` is write-only: it is checked, encrypted and never returned. */
export const updateAiSettingsSchema = z
  .object({
    apiKey: z
      .string()
      .trim()
      .min(20, 'That does not look like a full OpenAI key')
      .max(300)
      .regex(/^sk-[A-Za-z0-9_\-]+$/, 'OpenAI keys start with "sk-"')
      .optional(),
    model: z.enum(['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1']).optional(),
    enabled: z.boolean().optional(),
    dailyLimitPerStudent: z.number().int().min(1).max(1000).optional(),
  })
  .strict();

export type UpdateAiSettingsInput = z.infer<typeof updateAiSettingsSchema>;
export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type SendAiMessageInput = z.infer<typeof sendAiMessageSchema>;
