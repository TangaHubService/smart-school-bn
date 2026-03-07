import {
  ConductIncidentStatus,
  ConductSeverity,
  GovScopeLevel,
} from '@prisma/client';
import { z } from 'zod';

const isoDateSchema = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));

export const govScopeLevelSchema = z.nativeEnum(GovScopeLevel);

export const createGovAuditorSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(8).max(128),
    firstName: z.string().trim().min(2).max(80),
    lastName: z.string().trim().min(2).max(80),
    phone: z.string().trim().max(40).optional(),
  })
  .strict();

export const assignGovAuditorScopeSchema = z
  .object({
    scopeLevel: govScopeLevelSchema,
    country: z.string().trim().min(2).max(80).default('Rwanda'),
    province: z.string().trim().max(80).optional(),
    district: z.string().trim().max(80).optional(),
    sector: z.string().trim().max(80).optional(),
    notes: z.string().trim().max(400).optional(),
    startsAt: isoDateSchema.optional(),
    endsAt: isoDateSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.scopeLevel === GovScopeLevel.PROVINCE && !value.province) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['province'],
        message: 'province is required for province scope',
      });
    }

    if (value.scopeLevel === GovScopeLevel.DISTRICT) {
      if (!value.province) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['province'],
          message: 'province is required for district scope',
        });
      }
      if (!value.district) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['district'],
          message: 'district is required for district scope',
        });
      }
    }

    if (value.scopeLevel === GovScopeLevel.SECTOR) {
      if (!value.province) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['province'],
          message: 'province is required for sector scope',
        });
      }
      if (!value.district) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['district'],
          message: 'district is required for sector scope',
        });
      }
      if (!value.sector) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sector'],
          message: 'sector is required for sector scope',
        });
      }
    }

    if (value.startsAt && value.endsAt && value.startsAt > value.endsAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startsAt'],
        message: 'startsAt must be before endsAt',
      });
    }
  });

export const updateGovAuditorScopeSchema = z
  .object({
    notes: z.string().trim().max(400).nullable().optional(),
    startsAt: isoDateSchema.nullable().optional(),
    endsAt: isoDateSchema.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const listGovAuditorsQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
});

export const listGovSchoolsQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  province: z.string().trim().min(1).max(80).optional(),
  district: z.string().trim().min(1).max(80).optional(),
  sector: z.string().trim().min(1).max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const listGovIncidentsQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  status: z.nativeEnum(ConductIncidentStatus).optional(),
  severity: z.nativeEnum(ConductSeverity).optional(),
  q: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const addGovFeedbackSchema = z
  .object({
    body: z.string().trim().min(3).max(1200),
  })
  .strict();

export type CreateGovAuditorInput = z.infer<typeof createGovAuditorSchema>;
export type AssignGovAuditorScopeInput = z.infer<typeof assignGovAuditorScopeSchema>;
export type UpdateGovAuditorScopeInput = z.infer<typeof updateGovAuditorScopeSchema>;
export type ListGovAuditorsQueryInput = z.infer<typeof listGovAuditorsQuerySchema>;
export type ListGovSchoolsQueryInput = z.infer<typeof listGovSchoolsQuerySchema>;
export type ListGovIncidentsQueryInput = z.infer<typeof listGovIncidentsQuerySchema>;
export type AddGovFeedbackInput = z.infer<typeof addGovFeedbackSchema>;
