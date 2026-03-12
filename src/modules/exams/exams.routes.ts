import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { ExamsController } from './exams.controller';
import {
  bulkConductGradesSchema,
  bulkExamMarksSchema,
  createExamSchema,
  createGradingSchemeSchema,
  resultsActionSchema,
} from './exams.schemas';

const examsController = new ExamsController();

export const examsRoutes = Router();

examsRoutes.get(
  '/report-cards/verify/:snapshotId',
  asyncHandler((req, res) => examsController.verifyReportCard(req, res)),
);

examsRoutes.use(authenticate, enforceTenant);

examsRoutes.get(
  '/grading-schemes',
  requirePermissions([PERMISSIONS.EXAMS_READ]),
  asyncHandler((req, res) => examsController.listGradingSchemes(req, res)),
);

examsRoutes.post(
  '/grading-schemes',
  requirePermissions([PERMISSIONS.GRADING_SCHEMES_MANAGE]),
  validateBody(createGradingSchemeSchema),
  asyncHandler((req, res) => examsController.createGradingScheme(req, res)),
);

examsRoutes.post(
  '/exams',
  requirePermissions([PERMISSIONS.EXAMS_MANAGE]),
  validateBody(createExamSchema),
  asyncHandler((req, res) => examsController.createExam(req, res)),
);

examsRoutes.get(
  '/exams',
  requirePermissions([PERMISSIONS.EXAMS_READ]),
  asyncHandler((req, res) => examsController.listExams(req, res)),
);

examsRoutes.get(
  '/exams/:examId',
  requirePermissions([PERMISSIONS.EXAMS_READ]),
  asyncHandler((req, res) => examsController.getExamDetail(req, res)),
);

examsRoutes.post(
  '/exams/:examId/marks/bulk',
  requirePermissions([PERMISSIONS.EXAM_MARKS_MANAGE]),
  validateBody(bulkExamMarksSchema),
  asyncHandler((req, res) => examsController.bulkSaveMarks(req, res)),
);

examsRoutes.get(
  '/results/conduct',
  requirePermissions([PERMISSIONS.RESULTS_LOCK]),
  asyncHandler((req, res) => examsController.listConductGradesForEntry(req, res)),
);

examsRoutes.post(
  '/results/conduct/bulk',
  requirePermissions([PERMISSIONS.RESULTS_LOCK]),
  validateBody(bulkConductGradesSchema),
  asyncHandler((req, res) => examsController.bulkSaveConductGrades(req, res)),
);

examsRoutes.post(
  '/results/lock',
  requirePermissions([PERMISSIONS.RESULTS_LOCK]),
  validateBody(resultsActionSchema),
  asyncHandler((req, res) => examsController.lockResults(req, res)),
);

examsRoutes.post(
  '/results/unlock',
  requirePermissions([PERMISSIONS.RESULTS_LOCK]),
  validateBody(resultsActionSchema),
  asyncHandler((req, res) => examsController.unlockResults(req, res)),
);

examsRoutes.post(
  '/results/publish',
  requirePermissions([PERMISSIONS.RESULTS_PUBLISH]),
  validateBody(resultsActionSchema),
  asyncHandler((req, res) => examsController.publishResults(req, res)),
);

examsRoutes.get(
  '/report-cards/students/:studentId',
  requirePermissions([PERMISSIONS.REPORT_CARDS_READ]),
  asyncHandler((req, res) => examsController.getStudentReportCards(req, res)),
);

examsRoutes.get(
  '/report-cards/students/:studentId/pdf',
  requirePermissions([PERMISSIONS.REPORT_CARDS_READ]),
  asyncHandler((req, res) => examsController.downloadStudentReportCardPdf(req, res)),
);

examsRoutes.get(
  '/students/me/report-cards',
  requirePermissions([PERMISSIONS.REPORT_CARDS_MY_READ]),
  asyncHandler((req, res) => examsController.getMyReportCards(req, res)),
);

examsRoutes.get(
  '/students/me/report-cards/:snapshotId/pdf',
  requirePermissions([PERMISSIONS.REPORT_CARDS_MY_READ]),
  asyncHandler((req, res) => examsController.downloadMyReportCardPdf(req, res)),
);

examsRoutes.get(
  '/parents/me/report-cards',
  requirePermissions([PERMISSIONS.REPORT_CARDS_MY_READ]),
  asyncHandler((req, res) => examsController.getParentReportCards(req, res)),
);

examsRoutes.get(
  '/parents/me/report-cards/:snapshotId/pdf',
  requirePermissions([PERMISSIONS.REPORT_CARDS_MY_READ]),
  asyncHandler((req, res) => examsController.downloadParentReportCardPdf(req, res)),
);
