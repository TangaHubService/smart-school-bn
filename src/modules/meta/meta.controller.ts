import { Request, Response } from 'express';

import { env } from '../../config/env';
import { sendSuccess } from '../../common/utils/response';

export class MetaController {
  getVersion(req: Request, res: Response): Response {
    return sendSuccess(req, res, {
      appName: 'smart-school-rwanda-api',
      version: env.APP_VERSION,
      commitSha: env.COMMIT_SHA,
      builtAt: env.BUILD_TIME,
      environment: env.NODE_ENV,
    });
  }
}
