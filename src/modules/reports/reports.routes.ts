import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import {
  requireAnyPermissions,
  requirePermissions,
} from '../../common/middleware/require-permissions.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { ReportsController } from './reports.controller';

const reportsController = new ReportsController();

export const reportsRoutes = Router();

reportsRoutes.use(authenticate, enforceTenant);

reportsRoutes.get(
  '/reports/academic/by-class',
  requirePermissions([PERMISSIONS.EXAMS_READ]),
  asyncHandler((req, res) => reportsController.academicByClass(req, res)),
);

reportsRoutes.get(
  '/reports/academic/students/:studentId',
  requirePermissions([PERMISSIONS.EXAMS_READ]),
  asyncHandler((req, res) => reportsController.academicStudent(req, res)),
);

reportsRoutes.get(
  '/reports/academic/classes/:classRoomId',
  requirePermissions([PERMISSIONS.EXAMS_READ]),
  asyncHandler((req, res) => reportsController.academicClass(req, res)),
);

reportsRoutes.get(
  '/reports/academic/subject',
  requirePermissions([PERMISSIONS.EXAMS_READ]),
  asyncHandler((req, res) => reportsController.academicSubject(req, res)),
);

reportsRoutes.get(
  '/reports/attendance/school',
  requirePermissions([PERMISSIONS.ATTENDANCE_READ]),
  asyncHandler((req, res) => reportsController.attendanceSchool(req, res)),
);

reportsRoutes.get(
  '/reports/attendance/by-class',
  requirePermissions([PERMISSIONS.ATTENDANCE_READ]),
  asyncHandler((req, res) => reportsController.attendanceByClass(req, res)),
);

reportsRoutes.get(
  '/reports/attendance/absenteeism',
  requirePermissions([PERMISSIONS.ATTENDANCE_READ]),
  asyncHandler((req, res) => reportsController.attendanceAbsenteeism(req, res)),
);

reportsRoutes.get(
  '/reports/attendance/summary-cards',
  requirePermissions([PERMISSIONS.ATTENDANCE_READ]),
  asyncHandler((req, res) => reportsController.attendanceSummaryCards(req, res)),
);

reportsRoutes.get(
  '/reports/teachers/workload',
  requirePermissions([PERMISSIONS.COURSES_READ]),
  asyncHandler((req, res) => reportsController.teachersWorkload(req, res)),
);

reportsRoutes.get(
  '/reports/teachers/allocation',
  requirePermissions([PERMISSIONS.COURSES_READ]),
  asyncHandler((req, res) => reportsController.teachersAllocation(req, res)),
);

reportsRoutes.get(
  '/reports/teachers/activity',
  requireAnyPermissions([PERMISSIONS.EXAMS_READ, PERMISSIONS.ATTENDANCE_READ]),
  asyncHandler((req, res) => reportsController.teachersActivity(req, res)),
);

reportsRoutes.get(
  '/reports/timetable',
  requireAnyPermissions([PERMISSIONS.TIMETABLE_READ, PERMISSIONS.TIMETABLE_MANAGE]),
  asyncHandler((req, res) => reportsController.timetableReport(req, res)),
);

reportsRoutes.get(
  '/reports/conduct/school-summary',
  requirePermissions([PERMISSIONS.CONDUCT_READ]),
  asyncHandler((req, res) => reportsController.conductSchoolSummary(req, res)),
);

reportsRoutes.get(
  '/reports/conduct/by-class',
  requirePermissions([PERMISSIONS.CONDUCT_READ]),
  asyncHandler((req, res) => reportsController.conductByClass(req, res)),
);

reportsRoutes.get(
  '/reports/conduct/students/:studentId',
  requirePermissions([PERMISSIONS.CONDUCT_READ]),
  asyncHandler((req, res) => reportsController.conductStudentHistory(req, res)),
);
