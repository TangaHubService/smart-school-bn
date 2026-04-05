import { z } from 'zod';

export const loginSchema = z.object({
  identifier: z.string().trim().toLowerCase().min(1, 'Email or username is required'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(32),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(32).optional(),
  allDevices: z.boolean().optional().default(false),
});

export const registerSchema = z
  .object({
    firstName: z.string().trim().min(2, 'First name is required').max(50),
    lastName: z.string().trim().min(2, 'Last name is required').max(50),
    username: z
      .string()
      .trim()
      .min(3, 'Username must be at least 3 characters')
      .max(30)
      .regex(/^[a-z0-9_]+$/, 'Only small letters, numbers, and underscores allowed'),
    email: z.string().trim().toLowerCase().email('Invalid email address'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128)
      .regex(/[A-Z]/, 'Must include a capital letter')
      .regex(/[a-z]/, 'Must include a small letter')
      .regex(/[0-9]/, 'Must include a number')
      .regex(/[^A-Za-z0-9]/, 'Must include a special character'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email('Enter a valid email'),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  email: z.string().email('Enter a valid email'),
  otp: z.string().min(1, 'OTP is required'),
  newPassword: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must include a capital letter')
    .regex(/[a-z]/, 'Must include a small letter')
    .regex(/[0-9]/, 'Must include a number')
    .regex(/[^A-Za-z0-9]/, 'Must include a special character'),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const verifyOtpSchema = z.object({
  email: z.string().trim().email(),
  otp: z.string().length(6, 'OTP must be 6 digits'),
});

export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
