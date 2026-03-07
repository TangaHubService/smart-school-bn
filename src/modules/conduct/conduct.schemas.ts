import {
  ConductActionType,
  ConductIncidentStatus,
  ConductSeverity,
} from '@prisma/client';
import { z } from 'zod';

const isoDateSchema = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));

export const conductSeveritySchema = z.nativeEnum(ConductSeverity);
export const conductIncidentStatusSchema = z.nativeEnum(ConductIncidentStatus);
export const conductActionTypeSchema = z.nativeEnum(ConductActionType);

export const createConductIncidentSchema = z
  .object({
    studentId: z.string().uuid(),
    classRoomId: z.string().uuid().optional(),
    occurredAt: isoDateSchema,
    category: z.string().trim().min(2).max(80),
    title: z.string().trim().min(3).max(140),
    description: z.string().trim().min(5).max(2000),
    severity: conductSeveritySchema.optional(),
    location: z.string().trim().max(160).optional(),
    reporterNotes: z.string().trim().max(1200).optional(),
  })
  .strict();

export const updateConductIncidentSchema = z
  .object({
    category: z.string().trim().min(2).max(80).optional(),
    title: z.string().trim().min(3).max(140).optional(),
    description: z.string().trim().min(5).max(2000).optional(),
    severity: conductSeveritySchema.optional(),
    status: conductIncidentStatusSchema.optional(),
    occurredAt: isoDateSchema.optional(),
    location: z.string().trim().max(160).nullable().optional(),
    reporterNotes: z.string().trim().max(1200).nullable().optional(),
  })
  .strict();

export const addConductActionSchema = z
  .object({
    type: conductActionTypeSchema,
    title: z.string().trim().min(2).max(140),
    description: z.string().trim().max(1200).optional(),
    actionDate: isoDateSchema,
    dueDate: isoDateSchema.optional(),
    completedAt: isoDateSchema.optional(),
  })
  .strict();

export const resolveConductIncidentSchema = z
  .object({
    resolutionSummary: z.string().trim().min(3).max(1200),
  })
  .strict();

export const listConductIncidentsQuerySchema = z.object({
  studentId: z.string().uuid().optional(),
  classRoomId: z.string().uuid().optional(),
  status: conductIncidentStatusSchema.optional(),
  severity: conductSeveritySchema.optional(),
  q: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const studentConductProfileQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateConductIncidentInput = z.infer<typeof createConductIncidentSchema>;
export type UpdateConductIncidentInput = z.infer<typeof updateConductIncidentSchema>;
export type AddConductActionInput = z.infer<typeof addConductActionSchema>;
export type ResolveConductIncidentInput = z.infer<typeof resolveConductIncidentSchema>;
export type ListConductIncidentsQueryInput = z.infer<typeof listConductIncidentsQuerySchema>;
export type StudentConductProfileQueryInput = z.infer<typeof studentConductProfileQuerySchema>;
