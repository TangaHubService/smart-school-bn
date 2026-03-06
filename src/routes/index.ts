import { Router } from 'express';

import { attendanceRoutes } from '../modules/attendance/attendance.routes';
import { authRoutes } from '../modules/auth/auth.routes';
import { academicRoutes } from '../modules/academics/academic.routes';
import { assessmentsRoutes } from '../modules/assessments/assessments.routes';
import { healthRoutes } from '../modules/health/health.routes';
import { examsRoutes } from '../modules/exams/exams.routes';
import { filesRoutes } from '../modules/files/files.routes';
import { lmsRoutes } from '../modules/lms/lms.routes';
import { metaRoutes } from '../modules/meta/meta.routes';
import { parentsRoutes } from '../modules/parents/parents.routes';
import { rolesRoutes } from '../modules/roles/roles.routes';
import { schoolsRoutes } from '../modules/schools/schools.routes';
import { staffRoutes } from '../modules/staff/staff.routes';
import { studentsRoutes } from '../modules/students/students.routes';
import { tenantsRoutes } from '../modules/tenants/tenants.routes';
import { usersRoutes } from '../modules/users/users.routes';
import { env } from '../config/env';

export const apiRouter = Router();

apiRouter.use('/auth', authRoutes);
apiRouter.use('/', usersRoutes);
apiRouter.use('/tenants', tenantsRoutes);
apiRouter.use('/schools', schoolsRoutes);
apiRouter.use('/staff', staffRoutes);
apiRouter.use('/', academicRoutes);
apiRouter.use('/', attendanceRoutes);
apiRouter.use('/', studentsRoutes);
apiRouter.use('/', parentsRoutes);
apiRouter.use('/', examsRoutes);
apiRouter.use('/', filesRoutes);
apiRouter.use('/', lmsRoutes);
if (env.FEATURE_ASSESSMENTS_ENABLED) {
  apiRouter.use('/', assessmentsRoutes);
}
apiRouter.use('/health', healthRoutes);
apiRouter.use('/meta', metaRoutes);
apiRouter.use('/roles', rolesRoutes);
