import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { AppError } from '../errors/app-error';
import { sendError } from '../utils/response';

function requestRoute(req: Request): string {
  return `${req.method} ${req.originalUrl || req.url}`;
}

export function errorHandlerMiddleware(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const logger = (req as Request & { log?: { error: (payload: unknown, message?: string) => void } }).log;
  const route = requestRoute(req);

  if (error instanceof AppError) {
    logger?.error(
      {
        err: error,
        code: error.code,
        details: error.details ?? null,
        requestId: req.requestId,
        route,
      },
      `${route} — ${error.code}: ${error.message}`,
    );
    sendError(req, res, error.statusCode, error.code, error.message, error.details);
    return;
  }

  if (error instanceof ZodError) {
    logger?.error(
      {
        err: error,
        requestId: req.requestId,
        route,
      },
      `${route} — validation failed`,
    );
    sendError(
      req,
      res,
      400,
      'VALIDATION_ERROR',
      'Request validation failed',
      error.flatten(),
    );
    return;
  }

  logger?.error(
    {
      err: error,
      requestId: req.requestId,
      route,
    },
    `${route} — unhandled error`,
  );

  sendError(
    req,
    res,
    500,
    'INTERNAL_SERVER_ERROR',
    'An unexpected error occurred',
  );
}
