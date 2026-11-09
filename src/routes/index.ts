import { Router } from 'express';

import { attendanceRoutes } from '../modules/attendance/attendance.routes';
import { authRoutes } from '../modules/auth/auth.routes';
import { academicRoutes } from '../modules/academics/academic.routes';
import { assessmentsRoutes } from '../modules/assessments/assessments.routes';
import { dashboardRoutes } from '../modules/dashboard/dashboard.routes';
import { conductMarksRoutes } from '../modules/conduct-marks/conduct-marks.routes';
import { healthRoutes } from '../modules/health/health.routes';
import { examsPublicRoutes, examsRoutes } from '../modules/exams/exams.routes';
import { filesRoutes } from '../modules/files/files.routes';
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
import { billingRoutes, billingWebhookRoutes } from '../modules/billing/billing.routes';
import { systemAnnouncementsRoutes } from '../modules/system-announcements/system-announcements.routes';
import { usersRoutes } from '../modules/users/users.routes';
import { publicAcademyRouter } from '../modules/public-academy/public-academy.routes';
import { govRoutes } from '../modules/gov/gov.routes';
import { adminAuditorsRoutes } from '../modules/admin-auditors/admin-auditors.routes';
import { locationsRoutes } from '../modules/locations/locations.routes';
import { academicYearPreferenceRoutes } from '../modules/academic-year-preference/academic-year-preference.routes';
import { lessonPlansRoutes } from '../modules/lesson-plans/lesson-plans.routes';
import { chatRoutes } from '../modules/chat/chat.routes';
import { supportRoutes } from '../modules/support/support.routes';
import { activityLogsRouter } from '../modules/activity-logs/activity.routes';
import { env } from '../config/env';

export const apiRouter = Router();

// ---------------------------------------------------------------------------
// PUBLIC SECTION — everything reachable without a session goes here, FIRST.
//
// Many routers below are mounted at `/` and call `router.use(authenticate, …)`.
// That middleware runs for every request entering the router, whatever its
// path, so any public route mounted after one of them silently becomes private
// (this is how QR verification, the location lookups and the school billing
// webhook all ended up returning 401). Keep public routes above this line's
// end, and keep test/integration/public-routes.int.spec.ts in sync.
// ---------------------------------------------------------------------------
apiRouter.use('/health', healthRoutes);
apiRouter.use('/meta', metaRoutes);
apiRouter.use('/public-academy', publicAcademyRouter);
apiRouter.use('/auth', authRoutes);
apiRouter.use('/locations', locationsRoutes);
apiRouter.use('/', examsPublicRoutes);
apiRouter.use('/', billingWebhookRoutes);
// Mixed router: its public contact endpoint uses optional auth per route.
apiRouter.use('/', supportRoutes);

// ---------------------------------------------------------------------------
// AUTHENTICATED SECTION
// ---------------------------------------------------------------------------
apiRouter.use('/', usersRoutes);
apiRouter.use('/', auditRoutes);
apiRouter.use('/', subscriptionsRoutes);
apiRouter.use('/', billingRoutes);
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
apiRouter.use('/', timetableRoutes);
apiRouter.use('/', announcementsRoutes);
apiRouter.use('/', dashboardRoutes);
apiRouter.use('/', govRoutes);
apiRouter.use('/', adminAuditorsRoutes);
apiRouter.use('/', academicYearPreferenceRoutes);
apiRouter.use('/', lessonPlansRoutes);
apiRouter.use('/', chatRoutes);
apiRouter.use('/activity-logs', activityLogsRouter);
apiRouter.use('/roles', rolesRoutes);