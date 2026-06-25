import { Request, Response } from 'express';
import { sendSuccess } from '../../common/utils/response';
import { AcademicYearPreferenceService } from './academic-year-preference.service';
import { listAcademicYearsQuerySchema, setAcademicYearPreferenceSchema } from './academic-year-preference.schemas';

const service = new AcademicYearPreferenceService();

export class AcademicYearPreferenceController {
  async getPreference(req: Request, res: Response) {
    const result = await service.getPreference(req.tenantId!, req.user!.sub);
    return sendSuccess(req, res, result);
  }

  async setPreference(req: Request, res: Response) {
    const input = setAcademicYearPreferenceSchema.parse(req.body);
    const result = await service.setPreference(req.tenantId!, req.user!.sub, input);
    return sendSuccess(req, res, result);
  }

  async listAcademicYears(req: Request, res: Response) {
    const query = listAcademicYearsQuerySchema.parse(req.query);
    const items = await service.listAcademicYears(req.tenantId!, query.isActive);
    return sendSuccess(req, res, { items });
  }
}
