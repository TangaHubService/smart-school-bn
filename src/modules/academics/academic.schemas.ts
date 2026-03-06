import { z } from 'zod';

const isoDate = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));

export const createAcademicYearSchema = z.object({
  name: z.string().trim().min(2).max(100),
  startDate: isoDate,
  endDate: isoDate,
  isCurrent: z.boolean().optional().default(false),
});

export const updateAcademicYearSchema = createAcademicYearSchema.partial();

export const createTermSchema = z.object({
  academicYearId: z.string().uuid(),
  name: z.string().trim().min(2).max(100),
  sequence: z.number().int().min(1).max(10),
  startDate: isoDate,
  endDate: isoDate,
});

export const updateTermSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    sequence: z.number().int().min(1).max(10).optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const listTermsQuerySchema = z.object({
  academicYearId: z.string().uuid().optional(),
});

export const createGradeLevelSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(2).max(80),
  rank: z.number().int().min(1).max(20),
});

export const updateGradeLevelSchema = z
  .object({
    code: z.string().trim().min(1).max(30).optional(),
    name: z.string().trim().min(2).max(80).optional(),
    rank: z.number().int().min(1).max(20).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const createClassRoomSchema = z.object({
  gradeLevelId: z.string().uuid(),
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(80),
  capacity: z.number().int().min(1).max(200).optional(),
});

export const updateClassRoomSchema = z
  .object({
    gradeLevelId: z.string().uuid().optional(),
    code: z.string().trim().min(1).max(30).optional(),
    name: z.string().trim().min(1).max(80).optional(),
    capacity: z.number().int().min(1).max(200).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const createSubjectSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(300).optional(),
  isCore: z.boolean().optional().default(false),
});

export const updateSubjectSchema = z
  .object({
    code: z.string().trim().min(1).max(30).optional(),
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(300).nullable().optional(),
    isCore: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export type CreateAcademicYearInput = z.infer<typeof createAcademicYearSchema>;
export type UpdateAcademicYearInput = z.infer<typeof updateAcademicYearSchema>;
export type CreateTermInput = z.infer<typeof createTermSchema>;
export type UpdateTermInput = z.infer<typeof updateTermSchema>;
export type ListTermsQueryInput = z.infer<typeof listTermsQuerySchema>;
export type CreateGradeLevelInput = z.infer<typeof createGradeLevelSchema>;
export type UpdateGradeLevelInput = z.infer<typeof updateGradeLevelSchema>;
export type CreateClassRoomInput = z.infer<typeof createClassRoomSchema>;
export type UpdateClassRoomInput = z.infer<typeof updateClassRoomSchema>;
export type CreateSubjectInput = z.infer<typeof createSubjectSchema>;
export type UpdateSubjectInput = z.infer<typeof updateSubjectSchema>;
