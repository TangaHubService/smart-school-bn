import { Response } from 'express';

import { ApiEnvelope, ApiMeta, PaginationMeta } from '../types/api.types';

export function sendSuccess<T>(
  req: Express.Request,
  res: Response,
  data: T,
  statusCode = 200,
  pagination: PaginationMeta | null = null,
  metaExtensions: Partial<Pick<ApiMeta, 'academyCatalog'>> = {},
): Response<ApiEnvelope<T>> {
  return res.status(statusCode).json({
    data,
    error: null,
    meta: {
      requestId: req.requestId,
      timestamp: new Date().toISOString(),
      pagination,
      ...metaExtensions,
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
