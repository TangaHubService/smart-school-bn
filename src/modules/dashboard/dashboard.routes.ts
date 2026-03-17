import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import {
  requireAnyPermissions,
  requirePermissions,
} from '../../common/middleware/require-permissions.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { DashboardController } from './dashboard.controller';

const dashboardController = new DashboardController();

export const dashboardRoutes = Router();

dashboardRoutes.get(
  '/dashboard/super-admin',
  authenticate,
  requirePermissions([PERMISSIONS.TENANTS_READ]),
  asyncHandler((req, res) => dashboardController.getSuperAdminDashboard(req, res)),
);

dashboardRoutes.get(
  '/dashboard/super-admin/filters',
  authenticate,
  requirePermissions([PERMISSIONS.TENANTS_READ]),
  asyncHandler((req, res) => dashboardController.getSuperAdminFilters(req, res)),
);

dashboardRoutes.get(
  '/dashboard/school-admin',
  authenticate,
  enforceTenant,
  requireAnyPermissions([
    PERMISSIONS.SCHOOL_SETUP_MANAGE,
    PERMISSIONS.STUDENTS_READ,
    PERMISSIONS.ATTENDANCE_READ,
  ]),
  asyncHandler((req, res) => dashboardController.getSchoolAdminDashboard(req, res)),
);

dashboardRoutes.get(
  '/dashboard/student',
  authenticate,
  enforceTenant,
  requireAnyPermissions([PERMISSIONS.STUDENT_MY_COURSES_READ]),
  asyncHandler((req, res) => dashboardController.getStudentDashboard(req, res)),
);

dashboardRoutes.get(
  '/dashboard/teacher',
  authenticate,
  enforceTenant,
  requireAnyPermissions([PERMISSIONS.COURSES_READ, PERMISSIONS.ATTENDANCE_READ]),
  asyncHandler((req, res) => dashboardController.getTeacherDashboard(req, res)),
);
