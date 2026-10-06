import { Router } from 'express';

import { asyncHandler } from '../../common/utils/async-handler';
import { LocationsController } from './locations.controller';

const controller = new LocationsController();

export const locationsRoutes = Router();

// Public, non-sensitive reference data — needed by the tenant/school registration
// forms before an authenticated session necessarily exists.
locationsRoutes.get('/countries', asyncHandler((req, res) => controller.listCountries(req, res)));

locationsRoutes.get(
  '/:countryCode/divisions',
  asyncHandler((req, res) => controller.listDivisions(req, res))
);
