import { z } from 'zod';

const timeSchema = z.string().regex(/^\d{1,2}:\d{2}$/, 'Time must be HH:mm');

export const createTimetableSlotSchema = z.object({
  academicYearId: z.string().uuid(),
  termId: z.string().uuid(),
  classRoomId: z.string().uuid(),
  courseId: z.string().uuid(),
  dayOfWeek: z.number().int().min(1).max(5),
  periodNumber: z.number().int().min(1).max(12),
  startTime: timeSchema,
  endTime: timeSchema,
});

export const updateTimetableSlotSchema = createTimetableSlotSchema.partial();

export const listTimetableSlotsQuerySchema = z.object({
  academicYearId: z.string().uuid(),
  termId: z.string().uuid().optional(),
  classRoomId: z.string().uuid(),
});

const bulkSlotSchema = z.object({
  courseId: z.string().uuid(),
  dayOfWeek: z.number().int().min(1).max(5),
  periodNumber: z.number().int().min(1).max(12),
  startTime: timeSchema,
  endTime: timeSchema,
});

export const bulkUpsertTimetableSlotsSchema = z.object({
  academicYearId: z.string().uuid(),
  termId: z.string().uuid(),
  classRoomId: z.string().uuid(),
  slots: z.array(bulkSlotSchema).min(1).max(200),
});

export type CreateTimetableSlotInput = z.infer<typeof createTimetableSlotSchema>;
export type UpdateTimetableSlotInput = z.infer<typeof updateTimetableSlotSchema>;
export type ListTimetableSlotsQueryInput = z.infer<typeof listTimetableSlotsQuerySchema>;
export type BulkUpsertTimetableSlotsInput = z.infer<typeof bulkUpsertTimetableSlotsSchema>;
