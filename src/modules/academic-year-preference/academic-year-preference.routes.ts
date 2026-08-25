import { Router } from 'express';
import { authenticate } from '../../common/middleware/authenticate.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { requireActiveSubscription } from '../../common/middleware/subscription-gate.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { AcademicYearPreferenceController } from './academic-year-preference.controller';
import { setAcademicYearPreferenceSchema } from './academic-year-preference.schemas';

const controller = new AcademicYearPreferenceController();

export const academicYearPreferenceRoutes = Router();

academicYearPreferenceRoutes.use(authenticate, enforceTenant, requireActiveSubscription);

academicYearPreferenceRoutes.get('/academic-years', asyncHandler((req, res) => controller.listAcademicYears(req, res)));
academicYearPreferenceRoutes.get('/academic-years/preference', asyncHandler((req, res) => controller.getPreference(req, res)));
academicYearPreferenceRoutes.put('/academic-years/preference', validateBody(setAcademicYearPreferenceSchema), asyncHandler((req, res) => controller.setPreference(req, res)));
