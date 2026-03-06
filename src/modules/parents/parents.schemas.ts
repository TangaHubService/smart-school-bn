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
  q: z.string().trim().min(1).max(120).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

export type CreateParentInput = z.infer<typeof createParentSchema>;
export type UpdateParentInput = z.infer<typeof updateParentSchema>;
export type LinkParentStudentInput = z.infer<typeof linkParentStudentSchema>;
export type ListParentsQueryInput = z.infer<typeof listParentsQuerySchema>;
export type ListLinkableStudentsQueryInput = z.infer<typeof listLinkableStudentsQuerySchema>;
