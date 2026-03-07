import { ParentRelationship } from '@prisma/client';
import { z } from 'zod';

export const createParentSchema = z.object({
  parentCode: z.string().trim().min(1).max(40).optional(),
  firstName: z.string().trim().min(2).max(80),
  lastName: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: z.string().trim().min(6).max(40).optional(),
  createLogin: z.boolean().default(false),
  password: z.string().min(8).max(128).optional(),
});

export const updateParentSchema = z
  .object({
    parentCode: z.string().trim().min(1).max(40).optional(),
    firstName: z.string().trim().min(2).max(80).optional(),
    lastName: z.string().trim().min(2).max(80).optional(),
    email: z.string().trim().toLowerCase().email().nullable().optional(),
    phone: z.string().trim().min(6).max(40).nullable().optional(),
    isActive: z.boolean().optional(),
    createLogin: z.boolean().optional(),
    password: z.string().min(8).max(128).optional(),
  })
  .strict();

export const linkParentStudentSchema = z.object({
  studentId: z.string().uuid(),
  relationship: z.nativeEnum(ParentRelationship).default(ParentRelationship.GUARDIAN),
  isPrimary: z.boolean().default(false),
});

export const listParentsQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const listLinkableStudentsQuerySchema = z.object({
  classId: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(120).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

const schoolDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

export const parentStudentAttendanceHistoryQuerySchema = z
  .object({
    from: schoolDateSchema.optional(),
    to: schoolDateSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.from && value.to && value.from > value.to) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['from'],
        message: 'from date must be less than or equal to to date',
      });
    }
  });

export type CreateParentInput = z.infer<typeof createParentSchema>;
export type UpdateParentInput = z.infer<typeof updateParentSchema>;
export type LinkParentStudentInput = z.infer<typeof linkParentStudentSchema>;
export type ListParentsQueryInput = z.infer<typeof listParentsQuerySchema>;
export type ListLinkableStudentsQueryInput = z.infer<typeof listLinkableStudentsQuerySchema>;
export type ParentStudentAttendanceHistoryQueryInput = z.infer<
  typeof parentStudentAttendanceHistoryQuerySchema
>;
