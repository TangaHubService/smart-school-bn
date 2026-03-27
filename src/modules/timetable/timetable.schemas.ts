import { z } from 'zod';

const timeSchema = z.string().regex(/^\d{1,2}:\d{2}$/, 'Time must be HH:mm');

const createTimetableSlotBaseSchema = z.object({
  academicYearId: z.string().uuid(),
  termId: z.string().uuid(),
  classRoomId: z.string().uuid(),
  courseId: z.string().uuid(),
  dayOfWeek: z.number().int().min(1).max(5),
  periodNumber: z.number().int().min(1).max(12),
  startTime: timeSchema,
  endTime: timeSchema,
});

export const createTimetableSlotSchema = createTimetableSlotBaseSchema.superRefine((value, ctx) => {
  const [sh, sm] = value.startTime.split(':').map(Number);
  const [eh, em] = value.endTime.split(':').map(Number);
  const start = sh * 60 + (sm || 0);
  const end = eh * 60 + (em || 0);
  if (end <= start) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endTime'],
      message: 'End time must be after start time',
    });
  }
});

export const updateTimetableSlotSchema = createTimetableSlotBaseSchema.partial();

export const listTimetableSlotsQuerySchema = z.object({
  academicYearId: z.string().uuid(),
  termId: z.string().uuid().optional(),
  classRoomId: z.string().uuid().optional(),
  teacherUserId: z.string().uuid().optional(),
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
}).superRefine((value, ctx) => {
  const periodKeys = new Set<string>();
  for (let index = 0; index < value.slots.length; index += 1) {
    const slot = value.slots[index];
    const key = `${slot.dayOfWeek}:${slot.periodNumber}`;
    if (periodKeys.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['slots', index, 'periodNumber'],
        message: 'Duplicate class period in bulk timetable payload',
      });
    }
    periodKeys.add(key);
    const [sh, sm] = slot.startTime.split(':').map(Number);
    const [eh, em] = slot.endTime.split(':').map(Number);
    if (eh * 60 + (em || 0) <= sh * 60 + (sm || 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['slots', index, 'endTime'],
        message: 'End time must be after start time',
      });
    }
  }
});

export type CreateTimetableSlotInput = z.infer<typeof createTimetableSlotSchema>;
export type UpdateTimetableSlotInput = z.infer<typeof updateTimetableSlotSchema>;
export type ListTimetableSlotsQueryInput = z.infer<typeof listTimetableSlotsQuerySchema>;
export type BulkUpsertTimetableSlotsInput = z.infer<typeof bulkUpsertTimetableSlotsSchema>;
