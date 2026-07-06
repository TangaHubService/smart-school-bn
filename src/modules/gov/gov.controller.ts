import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import { GovService } from './gov.service';
import {
  submitAcademicAuditSchema,
  academicAuditQuerySchema,
  updateAcademicAuditSchema,
  reviewAcademicAuditSchema,
  reopenAcademicAuditSchema,
} from './gov.schemas';

const govService = new GovService();

export class GovController {
  async getDashboard(req: Request, res: Response) {
    const result = await govService.getAuditorDashboard(req.user!);
    return sendSuccess(req, res, result);
  }

  async listSchools(req: Request, res: Response) {
    const result = await govService.listSchoolsInScope(req.user!);
    return sendSuccess(req, res, result);
  }

  async getSchoolAttendance(req: Request, res: Response) {
    const { schoolId } = req.params;
    const result = await govService.getSchoolAttendanceData(req.user!, schoolId);
    return sendSuccess(req, res, result);
  }

  async getSchoolCourses(req: Request, res: Response) {
    const { schoolId } = req.params;
    const result = await govService.getSchoolCoursesData(req.user!, schoolId);
    return sendSuccess(req, res, result);
  }

  async getSchoolLearningInsights(req: Request, res: Response) {
    const { schoolId } = req.params;
    const result = await govService.getSchoolLearningInsightsData(req.user!, schoolId);
    return sendSuccess(req, res, result);
  }

  async getSchoolAssessments(req: Request, res: Response) {
    const { schoolId } = req.params;
    const result = await govService.getSchoolAssessmentsData(req.user!, schoolId);
    return sendSuccess(req, res, result);
  }

  async getSchoolMarks(req: Request, res: Response) {
    const { schoolId } = req.params;
    const result = await govService.getSchoolMarksData(req.user!, schoolId);
    return sendSuccess(req, res, result);
  }

  async getSchoolTimetable(req: Request, res: Response) {
    const { schoolId } = req.params;
    const result = await govService.getSchoolTimetableData(req.user!, schoolId);
    return sendSuccess(req, res, result);
  }

  async submitAudit(req: Request, res: Response) {
    const input = submitAcademicAuditSchema.parse(req.body);
    const result = await govService.submitAcademicAudit(req.user!, input);
    return sendSuccess(req, res, result, 201);
  }

  async listAudits(req: Request, res: Response) {
    const query = academicAuditQuerySchema.parse(req.query);
    const result = await govService.listMyAudits(req.user!, query);
    return sendSuccess(req, res, result);
  }

  async getAudit(req: Request, res: Response) {
    const { id } = req.params;
    const result = await govService.getAuditById(req.user!, id);
    return sendSuccess(req, res, result);
  }

  async updateAudit(req: Request, res: Response) {
    const input = updateAcademicAuditSchema.parse(req.body);
    const result = await govService.updateAcademicAudit(req.user!, req.params.id, input);
    return sendSuccess(req, res, result);
  }

  async submitDraftAudit(req: Request, res: Response) {
    const result = await govService.submitDraftAudit(req.user!, req.params.id);
    return sendSuccess(req, res, result);
  }

  async reviewAudit(req: Request, res: Response) {
    const input = reviewAcademicAuditSchema.parse(req.body);
    const result = await govService.reviewAcademicAudit(req.user!, req.params.id, input);
    return sendSuccess(req, res, result);
  }

  async reopenAudit(req: Request, res: Response) {
    const input = reopenAcademicAuditSchema.parse(req.body);
    const result = await govService.reopenAcademicAudit(req.user!, req.params.id, input);
    return sendSuccess(req, res, result);
  }

  async downloadAuditPdf(req: Request, res: Response) {
    const result = await govService.getAuditReportPdf(req.user!, req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${result.fileName}"`);
    return res.status(200).send(result.buffer);
  }
}
