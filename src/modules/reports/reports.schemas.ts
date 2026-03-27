import { z } from 'zod';

export const academicByClassQuerySchema = z
  .object({
    termId: z.string().uuid(),
    classRoomId: z.string().uuid().optional(),
    q: z.string().trim().max(120).optional(),
  })
  .strict();

export const academicStudentQuerySchema = z
  .object({
    termId: z.string().uuid(),
  })
  .strict();

export const academicClassQuerySchema = z
  .object({
    termId: z.string().uuid(),
  })
  .strict();

export const academicSubjectQuerySchema = z
  .object({
    termId: z.string().uuid(),
    subjectId: z.string().uuid(),
    classRoomId: z.string().uuid().optional(),
  })
  .strict();

export const attendanceSchoolQuerySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();

export const attendanceByClassQuerySchema = attendanceSchoolQuerySchema;

export const attendanceAbsenteeismQuerySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    minAbsent: z.coerce.number().int().min(1).max(365).default(3),
  })
  .strict();

export type AcademicByClassQueryInput = z.infer<typeof academicByClassQuerySchema>;
export type AcademicStudentQueryInput = z.infer<typeof academicStudentQuerySchema>;
export type AcademicClassQueryInput = z.infer<typeof academicClassQuerySchema>;
export type AcademicSubjectQueryInput = z.infer<typeof academicSubjectQuerySchema>;
export type AttendanceSchoolQueryInput = z.infer<typeof attendanceSchoolQuerySchema>;
export type AttendanceByClassQueryInput = z.infer<typeof attendanceByClassQuerySchema>;
export type AttendanceAbsenteeismQueryInput = z.infer<typeof attendanceAbsenteeismQuerySchema>;

export const teacherReportsBaseQuerySchema = z
  .object({
    academicYearId: z.string().uuid(),
    termId: z.string().uuid().optional(),
  })
  .strict();

export const teacherActivityQuerySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();

export const timetableReportQuerySchema = z
  .object({
    academicYearId: z.string().uuid(),
    termId: z.string().uuid().optional(),
    classRoomId: z.string().uuid().optional(),
    teacherUserId: z.string().uuid().optional(),
    dayOfWeek: z.coerce.number().int().min(1).max(5).optional(),
  })
  .strict();

export const conductSchoolReportQuerySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    classRoomId: z.string().uuid().optional(),
    status: z.enum(['OPEN', 'UNDER_REVIEW', 'RESOLVED']).optional(),
    severity: z.enum(['LOW', 'MODERATE', 'HIGH', 'CRITICAL']).optional(),
  })
  .strict();

export const conductStudentReportQuerySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();

export type TeacherReportsBaseQueryInput = z.infer<typeof teacherReportsBaseQuerySchema>;
export type TeacherActivityQueryInput = z.infer<typeof teacherActivityQuerySchema>;
export type TimetableReportQueryInput = z.infer<typeof timetableReportQuerySchema>;
export type ConductSchoolReportQueryInput = z.infer<typeof conductSchoolReportQuerySchema>;
export type ConductStudentReportQueryInput = z.infer<typeof conductStudentReportQuerySchema>;
