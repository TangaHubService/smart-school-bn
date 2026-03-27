import { z } from 'zod';

export const signUploadSchema = z.object({
  purpose: z.enum(['lesson', 'assignment', 'submission', 'logo']),
  fileName: z.string().trim().min(1).max(255),
});

export type SignUploadInput = z.infer<typeof signUploadSchema>;

