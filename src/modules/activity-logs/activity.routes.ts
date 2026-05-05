import { Router } from 'express';
import { exportLogsExcel, exportLogsPdf, getLogs } from './activity.controller';

export const activityLogsRouter = Router();
activityLogsRouter.get('/', getLogs);
activityLogsRouter.get('/export/excel', exportLogsExcel);
activityLogsRouter.get('/export/pdf', exportLogsPdf);
