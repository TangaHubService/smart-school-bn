import { Prisma, SupportTicketStatus } from '@prisma/client';

import { AppError } from '../../common/errors/app-error';
import { JwtUser } from '../../common/types/auth.types';
import { prisma } from '../../db/prisma';
import {
  ALLOWED_TICKET_MIME_TYPES,
  CreateTicketInput,
  ListTicketsInput,
  MAX_TICKET_ATTACHMENT_BYTES,
  ReplyTicketInput,
  UpdateTicketInput,
} from './support.schemas';

function ticketNumber(): string {
  const year = new Date().getFullYear();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `TKT-${year}-${rand}`;
}

function validateAttachments(attachments: NonNullable<CreateTicketInput['attachments']>) {
  for (const a of attachments) {
    if (a.sizeBytes != null && a.sizeBytes > MAX_TICKET_ATTACHMENT_BYTES) {
      throw new AppError(400, 'ATTACHMENT_TOO_LARGE', `Attachment ${a.originalName} exceeds 10MB`);
    }
    if (a.mimeType && !ALLOWED_TICKET_MIME_TYPES.has(a.mimeType)) {
      throw new AppError(
        400,
        'ATTACHMENT_TYPE_NOT_ALLOWED',
        `Attachment ${a.originalName} has unsupported type ${a.mimeType}`
      );
    }
  }
}

export class SupportService {
  /** Public + authenticated ticket creation. Anonymous tickets carry name/email. */
  async createTicket(input: CreateTicketInput, actor?: JwtUser) {
    if (input.attachments?.length) validateAttachments(input.attachments);
    const tenantId = actor?.tenantId ?? null;
    const createdByUserId = actor?.sub ?? null;

    const ticket = await prisma.supportTicket.create({
      data: {
        ticketNumber: ticketNumber(),
        tenantId,
        createdByUserId,
        name: input.name ?? (actor ? undefined : undefined),
        email: input.email ?? undefined,
        subject: input.subject,
        message: input.message,
        priority: (input.priority ?? 'NORMAL') as never,
        attachments: input.attachments?.length
          ? {
              create: input.attachments.map(a => ({
                fileAssetId: a.fileAssetId ?? null,
                fileUrl: a.fileUrl ?? null,
                originalName: a.originalName,
                mimeType: a.mimeType ?? null,
                sizeBytes: a.sizeBytes ?? null,
              })),
            }
          : undefined,
      },
      include: { attachments: true },
    });
    return ticket;
  }

  async listTickets(tenantId: string | null, query: ListTicketsInput, scopeAll: boolean) {
    const where: Prisma.SupportTicketWhereInput = {};
    if (!scopeAll && tenantId) where.tenantId = tenantId;
    if (query.status) where.status = query.status as SupportTicketStatus;
    if (query.priority) where.priority = query.priority as never;
    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { subject: { contains: s, mode: 'insensitive' } },
        { message: { contains: s, mode: 'insensitive' } },
        { ticketNumber: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
      ];
    }
    if (query.from || query.to) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (query.from) {
        const d = new Date(query.from);
        if (Number.isNaN(d.getTime())) throw new AppError(400, 'INVALID_DATE', 'Invalid from date');
        createdAt.gte = d;
      }
      if (query.to) {
        const d = new Date(query.to);
        if (Number.isNaN(d.getTime())) throw new AppError(400, 'INVALID_DATE', 'Invalid to date');
        createdAt.lte = d;
      }
      if (createdAt.gte && createdAt.lte && createdAt.gte > createdAt.lte) {
        throw new AppError(400, 'INVALID_DATE_RANGE', 'From date must be before To date');
      }
      where.createdAt = createdAt;
    }

    const [total, tickets] = await Promise.all([
      prisma.supportTicket.count({ where }),
      prisma.supportTicket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          attachments: true,
          replies: { orderBy: { createdAt: 'asc' }, include: { attachments: true } },
        },
      }),
    ]);
    return {
      data: tickets,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async getTicket(id: string, tenantId: string | null, scopeAll: boolean) {
    const ticket = await prisma.supportTicket.findFirst({
      where: { id, ...(scopeAll ? {} : tenantId ? { tenantId } : { tenantId: null }) },
      include: {
        attachments: true,
        replies: { orderBy: { createdAt: 'asc' }, include: { attachments: true } },
      },
    });
    if (!ticket) throw new AppError(404, 'TICKET_NOT_FOUND', 'Ticket not found');
    return ticket;
  }

  async replyToTicket(id: string, input: ReplyTicketInput, actor: JwtUser, isStaff: boolean) {
    if (input.attachments?.length) validateAttachments(input.attachments);
    const ticket = await prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw new AppError(404, 'TICKET_NOT_FOUND', 'Ticket not found');
    // Tenant isolation for non-super-admin staff
    const isSuper = actor.roles?.includes('SUPER_ADMIN');
    if (!isSuper && ticket.tenantId && ticket.tenantId !== actor.tenantId) {
      throw new AppError(403, 'TICKET_FORBIDDEN', 'Access denied to this ticket');
    }
    const reply = await prisma.ticketReply.create({
      data: {
        ticketId: id,
        tenantId: ticket.tenantId,
        authorUserId: actor.sub,
        body: input.body,
        isStaffReply: isStaff,
        attachments: input.attachments?.length
          ? {
              create: input.attachments.map(a => ({
                ticketId: id,
                fileAssetId: a.fileAssetId ?? null,
                fileUrl: a.fileUrl ?? null,
                originalName: a.originalName,
                mimeType: a.mimeType ?? null,
                sizeBytes: a.sizeBytes ?? null,
              })),
            }
          : undefined,
      },
      include: { attachments: true },
    });
    // Reopen resolved flow: staff reply moves to IN_PROGRESS
    if (isStaff && (ticket.status === 'OPEN' || ticket.status === 'RESOLVED')) {
      await prisma.supportTicket.update({
        where: { id },
        data: { status: 'IN_PROGRESS' as SupportTicketStatus },
      });
    }
    return reply;
  }

  async updateTicket(id: string, input: UpdateTicketInput, actor: JwtUser) {
    const ticket = await prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw new AppError(404, 'TICKET_NOT_FOUND', 'Ticket not found');
    const isSuper = actor.roles?.includes('SUPER_ADMIN');
    if (!isSuper && ticket.tenantId && ticket.tenantId !== actor.tenantId) {
      throw new AppError(403, 'TICKET_FORBIDDEN', 'Access denied to this ticket');
    }
    const data: Prisma.SupportTicketUpdateInput = {};
    if (input.status) {
      data.status = input.status as SupportTicketStatus;
      if (input.status === 'RESOLVED') data.resolvedAt = new Date();
      if (input.status === 'CLOSED') data.closedAt = new Date();
    }
    if (input.priority) data.priority = input.priority as never;
    if (input.assignedToUserId !== undefined) {
      data.assignedToUserId = input.assignedToUserId;
    }
    return prisma.supportTicket.update({ where: { id }, data });
  }
}
