import { z } from 'zod';

const isoDate = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));

export const schoolSetupSchema = z.object({
  school: z
    .object({
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
    })
    .optional(),
  academicYear: z
    .object({
      name: z.string().trim().min(2).max(100),
      startDate: isoDate,
      endDate: isoDate,
      isCurrent: z.boolean().default(true),
      terms: z
        .array(
          z.object({
            name: z.string().trim().min(2).max(100),
            sequence: z.number().int().min(1),
            startDate: isoDate,
            endDate: isoDate,
          }),
        )
        .max(6)
        .optional()
        .default([]),
    })
    .optional(),
  gradeLevels: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(30),
        name: z.string().trim().min(2).max(80),
        rank: z.number().int().min(1).max(20),
        classes: z
          .array(
            z.object({
              code: z.string().trim().min(1).max(30),
              name: z.string().trim().min(1).max(80),
              capacity: z.number().int().min(1).max(200).optional(),
            }),
          )
          .optional()
          .default([]),
      }),
    )
    .optional()
    .default([]),
  subjects: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(30),
        name: z.string().trim().min(2).max(100),
        description: z.string().trim().max(300).optional(),
        isCore: z.boolean().default(false),
      }),
    )
    .optional()
    .default([]),
  markSetupComplete: z.boolean().optional().default(true),
});

export type SchoolSetupInput = z.infer<typeof schoolSetupSchema>;
