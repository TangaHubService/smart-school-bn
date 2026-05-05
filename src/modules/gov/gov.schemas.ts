import {
  AuditActionType,
  AuditStatus,
  AuditType,
  AuditorLevel,
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
export const auditorLevelSchema = z.nativeEnum(AuditorLevel);
export const auditTypeSchema = z.nativeEnum(AuditType);
export const auditStatusSchema = z.nativeEnum(AuditStatus);
export const auditActionTypeSchema = z.nativeEnum(AuditActionType);

function validateLocation(
  value: {
    level: AuditorLevel;
    province?: string;
    district?: string;
    sector?: string;
  },
  context: z.RefinementCtx,
) {
  if (value.level === AuditorLevel.PROVINCE && !value.province) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['province'],
      message: 'province is required for province level',
    });
  }

  if (value.level === AuditorLevel.DISTRICT) {
    if (!value.province) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['province'],
        message: 'province is required for district level',
      });
    }
    if (!value.district) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['district'],
        message: 'district is required for district level',
      });
    }
  }

  if (value.level === AuditorLevel.SECTOR) {
    if (!value.province) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['province'],
        message: 'province is required for sector level',
      });
    }
    if (!value.district) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['district'],
        message: 'district is required for sector level',
      });
    }
    if (!value.sector) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sector'],
        message: 'sector is required for sector level',
      });
    }
  }
}

export const createGovAuditorSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(8).max(128),
    firstName: z.string().trim().min(2).max(80),
    lastName: z.string().trim().min(2).max(80),
    phone: z.string().trim().max(40).optional(),
    level: auditorLevelSchema.default(AuditorLevel.NATIONAL),
    country: z.string().trim().min(2).max(80).default('Rwanda'),
    province: z.string().trim().max(80).optional(),
    district: z.string().trim().max(80).optional(),
    sector: z.string().trim().max(80).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    validateLocation(value, context);
  });

export const updateGovAuditorSchema = z
  .object({
    firstName: z.string().trim().min(2).max(80).optional(),
    lastName: z.string().trim().min(2).max(80).optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
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

export const createGovAuditSchema = z
  .object({
    schoolId: z.string().uuid(),
    auditorUserId: z.string().uuid().optional(),
    auditType: auditTypeSchema,
    plannedDate: isoDateSchema,
    planNotes: z.string().trim().max(800).optional(),
  })
  .strict();

export const listGovAuditsQuerySchema = z.object({
  status: auditStatusSchema.optional(),
  auditType: auditTypeSchema.optional(),
  schoolId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const submitGovAuditReportSchema = z
  .object({
    auditId: z.string().uuid(),
    teachingQuality: z.coerce.number().int().min(1).max(5),
    infrastructure: z.coerce.number().int().min(1).max(5),
    discipline: z.coerce.number().int().min(1).max(5),
    comment: z.string().trim().min(3).max(1200),
    findings: z.string().trim().min(3).max(2000),
    recommendations: z.string().trim().min(3).max(2000),
  })
  .strict();

export const listGovReportsQuerySchema = z.object({
  auditType: auditTypeSchema.optional(),
  schoolId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const listGovActivityLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  actionType: auditActionTypeSchema.optional(),
  module: z.string().trim().max(120).optional(),
});

export type CreateGovAuditorInput = z.infer<typeof createGovAuditorSchema>;
export type UpdateGovAuditorInput = z.infer<typeof updateGovAuditorSchema>;
export type AssignGovAuditorScopeInput = z.infer<typeof assignGovAuditorScopeSchema>;
export type UpdateGovAuditorScopeInput = z.infer<typeof updateGovAuditorScopeSchema>;
export type ListGovAuditorsQueryInput = z.infer<typeof listGovAuditorsQuerySchema>;
export type ListGovSchoolsQueryInput = z.infer<typeof listGovSchoolsQuerySchema>;
export type ListGovIncidentsQueryInput = z.infer<typeof listGovIncidentsQuerySchema>;
export type AddGovFeedbackInput = z.infer<typeof addGovFeedbackSchema>;
export type CreateGovAuditInput = z.infer<typeof createGovAuditSchema>;
export type ListGovAuditsQueryInput = z.infer<typeof listGovAuditsQuerySchema>;
export type SubmitGovAuditReportInput = z.infer<typeof submitGovAuditReportSchema>;
export type ListGovReportsQueryInput = z.infer<typeof listGovReportsQuerySchema>;
export type ListGovActivityLogsQueryInput = z.infer<typeof listGovActivityLogsQuerySchema>;
