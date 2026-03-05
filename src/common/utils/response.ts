import { Response } from 'express';

import { ApiEnvelope, PaginationMeta } from '../types/api.types';

export function sendSuccess<T>(
  req: Express.Request,
  res: Response,
  data: T,
  statusCode = 200,
  pagination: PaginationMeta | null = null,
): Response<ApiEnvelope<T>> {
  return res.status(statusCode).json({
    data,
    error: null,
    meta: {
      requestId: req.requestId,
      timestamp: new Date().toISOString(),
      pagination,
    },
  });
}

export function sendError(
  req: Express.Request,
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details: unknown = null,
): Response<ApiEnvelope<null>> {
  return res.status(statusCode).json({
    data: null,
    error: {
      code,
      message,
      details,
    },
    meta: {
      requestId: req.requestId,
      timestamp: new Date().toISOString(),
      pagination: null,
    },
  });
}
