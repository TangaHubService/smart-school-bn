import type { Request } from 'express';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import type { IncomingMessage } from 'http';
import pinoHttp from 'pino-http';

import { env } from './config/env';
import { rootLogger } from './config/logger';
import { errorHandlerMiddleware } from './common/middleware/error-handler.middleware';
import { notFoundMiddleware } from './common/middleware/not-found.middleware';
import { requestContextMiddleware } from './common/middleware/request-context.middleware';
import { apiRouter } from './routes';

function httpRoute(req: IncomingMessage): string {
  const r = req as Request;
  return `${r.method} ${r.originalUrl || r.url}`;
}

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
      logger: rootLogger,
      genReqId: (req) => req.requestId,
      quietReqLogger: true,
      autoLogging: {
        ignore: (req) => req.url?.startsWith('/health') ?? false,
      },
      customSuccessMessage: (req, res, responseTime) =>
        `${httpRoute(req)} ${res.statusCode} ${responseTime}ms`,
      customErrorMessage: (req, res, err) =>
        `${httpRoute(req)} ${res.statusCode} ${err.message}`,
      customProps: (req) => {
        const r = req as Request;
        return {
          requestId: r.requestId,
          tenantId: r.user?.tenantId,
          userId: r.user?.sub,
        };
      },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: parseCorsOrigin(env.CORS_ORIGIN),
      credentials: true,
    }),
  );
  app.use(
    express.json({
      limit: '1mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString();
      },
    }),
  );

  app.use(apiRouter);
  app.use(notFoundMiddleware);
  app.use(errorHandlerMiddleware);

  return app;
}
