import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

export function requestContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incomingRequestId = req.header('x-request-id');
  req.requestId = incomingRequestId ?? randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}
