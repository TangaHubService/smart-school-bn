import { AnnouncementAudience } from '@prisma/client';
import { z } from 'zod';

export const announcementAudienceSchema = z.nativeEnum(AnnouncementAudience);

export const createAnnouncementSchema = z.object({
  title: z.string().trim().min(2).max(200),
  body: z.string().trim().min(5).max(10000),
  audience: announcementAudienceSchema.default('ALL'),
  targetClassRoomIds: z.array(z.string().uuid()).default([]),
  targetGradeLevelIds: z.array(z.string().uuid()).default([]),
  publishedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
});

export const updateAnnouncementSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  body: z.string().trim().min(5).max(10000).optional(),
  audience: announcementAudienceSchema.optional(),
  targetClassRoomIds: z.array(z.string().uuid()).optional(),
  targetGradeLevelIds: z.array(z.string().uuid()).optional(),
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
    .transform((v) => v === 'true' || v === '1'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>;
export type ListAnnouncementsQueryInput = z.infer<typeof listAnnouncementsQuerySchema>;
