import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import {
  requireAnyPermissions,
  requirePermissions,
} from '../../common/middleware/require-permissions.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { AssessmentsController } from './assessments.controller';
import {
  addQuestionSchema,
  createAssessmentSchema,
  publishAssessmentSchema,
  regradeAttemptSchema,
  saveAttemptAnswersSchema,
  updateQuestionSchema,
} from './assessments.schemas';

const assessmentsController = new AssessmentsController();

export const assessmentsRoutes = Router();

assessmentsRoutes.use(authenticate, enforceTenant);

assessmentsRoutes.post(
  '/assessments',
  requirePermissions([PERMISSIONS.ASSESSMENTS_MANAGE]),
  validateBody(createAssessmentSchema),
  asyncHandler((req, res) => assessmentsController.createAssessment(req, res)),
);

assessmentsRoutes.get(
  '/assessments',
  requirePermissions([PERMISSIONS.ASSESSMENTS_READ]),
  asyncHandler((req, res) => assessmentsController.listAssessments(req, res)),
);

assessmentsRoutes.get(
  '/assessments/:id',
  requirePermissions([PERMISSIONS.ASSESSMENTS_READ]),
  asyncHandler((req, res) => assessmentsController.getAssessmentDetail(req, res)),
);

assessmentsRoutes.post(
  '/assessments/:id/questions',
  requirePermissions([PERMISSIONS.ASSESSMENTS_MANAGE]),
  validateBody(addQuestionSchema),
  asyncHandler((req, res) => assessmentsController.addQuestion(req, res)),
);

assessmentsRoutes.patch(
  '/assessment-questions/:id',
  requirePermissions([PERMISSIONS.ASSESSMENTS_MANAGE]),
  validateBody(updateQuestionSchema),
  asyncHandler((req, res) => assessmentsController.updateQuestion(req, res)),
);

assessmentsRoutes.delete(
  '/assessment-questions/:id',
  requirePermissions([PERMISSIONS.ASSESSMENTS_MANAGE]),
  asyncHandler((req, res) => assessmentsController.deleteQuestion(req, res)),
);

assessmentsRoutes.patch(
  '/assessments/:id/publish',
  requirePermissions([PERMISSIONS.ASSESSMENTS_PUBLISH]),
  validateBody(publishAssessmentSchema),
  asyncHandler((req, res) => assessmentsController.publishAssessment(req, res)),
);

assessmentsRoutes.get(
  '/assessments/:id/results',
  requirePermissions([PERMISSIONS.ASSESSMENT_RESULTS_READ]),
  asyncHandler((req, res) => assessmentsController.listResults(req, res)),
);

assessmentsRoutes.get(
  '/students/me/assessments',
  requirePermissions([PERMISSIONS.ASSESSMENTS_SUBMIT]),
  asyncHandler((req, res) => assessmentsController.listMyAssessments(req, res)),
);

assessmentsRoutes.get(
  '/students/me/assessments/:id',
  requirePermissions([PERMISSIONS.ASSESSMENTS_SUBMIT]),
  asyncHandler((req, res) => assessmentsController.getMyAssessment(req, res)),
);

assessmentsRoutes.post(
  '/assessments/:id/attempts/start',
  requirePermissions([PERMISSIONS.ASSESSMENTS_SUBMIT]),
  asyncHandler((req, res) => assessmentsController.startAttempt(req, res)),
);

assessmentsRoutes.put(
  '/assessment-attempts/:id/answers',
  requirePermissions([PERMISSIONS.ASSESSMENTS_SUBMIT]),
  validateBody(saveAttemptAnswersSchema),
  asyncHandler((req, res) => assessmentsController.saveAttemptAnswers(req, res)),
);

assessmentsRoutes.post(
  '/assessment-attempts/:id/submit',
  requirePermissions([PERMISSIONS.ASSESSMENTS_SUBMIT]),
  asyncHandler((req, res) => assessmentsController.submitAttempt(req, res)),
);

assessmentsRoutes.patch(
  '/assessment-attempts/:id/regrade',
  requirePermissions([PERMISSIONS.ASSESSMENT_RESULTS_READ]),
  validateBody(regradeAttemptSchema),
  asyncHandler((req, res) => assessmentsController.regradeAttempt(req, res)),
);

assessmentsRoutes.get(
  '/assessment-attempts/:id',
  requireAnyPermissions([PERMISSIONS.ASSESSMENTS_SUBMIT, PERMISSIONS.ASSESSMENT_RESULTS_READ]),
  asyncHandler((req, res) => assessmentsController.getAttempt(req, res)),
);
