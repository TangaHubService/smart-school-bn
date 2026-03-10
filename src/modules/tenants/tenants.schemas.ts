import { z } from 'zod';

export const createTenantSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Tenant code must be lowercase alphanumeric/hyphen'),
  name: z.string().trim().min(2).max(120),
  domain: z.string().trim().min(3).max(200).optional(),
  school: z.object({
    displayName: z.string().trim().min(2).max(120),
    registrationNumber: z.string().trim().max(80).optional(),
    email: z.string().trim().email().optional(),
    phone: z.string().trim().max(40).optional(),
    addressLine1: z.string().trim().max(200).optional(),
    addressLine2: z.string().trim().max(200).optional(),
    province: z.string().trim().max(100).optional(),
    city: z.string().trim().max(100).optional(),
    district: z.string().trim().max(100).optional(),
    sector: z.string().trim().max(100).optional(),
    cell: z.string().trim().max(100).optional(),
    village: z.string().trim().max(100).optional(),
    country: z.string().trim().max(100).default('Rwanda'),
    timezone: z.string().trim().max(80).default('Africa/Kigali'),
  }).optional(),
  schoolAdmin: z.object({
    email: z.string().trim().toLowerCase().email(),
    firstName: z.string().trim().min(2).max(80),
    lastName: z.string().trim().min(2).max(80),
    password: z.string().min(8).max(128),
  }).optional(),
});

export const inviteTenantAdminSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  expiresInDays: z.number().int().min(1).max(14).optional().default(7),
});

export const updateTenantSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Tenant code must be lowercase alphanumeric/hyphen'),
  name: z.string().trim().min(2).max(120),
  domain: z.string().trim().min(3).max(200).nullable().optional(),
  school: z.object({
    displayName: z.string().trim().min(2).max(120),
    email: z.string().trim().email().nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
  }),
});

export const updateTenantStatusSchema = z.object({
  isActive: z.boolean(),
});

export const listTenantsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).max(120).optional(),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type InviteTenantAdminInput = z.infer<typeof inviteTenantAdminSchema>;
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
export type UpdateTenantStatusInput = z.infer<typeof updateTenantStatusSchema>;
export type ListTenantsQueryInput = z.infer<typeof listTenantsQuerySchema>;
