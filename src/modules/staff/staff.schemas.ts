import { UserStatus } from '@prisma/client';
import { z } from 'zod';

export const inviteStaffSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  roleName: z.string().trim().min(2).max(60),
  expiresInDays: z.number().int().min(1).max(14).optional().default(7),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(32),
  firstName: z.string().trim().min(2).max(80),
  lastName: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(7).max(30).optional(),
  password: z.string().min(8).max(128),
});

export const listStaffMembersQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  roleName: z.string().trim().min(2).max(60).optional(),
  status: z.nativeEnum(UserStatus).optional(),
});

export const updateStaffMemberSchema = z
  .object({
    firstName: z.string().trim().min(2).max(80).optional(),
    lastName: z.string().trim().min(2).max(80).optional(),
    phone: z.string().trim().min(7).max(30).nullable().optional(),
    status: z.nativeEnum(UserStatus).optional(),
  })
  .strict();

export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
export type ListStaffMembersQueryInput = z.infer<typeof listStaffMembersQuerySchema>;
export type UpdateStaffMemberInput = z.infer<typeof updateStaffMemberSchema>;
