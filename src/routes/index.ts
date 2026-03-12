import { Router } from 'express';

import { attendanceRoutes } from '../modules/attendance/attendance.routes';
import { authRoutes } from '../modules/auth/auth.routes';
import { academicRoutes } from '../modules/academics/academic.routes';
import { assessmentsRoutes } from '../modules/assessments/assessments.routes';
import { dashboardRoutes } from '../modules/dashboard/dashboard.routes';
import { conductRoutes } from '../modules/conduct/conduct.routes';
import { healthRoutes } from '../modules/health/health.routes';
import { examsRoutes } from '../modules/exams/exams.routes';
import { filesRoutes } from '../modules/files/files.routes';
import { govRoutes } from '../modules/gov/gov.routes';
import { lmsRoutes } from '../modules/lms/lms.routes';
import { metaRoutes } from '../modules/meta/meta.routes';
import { parentsRoutes } from '../modules/parents/parents.routes';
import { rolesRoutes } from '../modules/roles/roles.routes';
import { schoolsRoutes } from '../modules/schools/schools.routes';
import { staffRoutes } from '../modules/staff/staff.routes';
import { studentsRoutes } from '../modules/students/students.routes';
import { tenantsRoutes } from '../modules/tenants/tenants.routes';
import { timetableRoutes } from '../modules/timetable/timetable.routes';
import { announcementsRoutes } from '../modules/announcements/announcements.routes';
import { usersRoutes } from '../modules/users/users.routes';
import { publicAcademyRouter } from '../modules/public-academy/public-academy.routes';
import { env } from '../config/env';

export const apiRouter = Router();

apiRouter.use('/public-academy', publicAcademyRouter);
apiRouter.use('/auth', authRoutes);
apiRouter.use('/', usersRoutes);
apiRouter.use('/tenants', tenantsRoutes);
apiRouter.use('/schools', schoolsRoutes);
apiRouter.use('/staff', staffRoutes);
apiRouter.use('/', academicRoutes);
apiRouter.use('/', attendanceRoutes);
if (env.FEATURE_CONDUCT_ENABLED) {
  apiRouter.use('/', conductRoutes);
}
apiRouter.use('/', studentsRoutes);
apiRouter.use('/', parentsRoutes);
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
