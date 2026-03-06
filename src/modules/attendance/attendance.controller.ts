import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import {
  attendanceSummaryQuerySchema,
  classAttendanceQuerySchema,
  studentAttendanceHistoryQuerySchema,
} from './attendance.schemas';
import { AttendanceService } from './attendance.service';

const attendanceService = new AttendanceService();

function buildContext(req: Request) {
  return {
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  };
}

export class AttendanceController {
  async listAttendanceClasses(req: Request, res: Response): Promise<Response> {
    const result = await attendanceService.listAttendanceClasses(req.tenantId!);
    return sendSuccess(req, res, result);
  }

  async getDashboardSummary(req: Request, res: Response): Promise<Response> {
    const query = attendanceSummaryQuerySchema.parse(req.query);
    const result = await attendanceService.getDashboardSummary(req.tenantId!, query);
    return sendSuccess(req, res, result);
  }

  async createSession(req: Request, res: Response): Promise<Response> {
    const result = await attendanceService.createSession(
      req.tenantId!,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result, 201);
  }

  async saveBulkRecords(req: Request, res: Response): Promise<Response> {
    const result = await attendanceService.saveBulkRecords(
      req.tenantId!,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result);
  }

  async getClassAttendance(req: Request, res: Response): Promise<Response> {
    const query = classAttendanceQuerySchema.parse(req.query);
    const result = await attendanceService.getClassAttendance(
      req.tenantId!,
      req.params.classId,
      query,
    );

    return sendSuccess(req, res, result);
  }

  async getStudentAttendanceHistory(req: Request, res: Response): Promise<Response> {
    const query = studentAttendanceHistoryQuerySchema.parse(req.query);
    const result = await attendanceService.getStudentAttendanceHistory(
      req.tenantId!,
      req.params.studentId,
      query,
    );

    return sendSuccess(req, res, result);
  }
}
