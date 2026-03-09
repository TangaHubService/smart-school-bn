import { z } from 'zod';

const staffLoginSchema = z.object({
  loginAs: z.literal('staff').optional().default('staff'),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
});

const studentLoginSchema = z.object({
  loginAs: z.literal('student'),
  studentId: z.string().trim().min(1).max(40),
});

export const loginSchema = z.union([
  staffLoginSchema,
  studentLoginSchema,
]);

export const refreshSchema = z.object({
  refreshToken: z.string().min(32),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(32).optional(),
  allDevices: z.boolean().optional().default(false),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;
