import { z } from 'zod';

export const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(5000),
  fileUrl: z.string().trim().url().max(2000).optional(),
}).strict();

export const listMessagesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type ListMessagesQueryInput = z.infer<typeof listMessagesQuerySchema>;
