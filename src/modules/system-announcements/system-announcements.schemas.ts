import { SystemAnnouncementStatus, SystemAnnouncementTarget } from '@prisma/client';
import { z } from 'zod';

export const createSystemAnnouncementSchema = z.object({
  title: z.string().trim().min(2).max(200),
  body: z.string().trim().min(1).max(20000),
  targetType: z.nativeEnum(SystemAnnouncementTarget),
  targetTenantIds: z.array(z.string().uuid()).default([]),
  targetRoleNames: z.array(z.string().trim().min(1).max(40)).default([]),
  status: z.nativeEnum(SystemAnnouncementStatus).default(SystemAnnouncementStatus.DRAFT),
  publishedAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const updateSystemAnnouncementSchema = createSystemAnnouncementSchema.partial();

export const listSystemAnnouncementsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  status: z.nativeEnum(SystemAnnouncementStatus).optional(),
});
