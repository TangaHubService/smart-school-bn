import { Router } from 'express';
import { PublicAcademyController } from './public-academy.controller';
import { authenticate } from '../../common/middleware/authenticate.middleware';

const router = Router();

// Public routes
router.get('/programs', PublicAcademyController.getPrograms);
router.get('/programs/:id', PublicAcademyController.getProgramById);
router.post('/webhook/paypack', PublicAcademyController.handleWebhook);

// Authenticated routes
router.post('/purchase', authenticate, PublicAcademyController.purchaseProgram);
router.get('/my-enrollments', authenticate, PublicAcademyController.getMyEnrollments);
router.get('/programs/:id/content', authenticate, PublicAcademyController.getProgramContent);

export { router as publicAcademyRouter };
