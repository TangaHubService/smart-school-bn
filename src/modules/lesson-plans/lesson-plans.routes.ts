import { Router } from 'express';
import { authenticate } from '../../common/middleware/authenticate.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { LessonPlansController } from './lesson-plans.controller';
import {
  createLessonPlanSchema,
  updateLessonPlanSchema,
  reviewLessonPlanSchema,
  lessonPlanFeedbackSchema,
} from './lesson-plans.schemas';

const controller = new LessonPlansController();
export const lessonPlansRoutes = Router();

lessonPlansRoutes.use(authenticate, enforceTenant);

lessonPlansRoutes.get('/lesson-plans', requirePermissions([PERMISSIONS.COURSES_READ]), asyncHandler((req, res) => controller.list(req, res)));
lessonPlansRoutes.post('/lesson-plans', requirePermissions([PERMISSIONS.COURSES_MANAGE]), validateBody(createLessonPlanSchema), asyncHandler((req, res) => controller.create(req, res)));
lessonPlansRoutes.patch('/lesson-plans/:planId', requirePermissions([PERMISSIONS.COURSES_MANAGE]), validateBody(updateLessonPlanSchema), asyncHandler((req, res) => controller.update(req, res)));
lessonPlansRoutes.post('/lesson-plans/:planId/submit', requirePermissions([PERMISSIONS.COURSES_MANAGE]), asyncHandler((req, res) => controller.submit(req, res)));
lessonPlansRoutes.post('/lesson-plans/:planId/review', requirePermissions([PERMISSIONS.COURSES_READ]), validateBody(reviewLessonPlanSchema), asyncHandler((req, res) => controller.review(req, res)));
lessonPlansRoutes.delete('/lesson-plans/:planId', requirePermissions([PERMISSIONS.COURSES_MANAGE]), asyncHandler((req, res) => controller.delete(req, res)));
lessonPlansRoutes.patch('/lesson-plans/:planId/feedback', requirePermissions([PERMISSIONS.COURSES_READ]), validateBody(lessonPlanFeedbackSchema), asyncHandler((req, res) => controller.addFeedback(req, res)));
lessonPlansRoutes.get('/lesson-plans/:planId/revisions', requirePermissions([PERMISSIONS.COURSES_READ]), asyncHandler((req, res) => controller.listRevisions(req, res)));
