import { z } from 'zod';

export const loginSchema = z.object({
  tenantCode: z
    .string()
    .trim()
    .max(50)
    .optional()
    .refine((value) => !value || value.length >= 2, {
      message: 'tenantCode must be at least 2 characters',
    }),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
});

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
