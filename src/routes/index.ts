import { Router } from 'express';

import { attendanceRoutes } from '../modules/attendance/attendance.routes';
import { authRoutes } from '../modules/auth/auth.routes';
import { academicRoutes } from '../modules/academics/academic.routes';
import { assessmentsRoutes } from '../modules/assessments/assessments.routes';
import { dashboardRoutes } from '../modules/dashboard/dashboard.routes';
import { conductMarksRoutes } from '../modules/conduct-marks/conduct-marks.routes';
import { healthRoutes } from '../modules/health/health.routes';
import { examsRoutes } from '../modules/exams/exams.routes';
import { filesRoutes } from '../modules/files/files.routes';
import { govRoutes } from '../modules/gov/gov.routes';
import { lmsRoutes } from '../modules/lms/lms.routes';
import { metaRoutes } from '../modules/meta/meta.routes';
import { parentsRoutes } from '../modules/parents/parents.routes';
import { reportsRoutes } from '../modules/reports/reports.routes';
import { rolesRoutes } from '../modules/roles/roles.routes';
import { schoolsRoutes } from '../modules/schools/schools.routes';
import { staffRoutes } from '../modules/staff/staff.routes';
import { studentsRoutes } from '../modules/students/students.routes';
import { tenantsRoutes } from '../modules/tenants/tenants.routes';
import { timetableRoutes } from '../modules/timetable/timetable.routes';
import { announcementsRoutes } from '../modules/announcements/announcements.routes';
import { auditRoutes } from '../modules/audit/audit.routes';
import { subscriptionsRoutes } from '../modules/subscriptions/subscriptions.routes';
import { systemAnnouncementsRoutes } from '../modules/system-announcements/system-announcements.routes';
import { usersRoutes } from '../modules/users/users.routes';
import { publicAcademyRouter } from '../modules/public-academy/public-academy.routes';
import { env } from '../config/env';

import { auditorReadExtraGuard } from '../middleware/auditor-guard';

export const apiRouter = Router();

apiRouter.use('/public-academy', publicAcademyRouter);
apiRouter.use('/auth', authRoutes);
apiRouter.use(auditorReadExtraGuard); // Global read-only enforcement for Auditors
apiRouter.use('/', usersRoutes);
apiRouter.use('/', auditRoutes);
apiRouter.use('/', subscriptionsRoutes);
apiRouter.use('/', systemAnnouncementsRoutes);
apiRouter.use('/tenants', tenantsRoutes);
apiRouter.use('/schools', schoolsRoutes);
apiRouter.use('/staff', staffRoutes);
apiRouter.use('/', academicRoutes);
apiRouter.use('/', attendanceRoutes);
apiRouter.use('/', reportsRoutes);
apiRouter.use('/', studentsRoutes);
apiRouter.use('/', parentsRoutes);
apiRouter.use('/', conductMarksRoutes);
apiRouter.use('/', examsRoutes);
apiRouter.use('/', filesRoutes);
apiRouter.use('/', lmsRoutes);
if (env.FEATURE_ASSESSMENTS_ENABLED) {
  apiRouter.use('/', assessmentsRoutes);
}
if (env.FEATURE_GOV_AUDITING_ENABLED) {
  apiRouter.use('/', govRoutes);
}
apiRouter.use('/', timetableRoutes);
apiRouter.use('/', announcementsRoutes);
apiRouter.use('/', dashboardRoutes);
apiRouter.use('/health', healthRoutes);
apiRouter.use('/meta', metaRoutes);
apiRouter.use('/roles', rolesRoutes);
