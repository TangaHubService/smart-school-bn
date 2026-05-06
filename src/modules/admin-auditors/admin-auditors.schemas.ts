import { z } from 'zod';

const auditorLevelSchema = z.enum(['NATIONAL', 'PROVINCE', 'DISTRICT', 'SECTOR']);
const optionalText = z.preprocess(
  value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().optional()
);

const auditorScopeFields = {
  level: auditorLevelSchema,
  province: optionalText,
  district: optionalText,
  sector: optionalText,
  notes: optionalText,
};

function validateAuditorScope(
  input: {
    level: z.infer<typeof auditorLevelSchema>;
    province?: string;
    district?: string;
    sector?: string;
  },
  ctx: z.RefinementCtx
) {
  if (input.level !== 'NATIONAL' && !input.province) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['province'],
      message: 'Province is required for this audit level',
    });
  }

  if ((input.level === 'DISTRICT' || input.level === 'SECTOR') && !input.district) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['district'],
      message: 'District is required for this audit level',
    });
  }

  if (input.level === 'SECTOR' && !input.sector) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sector'],
      message: 'Sector is required for this audit level',
    });
  }
}

export const assignAuditorSchema = z.object(auditorScopeFields).superRefine(validateAuditorScope);

export type AssignAuditorInput = z.infer<typeof assignAuditorSchema>;

export const createAuditorUserSchema = z
  .object({
    firstName: z.string().trim().min(1, 'First name is required'),
    lastName: z.string().trim().min(1, 'Last name is required'),
    email: z.string().trim().email('Valid email is required'),
    phone: optionalText,
    password: z.string().min(6, 'Password must be at least 6 characters'),
    ...auditorScopeFields,
    level: auditorLevelSchema.default('NATIONAL'),
  })
  .superRefine(validateAuditorScope);

export type CreateAuditorUserInput = z.infer<typeof createAuditorUserSchema>;

export const listAuditorsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().optional(),
  level: z.enum(['NATIONAL', 'PROVINCE', 'DISTRICT', 'SECTOR']).optional(),
});

export type ListAuditorsQueryInput = z.infer<typeof listAuditorsQuerySchema>;

export const locationQuerySchema = z.object({
  province: z.string().optional(),
  district: z.string().optional(),
});

export type LocationQueryInput = z.infer<typeof locationQuerySchema>;
