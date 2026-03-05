import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { AppError } from '../errors/app-error';
import { sendError } from '../utils/response';

export function errorHandlerMiddleware(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof AppError) {
    sendError(req, res, error.statusCode, error.code, error.message, error.details);
    return;
  }

  if (error instanceof ZodError) {
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

  sendError(
    req,
    res,
    500,
    'INTERNAL_SERVER_ERROR',
    'An unexpected error occurred',
  );
}
