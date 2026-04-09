import { Router } from 'express';
import { PublicAcademyController } from './public-academy.controller';
import { authenticate } from '../../common/middleware/authenticate.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import {
  academyPlanCheckoutSchema,
  academyProgramSelectionSchema,
  academySubjectSelectionSchema,
} from './public-academy.schemas';

const router = Router();

// Public routes
router.get('/programs', PublicAcademyController.getPrograms);
router.get('/programs/:id', PublicAcademyController.getProgramById);
router.head('/webhook/paypack', PublicAcademyController.webhookProbe);
router.get('/webhook/paypack', PublicAcademyController.webhookProbe);
router.post('/webhook/paypack', PublicAcademyController.handleWebhook);

// Authenticated routes
router.get('/subscription', authenticate, PublicAcademyController.getSubscriptionSummary);
router.post(
  '/subscription/checkout',
  authenticate,
  validateBody(academyPlanCheckoutSchema),
  PublicAcademyController.startPlanCheckout,
);
router.post(
  '/subscription/programs/select',
  authenticate,
  validateBody(academyProgramSelectionSchema),
  PublicAcademyController.selectProgram,
);
router.post(
  '/subscription/subjects/select',
  authenticate,
  validateBody(academySubjectSelectionSchema),
  PublicAcademyController.selectSubject,
);
router.delete(
  '/subscription/programs/:programId',
  authenticate,
  PublicAcademyController.removeProgram,
);
router.delete(
  '/subscription/subjects/:subjectId',
  authenticate,
  PublicAcademyController.removeSubject,
);
router.post('/purchase', authenticate, PublicAcademyController.purchaseProgram);
router.get('/my-enrollments', authenticate, PublicAcademyController.getMyEnrollments);
router.get('/programs/:id/content', authenticate, PublicAcademyController.getProgramContent);

export { router as publicAcademyRouter };
