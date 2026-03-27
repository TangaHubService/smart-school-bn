import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import {
  academicByClassQuerySchema,
  academicClassQuerySchema,
  academicStudentQuerySchema,
  academicSubjectQuerySchema,
  attendanceAbsenteeismQuerySchema,
  attendanceByClassQuerySchema,
  attendanceSchoolQuerySchema,
  conductSchoolReportQuerySchema,
  conductStudentReportQuerySchema,
  teacherActivityQuerySchema,
  teacherReportsBaseQuerySchema,
  timetableReportQuerySchema,
} from './reports.schemas';
import { ReportsOpsService } from './reports-ops.service';
import { ReportsService } from './reports.service';

const reportsService = new ReportsService();
const reportsOps = new ReportsOpsService();

export class ReportsController {
  async academicByClass(req: Request, res: Response) {
    const query = academicByClassQuerySchema.parse(req.query);
    const result = await reportsService.academicByClass(req.tenantId!, query, req.user!);
    return sendSuccess(req, res, result);
  }

  async academicStudent(req: Request, res: Response) {
    const query = academicStudentQuerySchema.parse(req.query);
    const result = await reportsService.academicStudent(
      req.tenantId!,
      req.params.studentId,
      query,
      req.user!,
    );
    return sendSuccess(req, res, result);
  }

  async academicClass(req: Request, res: Response) {
    const query = academicClassQuerySchema.parse(req.query);
    const result = await reportsService.academicClass(
      req.tenantId!,
      req.params.classRoomId,
      query,
      req.user!,
    );
    return sendSuccess(req, res, result);
  }

  async academicSubject(req: Request, res: Response) {
    const query = academicSubjectQuerySchema.parse(req.query);
    const result = await reportsService.academicSubject(req.tenantId!, query, req.user!);
    return sendSuccess(req, res, result);
  }

  async attendanceSchool(req: Request, res: Response) {
    const query = attendanceSchoolQuerySchema.parse(req.query);
    const result = await reportsService.attendanceSchool(req.tenantId!, query, req.user!);
    return sendSuccess(req, res, result);
  }

  async attendanceByClass(req: Request, res: Response) {
    const query = attendanceByClassQuerySchema.parse(req.query);
    const result = await reportsService.attendanceByClass(req.tenantId!, query, req.user!);
    return sendSuccess(req, res, result);
  }

  async attendanceAbsenteeism(req: Request, res: Response) {
    const query = attendanceAbsenteeismQuerySchema.parse(req.query);
    const result = await reportsService.attendanceAbsenteeism(req.tenantId!, query, req.user!);
    return sendSuccess(req, res, result);
  }

  async attendanceSummaryCards(req: Request, res: Response) {
    const result = await reportsService.attendanceSummaryCards(req.tenantId!, req.user!);
    return sendSuccess(req, res, result);
  }

  async teachersWorkload(req: Request, res: Response) {
    const query = teacherReportsBaseQuerySchema.parse(req.query);
    const result = await reportsOps.teachersWorkload(req.tenantId!, query, req.user!);
    return sendSuccess(req, res, result);
  }

  async teachersAllocation(req: Request, res: Response) {
    const query = teacherReportsBaseQuerySchema.parse(req.query);
    const result = await reportsOps.teachersAllocation(req.tenantId!, query, req.user!);
    return sendSuccess(req, res, result);
  }

  async teachersActivity(req: Request, res: Response) {
    const query = teacherActivityQuerySchema.parse(req.query);
    const result = await reportsOps.teachersActivity(req.tenantId!, query, req.user!);
    return sendSuccess(req, res, result);
  }

  async timetableReport(req: Request, res: Response) {
    const query = timetableReportQuerySchema.parse(req.query);
    const result = await reportsOps.timetableReport(req.tenantId!, query, req.user!);
    return sendSuccess(req, res, result);
  }

  async conductSchoolSummary(req: Request, res: Response) {
    const query = conductSchoolReportQuerySchema.parse(req.query);
    const result = await reportsOps.conductSchoolSummary(req.tenantId!, query, req.user!);
    return sendSuccess(req, res, result);
  }

  async conductByClass(req: Request, res: Response) {
    const query = conductSchoolReportQuerySchema.parse(req.query);
    const result = await reportsOps.conductByClass(req.tenantId!, query, req.user!);
    return sendSuccess(req, res, result);
  }

  async conductStudentHistory(req: Request, res: Response) {
    const query = conductStudentReportQuerySchema.parse(req.query);
    const result = await reportsOps.conductStudentHistory(
      req.tenantId!,
      req.params.studentId,
      query,
      req.user!,
    );
    return sendSuccess(req, res, result);
  }
}
