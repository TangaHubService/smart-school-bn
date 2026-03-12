import { AttendanceStatus } from '@prisma/client';
import { z } from 'zod';

const schoolDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

export const attendanceStatusSchema = z.nativeEnum(AttendanceStatus);

export const createAttendanceSessionSchema = z.object({
  classRoomId: z.string().uuid(),
  date: schoolDateSchema,
  academicYearId: z.string().uuid().optional(),
});

export const bulkAttendanceRecordsSchema = z
  .object({
    sessionId: z.string().uuid().optional(),
    classRoomId: z.string().uuid().optional(),
    date: schoolDateSchema.optional(),
    academicYearId: z.string().uuid().optional(),
    records: z
      .array(
        z.object({
          studentId: z.string().uuid(),
          status: attendanceStatusSchema,
          remarks: z.string().trim().max(300).optional(),
        }),
      )
      .min(1)
      .max(200),
  })
  .superRefine((value, context) => {
    if (!value.sessionId && !(value.classRoomId && value.date)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sessionId'],
        message: 'Provide sessionId or both classRoomId and date',
      });
    }
  });

export const listAttendanceClassesQuerySchema = z.object({
  teacherOnly: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

export const classAttendanceQuerySchema = z.object({
  date: schoolDateSchema.optional(),
});

export const attendanceSummaryQuerySchema = z.object({
  date: schoolDateSchema.optional(),
});

export const studentAttendanceHistoryQuerySchema = z
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

export type ListAttendanceClassesQueryInput = z.infer<typeof listAttendanceClassesQuerySchema>;
export type CreateAttendanceSessionInput = z.infer<typeof createAttendanceSessionSchema>;
export type BulkAttendanceRecordsInput = z.infer<typeof bulkAttendanceRecordsSchema>;
export type ClassAttendanceQueryInput = z.infer<typeof classAttendanceQuerySchema>;
export type AttendanceSummaryQueryInput = z.infer<typeof attendanceSummaryQuerySchema>;
export type StudentAttendanceHistoryQueryInput = z.infer<
  typeof studentAttendanceHistoryQuerySchema
>;
