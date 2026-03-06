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
  password: z.string().min(8).max(128),
});

export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
