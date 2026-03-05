import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';

import { env } from './config/env';
import { errorHandlerMiddleware } from './common/middleware/error-handler.middleware';
import { notFoundMiddleware } from './common/middleware/not-found.middleware';
import { requestContextMiddleware } from './common/middleware/request-context.middleware';
import { apiRouter } from './routes';

const logger = pino({ level: env.LOG_LEVEL });

function parseCorsOrigin(origin: string): boolean | string[] {
  if (origin.trim() === '*') {
    return true;
  }

  return origin
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(requestContextMiddleware);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.requestId,
      customProps: (req) => ({
        tenantId: req.user?.tenantId,
        userId: req.user?.sub,
      }),
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: parseCorsOrigin(env.CORS_ORIGIN),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.use(apiRouter);
  app.use(notFoundMiddleware);
  app.use(errorHandlerMiddleware);

  return app;
}
