import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import { LocationsService } from './locations.service';
import { listDivisionsQuerySchema } from './locations.schemas';

const locationsService = new LocationsService();

export class LocationsController {
  async listCountries(req: Request, res: Response) {
    const result = await locationsService.listEacCountries();
    return sendSuccess(req, res, result);
  }

  async listDivisions(req: Request, res: Response) {
    const { countryCode } = req.params;
    const query = listDivisionsQuerySchema.parse(req.query);
    const result = await locationsService.getDivisions(countryCode, query.level, query.parentId);
    return sendSuccess(req, res, result);
  }
}
