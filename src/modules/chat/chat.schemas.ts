import { FileAssetResourceType } from '@prisma/client';
import { z } from 'zod';

export const chatAttachmentUploadSchema = z.object({
  publicId: z.string().trim().min(1).max(255),
  secureUrl: z.string().trim().url(),
  originalName: z.string().trim().min(1).max(255),
  bytes: z.number().int().positive().max(1_000_000_000).optional(),
  format: z.string().trim().max(40).optional(),
  mimeType: z.string().trim().max(120).optional(),
  resourceType: z.nativeEnum(FileAssetResourceType),
});

export const getOrCreateChatQuerySchema = z.object({
  academicYearId: z.string().uuid().optional(),
});

export const sendMessageSchema = z
  .object({
    content: z.string().trim().max(5000).default(''),
    attachment: chatAttachmentUploadSchema.optional(),
    replyToId: z.string().uuid().optional(),
    mentionedUserIds: z.array(z.string().uuid()).max(50).default([]),
    isAnnouncement: z.boolean().optional().default(false),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.content.trim() && !value.attachment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: 'Message must have text or an attachment',
      });
    }
  });

export const listMessagesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().trim().max(200).optional(),
});

export const reactionSchema = z
  .object({
    emoji: z.string().trim().min(1).max(16),
  })
  .strict();

export type ChatAttachmentUploadInput = z.infer<typeof chatAttachmentUploadSchema>;
export type GetOrCreateChatQueryInput = z.infer<typeof getOrCreateChatQuerySchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type ListMessagesQueryInput = z.infer<typeof listMessagesQuerySchema>;
export type ReactionInput = z.infer<typeof reactionSchema>;
