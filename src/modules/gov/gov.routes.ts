import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { GovController } from './gov.controller';

const controller = new GovController();

export const govRoutes = Router();

govRoutes.get(
  '/gov/dashboard',
  authenticate,
  requirePermissions([PERMISSIONS.GOV_DASHBOARD_READ]),
  asyncHandler((req, res) => controller.getDashboard(req, res))
);

govRoutes.get(
  '/gov/schools',
  authenticate,
  requirePermissions([PERMISSIONS.GOV_SCHOOLS_READ]),
  asyncHandler((req, res) => controller.listSchools(req, res))
);

govRoutes.get(
  '/gov/schools/:schoolId/attendance',
  authenticate,
  requirePermissions([PERMISSIONS.ATTENDANCE_READ]),
  asyncHandler((req, res) => controller.getSchoolAttendance(req, res))
);

govRoutes.get(
  '/gov/schools/:schoolId/courses',
  authenticate,
  requirePermissions([PERMISSIONS.COURSES_READ]),
  asyncHandler((req, res) => controller.getSchoolCourses(req, res))
);

govRoutes.get(
  '/gov/schools/:schoolId/learning-insights',
  authenticate,
  requirePermissions([PERMISSIONS.COURSES_READ]),
  asyncHandler((req, res) => controller.getSchoolLearningInsights(req, res))
);

govRoutes.get(
  '/gov/schools/:schoolId/assessments',
  authenticate,
  requirePermissions([PERMISSIONS.ASSESSMENTS_READ]),
  asyncHandler((req, res) => controller.getSchoolAssessments(req, res))
);

govRoutes.get(
  '/gov/schools/:schoolId/marks',
  authenticate,
  requirePermissions([PERMISSIONS.EXAMS_READ]),
  asyncHandler((req, res) => controller.getSchoolMarks(req, res))
);

govRoutes.get(
  '/gov/schools/:schoolId/timetable',
  authenticate,
  requirePermissions([PERMISSIONS.TIMETABLE_READ]),
  asyncHandler((req, res) => controller.getSchoolTimetable(req, res))
);

govRoutes.post(
  '/gov/audits',
  authenticate,
  requirePermissions([PERMISSIONS.ACADEMIC_AUDIT_SUBMIT]),
  asyncHandler((req, res) => controller.submitAudit(req, res))
);

govRoutes.get(
  '/gov/audits',
  authenticate,
  requirePermissions([PERMISSIONS.ACADEMIC_AUDIT_LIST]),
  asyncHandler((req, res) => controller.listAudits(req, res))
);

govRoutes.get(
  '/gov/audits/:id',
  authenticate,
  requirePermissions([PERMISSIONS.ACADEMIC_AUDIT_READ]),
  asyncHandler((req, res) => controller.getAudit(req, res))
);