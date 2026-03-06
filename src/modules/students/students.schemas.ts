import { StudentGender } from '@prisma/client';
import { z } from 'zod';

const isoDate = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));

export const studentGenderSchema = z.nativeEnum(StudentGender);

const enrollmentSchema = z.object({
  academicYearId: z.string().uuid(),
  classRoomId: z.string().uuid(),
  enrolledAt: isoDate.optional(),
});

export const createStudentSchema = z.object({
  studentCode: z.string().trim().min(1).max(40),
  firstName: z.string().trim().min(2).max(80),
  lastName: z.string().trim().min(2).max(80),
  gender: studentGenderSchema.optional(),
  dateOfBirth: isoDate.optional(),
  enrollment: enrollmentSchema,
});

export const updateStudentSchema = z
  .object({
    studentCode: z.string().trim().min(1).max(40).optional(),
    firstName: z.string().trim().min(2).max(80).optional(),
    lastName: z.string().trim().min(2).max(80).optional(),
    gender: studentGenderSchema.nullable().optional(),
    dateOfBirth: isoDate.nullable().optional(),
    isActive: z.boolean().optional(),
    enrollment: enrollmentSchema.optional(),
  })
  .strict();

export const listStudentsQuerySchema = z.object({
  classId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const studentImportSchema = z.object({
  csv: z.string().min(1, 'CSV content is required'),
  mode: z.enum(['preview', 'commit']).default('preview'),
  allowPartial: z.boolean().default(false),
  defaultAcademicYearId: z.string().uuid().optional(),
  defaultClassRoomId: z.string().uuid().optional(),
});

export type CreateStudentInput = z.infer<typeof createStudentSchema>;
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;
export type ListStudentsQueryInput = z.infer<typeof listStudentsQuerySchema>;
export type StudentImportInput = z.infer<typeof studentImportSchema>;
