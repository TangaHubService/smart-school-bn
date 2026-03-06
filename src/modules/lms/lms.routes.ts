import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { LmsController } from './lms.controller';
import {
  createAssignmentSchema,
  createCourseSchema,
  createLessonSchema,
  createSubmissionSchema,
  gradeSubmissionSchema,
  publishLessonSchema,
} from './lms.schemas';

const lmsController = new LmsController();

export const lmsRoutes = Router();

lmsRoutes.use(authenticate, enforceTenant);

lmsRoutes.post(
  '/courses',
  requirePermissions([PERMISSIONS.COURSES_MANAGE]),
  validateBody(createCourseSchema),
  asyncHandler((req, res) => lmsController.createCourse(req, res)),
);

lmsRoutes.get(
  '/courses',
  requirePermissions([PERMISSIONS.COURSES_READ]),
  asyncHandler((req, res) => lmsController.listCourses(req, res)),
);

lmsRoutes.get(
  '/courses/:courseId',
  requirePermissions([PERMISSIONS.COURSES_READ]),
  asyncHandler((req, res) => lmsController.getCourseDetail(req, res)),
);

lmsRoutes.post(
  '/courses/:courseId/lessons',
  requirePermissions([PERMISSIONS.LESSONS_MANAGE]),
  validateBody(createLessonSchema),
  asyncHandler((req, res) => lmsController.createLesson(req, res)),
);

lmsRoutes.patch(
  '/lessons/:lessonId/publish',
  requirePermissions([PERMISSIONS.LESSONS_PUBLISH]),
  validateBody(publishLessonSchema),
  asyncHandler((req, res) => lmsController.publishLesson(req, res)),
);

lmsRoutes.post(
  '/assignments',
  requirePermissions([PERMISSIONS.ASSIGNMENTS_MANAGE]),
  validateBody(createAssignmentSchema),
  asyncHandler((req, res) => lmsController.createAssignment(req, res)),
);

lmsRoutes.get(
  '/assignments',
  requirePermissions([PERMISSIONS.COURSES_READ]),
  asyncHandler((req, res) => lmsController.listAssignments(req, res)),
);

lmsRoutes.get(
  '/assignments/:id/submissions',
  requirePermissions([PERMISSIONS.SUBMISSIONS_READ]),
  asyncHandler((req, res) => lmsController.listAssignmentSubmissions(req, res)),
);

lmsRoutes.post(
  '/assignments/:id/submissions',
  requirePermissions([PERMISSIONS.ASSIGNMENTS_SUBMIT]),
  validateBody(createSubmissionSchema),
  asyncHandler((req, res) => lmsController.submitAssignment(req, res)),
);

lmsRoutes.patch(
  '/submissions/:id/grade',
  requirePermissions([PERMISSIONS.SUBMISSIONS_GRADE]),
  validateBody(gradeSubmissionSchema),
  asyncHandler((req, res) => lmsController.gradeSubmission(req, res)),
);

lmsRoutes.get(
  '/students/me/courses',
  requirePermissions([PERMISSIONS.STUDENT_MY_COURSES_READ]),
  asyncHandler((req, res) => lmsController.listMyCourses(req, res)),
);
