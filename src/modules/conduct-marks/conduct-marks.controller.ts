import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import {
  createDeductionBodySchema,
  listStudentDeductionsQuerySchema,
  studentConductSummaryQuerySchema,
  termSettingBodySchema,
  termSettingsQuerySchema,
} from './conduct-marks.schemas';
import { ConductMarksService } from './conduct-marks.service';

const service = new ConductMarksService();

function buildContext(req: Request) {
  return {
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  };
}

export class ConductMarksController {
  async listTermSettings(req: Request, res: Response) {
    const query = termSettingsQuerySchema.parse(req.query);
    const result = await service.listTermSettings(req.tenantId!, query);
    return sendSuccess(req, res, result);
  }

  async upsertTermSetting(req: Request, res: Response) {
    const body = termSettingBodySchema.parse(req.body);
    const result = await service.upsertTermSetting(
      req.tenantId!,
      req.params.termId,
      body.totalMarks,
      req.user!,
      buildContext(req),
    );
    return sendSuccess(req, res, result);
  }

  async createDeduction(req: Request, res: Response) {
    const body = createDeductionBodySchema.parse(req.body);
    const result = await service.createDeduction(req.tenantId!, body, req.user!, buildContext(req));
    return sendSuccess(req, res, result, 201);
  }

  async listStudentDeductions(req: Request, res: Response) {
    const query = listStudentDeductionsQuerySchema.parse(req.query);
    const result = await service.listDeductionsForStudent(
      req.tenantId!,
      req.params.studentId,
      query,
      req.user!,
    );
    return sendSuccess(req, res, result);
  }

  async getStudentConductSummary(req: Request, res: Response) {
    const query = studentConductSummaryQuerySchema.parse(req.query);
    const result = await service.getStudentConductSummaryByTerm(
      req.tenantId!,
      req.params.studentId,
      query,
      req.user!,
    );
    return sendSuccess(req, res, result);
  }
}
