import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { AttendanceController } from './attendance.controller';
import {
  bulkAttendanceRecordsSchema,
  createAttendanceSessionSchema,
} from './attendance.schemas';

const attendanceController = new AttendanceController();

export const attendanceRoutes = Router();

attendanceRoutes.use(authenticate, enforceTenant);

attendanceRoutes.get(
  '/attendance/classes',
  requirePermissions([PERMISSIONS.ATTENDANCE_READ]),
  asyncHandler((req, res) => attendanceController.listAttendanceClasses(req, res)),
);

attendanceRoutes.get(
  '/attendance/summary',
  requirePermissions([PERMISSIONS.ATTENDANCE_READ]),
  asyncHandler((req, res) => attendanceController.getDashboardSummary(req, res)),
);

attendanceRoutes.post(
  '/attendance/sessions',
  requirePermissions([PERMISSIONS.ATTENDANCE_MANAGE]),
  validateBody(createAttendanceSessionSchema),
  asyncHandler((req, res) => attendanceController.createSession(req, res)),
);

attendanceRoutes.post(
  '/attendance/records/bulk',
  requirePermissions([PERMISSIONS.ATTENDANCE_MANAGE]),
  validateBody(bulkAttendanceRecordsSchema),
  asyncHandler((req, res) => attendanceController.saveBulkRecords(req, res)),
);

attendanceRoutes.get(
  '/attendance/classes/:classId',
  requirePermissions([PERMISSIONS.ATTENDANCE_READ]),
  asyncHandler((req, res) => attendanceController.getClassAttendance(req, res)),
);

attendanceRoutes.get(
  '/attendance/students/:studentId',
  requirePermissions([PERMISSIONS.ATTENDANCE_READ]),
  asyncHandler((req, res) => attendanceController.getStudentAttendanceHistory(req, res)),
);
