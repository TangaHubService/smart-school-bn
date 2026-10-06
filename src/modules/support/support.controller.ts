import { Request, Response } from 'express';

import { JwtUser } from '../../common/types/auth.types';
import { SupportService } from './support.service';
import {
  createTicketSchema,
  listTicketsSchema,
  replyTicketSchema,
  updateTicketSchema,
} from './support.schemas';

const service = new SupportService();

const actorOf = (req: Request): JwtUser => (req as unknown as { user: JwtUser }).user;

const isSuperAdmin = (actor: JwtUser) => actor.roles?.includes('SUPER_ADMIN') ?? false;

export class SupportController {
  async createPublicTicket(req: Request, res: Response) {
    const input = createTicketSchema.parse(req.body);
    const actor = (req as unknown as { user?: JwtUser }).user;
    const ticket = await service.createTicket(input, actor);
    res.status(201).json({ data: ticket });
  }

  async createTicket(req: Request, res: Response) {
    const input = createTicketSchema.parse(req.body);
    const ticket = await service.createTicket(input, actorOf(req));
    res.status(201).json({ data: ticket });
  }

  async listTickets(req: Request, res: Response) {
    const query = listTicketsSchema.parse(req.query);
    const actor = actorOf(req);
    const result = await service.listTickets(actor.tenantId, query, isSuperAdmin(actor));
    res.json(result);
  }

  async getTicket(req: Request, res: Response) {
    const actor = actorOf(req);
    const ticket = await service.getTicket(req.params.id, actor.tenantId, isSuperAdmin(actor));
    res.json({ data: ticket });
  }

  async replyTicket(req: Request, res: Response) {
    const input = replyTicketSchema.parse(req.body);
    const actor = actorOf(req);
    const isStaff =
      actor.roles?.some(r => ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'].includes(r)) ?? false;
    const reply = await service.replyToTicket(req.params.id, input, actor, isStaff);
    res.status(201).json({ data: reply });
  }

  async updateTicket(req: Request, res: Response) {
    const input = updateTicketSchema.parse(req.body);
    const ticket = await service.updateTicket(req.params.id, input, actorOf(req));
    res.json({ data: ticket });
  }
}
