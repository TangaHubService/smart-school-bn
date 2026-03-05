import { Router } from 'express';

import { asyncHandler } from '../../common/utils/async-handler';
import { HealthController } from './health.controller';

const healthController = new HealthController();

export const healthRoutes = Router();

healthRoutes.get('/', asyncHandler((req, res) => healthController.getHealth(req, res)));
