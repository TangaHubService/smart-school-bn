import { z } from 'zod';

export const ticketStatusEnum = z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);
export const ticketPriorityEnum = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

export const createTicketSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  message: z.string().trim().min(10).max(10000),
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(160).optional(),
  priority: ticketPriorityEnum.optional(),
  attachments: z
    .array(
      z.object({
        fileAssetId: z.string().uuid().optional(),
        fileUrl: z.string().url().max(2000).optional(),
        originalName: z.string().min(1).max(255),
        mimeType: z.string().max(120).optional(),
        sizeBytes: z
          .number()
          .int()
          .positive()
          .max(10 * 1024 * 1024)
          .optional(),
      })
    )
    .max(5)
    .optional(),
});

export const listTicketsSchema = z.object({
  status: ticketStatusEnum.optional(),
  priority: ticketPriorityEnum.optional(),
  search: z.string().trim().max(120).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const replyTicketSchema = z.object({
  body: z.string().trim().min(1).max(10000),
  attachments: createTicketSchema.shape.attachments,
});

export const updateTicketSchema = z.object({
  status: ticketStatusEnum.optional(),
  priority: ticketPriorityEnum.optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type ListTicketsInput = z.infer<typeof listTicketsSchema>;
export type ReplyTicketInput = z.infer<typeof replyTicketSchema>;
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

/** Allowed attachment mime-types for contact/help-desk uploads (Rev #4). */
export const ALLOWED_TICKET_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'image/png',
  'image/jpeg',
]);

export const MAX_TICKET_ATTACHMENT_BYTES = 10 * 1024 * 1024;
