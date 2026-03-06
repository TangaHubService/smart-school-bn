import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import { ExamsService } from './exams.service';
import {
  listExamsQuerySchema,
  parentReportCardsQuerySchema,
  reportCardsQuerySchema,
} from './exams.schemas';

const examsService = new ExamsService();

function buildContext(req: Request) {
  return {
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  };
}

export class ExamsController {
  async verifyReportCard(req: Request, res: Response) {
    const result = await examsService.verifyPublishedReportCard(req.params.snapshotId);
    return sendSuccess(req, res, result);
  }

  async listGradingSchemes(req: Request, res: Response) {
    const result = await examsService.listGradingSchemes(req.tenantId!);
    return sendSuccess(req, res, result);
  }

  async createGradingScheme(req: Request, res: Response) {
    const result = await examsService.createGradingScheme(req.tenantId!, req.body, req.user!, buildContext(req));
    return sendSuccess(req, res, result, 201);
  }

  async createExam(req: Request, res: Response) {
    const result = await examsService.createExam(req.tenantId!, req.body, req.user!, buildContext(req));
    return sendSuccess(req, res, result, 201);
  }

  async listExams(req: Request, res: Response) {
    const query = listExamsQuerySchema.parse(req.query);
    const result = await examsService.listExams(req.tenantId!, query, req.user!);
    return sendSuccess(req, res, result, 200, result.pagination);
  }

  async getExamDetail(req: Request, res: Response) {
    const result = await examsService.getExamDetail(req.tenantId!, req.params.examId, req.user!);
    return sendSuccess(req, res, result);
  }

  async bulkSaveMarks(req: Request, res: Response) {
    const result = await examsService.bulkSaveMarks(req.tenantId!, req.params.examId, req.body, req.user!, buildContext(req));
    return sendSuccess(req, res, result);
  }

  async lockResults(req: Request, res: Response) {
    const result = await examsService.lockResults(req.tenantId!, req.body, req.user!, buildContext(req));
    return sendSuccess(req, res, result);
  }

  async unlockResults(req: Request, res: Response) {
    const result = await examsService.unlockResults(req.tenantId!, req.body, req.user!, buildContext(req));
    return sendSuccess(req, res, result);
  }

  async publishResults(req: Request, res: Response) {
    const result = await examsService.publishResults(req.tenantId!, req.body, req.user!, buildContext(req));
    return sendSuccess(req, res, result);
  }

  async getStudentReportCards(req: Request, res: Response) {
    const query = reportCardsQuerySchema.parse(req.query);
    const result = await examsService.getStudentReportCards(req.tenantId!, req.params.studentId, req.user!, query);
    return sendSuccess(req, res, result);
  }

  async getMyReportCards(req: Request, res: Response) {
    const query = reportCardsQuerySchema.parse(req.query);
    const result = await examsService.getMyReportCards(req.tenantId!, req.user!, query);
    return sendSuccess(req, res, result);
  }

  async getParentReportCards(req: Request, res: Response) {
    const query = parentReportCardsQuerySchema.parse(req.query);
    const result = await examsService.getParentReportCards(req.tenantId!, req.user!, query);
    return sendSuccess(req, res, result);
  }

  async downloadStudentReportCardPdf(req: Request, res: Response) {
    const query = reportCardsQuerySchema.parse(req.query);
    const result = await examsService.getAdminReportCardPdf(req.tenantId!, req.params.studentId, req.user!, query, buildContext(req));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${result.fileName}"`);
    return res.status(200).send(result.buffer);
  }

  async downloadMyReportCardPdf(req: Request, res: Response) {
    const result = await examsService.getMyReportCardPdf(req.tenantId!, req.params.snapshotId, req.user!, buildContext(req));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${result.fileName}"`);
    return res.status(200).send(result.buffer);
  }

  async downloadParentReportCardPdf(req: Request, res: Response) {
    const result = await examsService.getParentReportCardPdf(req.tenantId!, req.params.snapshotId, req.user!, buildContext(req));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${result.fileName}"`);
    return res.status(200).send(result.buffer);
  }
}
