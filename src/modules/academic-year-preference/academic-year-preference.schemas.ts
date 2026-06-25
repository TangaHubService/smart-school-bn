import { z } from 'zod';

export const setAcademicYearPreferenceSchema = z.object({
  academicYearId: z.string().uuid(),
  termId: z.string().uuid().optional(),
}).strict();

export const listAcademicYearsQuerySchema = z.object({
  isActive: z.coerce.boolean().optional(),
});

export type SetAcademicYearPreferenceInput = z.infer<typeof setAcademicYearPreferenceSchema>;
