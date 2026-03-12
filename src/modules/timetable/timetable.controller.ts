import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import {
  bulkUpsertTimetableSlotsSchema,
  listTimetableSlotsQuerySchema,
  updateTimetableSlotSchema,
} from './timetable.schemas';
import { TimetableService } from './timetable.service';

const timetableService = new TimetableService();

export class TimetableController {
  async listSlots(req: Request, res: Response): Promise<Response> {
    const query = listTimetableSlotsQuerySchema.parse(req.query);
    const result = await timetableService.listSlots(
      req.tenantId!,
      query,
      req.user ?? undefined,
    );
    return sendSuccess(req, res, result);
  }

  async createSlot(req: Request, res: Response): Promise<Response> {
    const result = await timetableService.createSlot(
      req.tenantId!,
      req.body,
      req.user!,
    );
    return sendSuccess(req, res, result, 201);
  }

  async updateSlot(req: Request, res: Response): Promise<Response> {
    const body = updateTimetableSlotSchema.parse(req.body);
    const result = await timetableService.updateSlot(
      req.tenantId!,
      req.params.id,
      body,
      req.user!,
    );
    return sendSuccess(req, res, result);
  }

  async deleteSlot(req: Request, res: Response): Promise<Response> {
    const result = await timetableService.deleteSlot(
      req.tenantId!,
      req.params.id,
      req.user!,
    );
    return sendSuccess(req, res, result);
  }

  async bulkUpsertSlots(req: Request, res: Response): Promise<Response> {
    const body = bulkUpsertTimetableSlotsSchema.parse(req.body);
    const result = await timetableService.bulkUpsertSlots(
      req.tenantId!,
      body,
      req.user!,
    );
    return sendSuccess(req, res, result);
  }
}
