import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { exportLogsExcel, exportLogsPdf, getLogs } from './activity.controller';

export const activityLogsRouter = Router();

activityLogsRouter.use(authenticate, enforceTenant);

activityLogsRouter.get('/', asyncHandler(getLogs));
activityLogsRouter.get('/export/excel', asyncHandler(exportLogsExcel));
activityLogsRouter.get('/export/pdf', asyncHandler(exportLogsPdf));
