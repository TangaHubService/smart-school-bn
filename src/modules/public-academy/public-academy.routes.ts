import { Router } from 'express';
import { PublicAcademyController } from './public-academy.controller';
import { authenticate } from '../../common/middleware/authenticate.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import {
  academyPlanCheckoutSchema,
  academyClassSelectionSchema,
  academyMockCheckoutSchema,
} from './public-academy.schemas';

const router = Router();

// Public routes
router.get('/plans', PublicAcademyController.getPlans);
router.get('/classes', PublicAcademyController.getClasses);
// Legacy alias: programs are now classes (pricing lives on the class).
router.get('/programs', PublicAcademyController.getClasses);
router.get('/catalog/tree', PublicAcademyController.getCatalogTree);
router.get('/stats', PublicAcademyController.getPublicStats);
router.get('/classes/:id', PublicAcademyController.getClassById);
router.get('/programs/:id', PublicAcademyController.getClassById);
router.head('/webhook/paypack', PublicAcademyController.webhookProbe);
router.get('/webhook/paypack', PublicAcademyController.webhookProbe);
router.post('/webhook/paypack', PublicAcademyController.handleWebhook);

// Authenticated routes
router.get('/subscription', authenticate, PublicAcademyController.getSubscriptionSummary);
router.post(
  '/subscription/checkout',
  authenticate,
  validateBody(academyPlanCheckoutSchema),
  PublicAcademyController.startPlanCheckout
);
router.post(
  '/subscription/checkout/mock',
  authenticate,
  validateBody(academyMockCheckoutSchema),
  PublicAcademyController.startMockPlanCheckout
);
router.post(
  '/subscription/classes/select',
  authenticate,
  validateBody(academyClassSelectionSchema),
  PublicAcademyController.selectClass
);
router.delete(
  '/subscription/classes/:classRoomId',
  authenticate,
  PublicAcademyController.removeClass
);
router.get('/my-enrollments', authenticate, PublicAcademyController.getMyEnrollments);
router.get('/classes/:classRoomId/content', authenticate, PublicAcademyController.getClassContent);

export { router as publicAcademyRouter };
