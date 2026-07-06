import { AnnouncementAudience, AnnouncementPriority, FileAssetResourceType } from '@prisma/client';
import { z } from 'zod';

export const announcementAudienceSchema = z.nativeEnum(AnnouncementAudience);
export const announcementPrioritySchema = z.nativeEnum(AnnouncementPriority);

export const announcementAttachmentUploadSchema = z.object({
  publicId: z.string().trim().min(1).max(255),
  secureUrl: z.string().trim().url(),
  originalName: z.string().trim().min(1).max(255),
  bytes: z.number().int().positive().max(1_000_000_000).optional(),
  format: z.string().trim().max(40).optional(),
  mimeType: z.string().trim().max(120).optional(),
  resourceType: z.nativeEnum(FileAssetResourceType),
});

export const createAnnouncementSchema = z.object({
  title: z.string().trim().min(2).max(200),
  body: z.string().trim().min(5).max(10000),
  audience: announcementAudienceSchema.default('ALL'),
  priority: announcementPrioritySchema.default('NORMAL'),
  targetClassRoomIds: z.array(z.string().uuid()).default([]),
  targetGradeLevelIds: z.array(z.string().uuid()).default([]),
  targetSubjectIds: z.array(z.string().uuid()).default([]),
  targetRoleNames: z.array(z.string().trim().min(1).max(60)).default([]),
  targetUserIds: z.array(z.string().uuid()).default([]),
  attachments: z.array(announcementAttachmentUploadSchema).max(10).default([]),
  emailNotify: z.boolean().default(false),
  publishedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
});

export const updateAnnouncementSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  body: z.string().trim().min(5).max(10000).optional(),
  audience: announcementAudienceSchema.optional(),
  priority: announcementPrioritySchema.optional(),
  targetClassRoomIds: z.array(z.string().uuid()).optional(),
  targetGradeLevelIds: z.array(z.string().uuid()).optional(),
  targetSubjectIds: z.array(z.string().uuid()).optional(),
  targetRoleNames: z.array(z.string().trim().min(1).max(60)).optional(),
  targetUserIds: z.array(z.string().uuid()).optional(),
  attachments: z.array(announcementAttachmentUploadSchema).max(10).optional(),
  emailNotify: z.boolean().optional(),
  publishedAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const listAnnouncementsQuerySchema = z.object({
  audience: announcementAudienceSchema.optional(),
  classRoomId: z.string().uuid().optional(),
  gradeLevelId: z.string().uuid().optional(),
  publishedOnly: z
    .string()
    .optional()
    .transform(v => v === 'true' || v === '1'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const listMyAnnouncementsQuerySchema = z.object({
  unreadOnly: z
    .string()
    .optional()
    .transform(v => v === 'true' || v === '1'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type AnnouncementAttachmentUploadInput = z.infer<typeof announcementAttachmentUploadSchema>;
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>;
export type ListAnnouncementsQueryInput = z.infer<typeof listAnnouncementsQuerySchema>;
export type ListMyAnnouncementsQueryInput = z.infer<typeof listMyAnnouncementsQuerySchema>;
