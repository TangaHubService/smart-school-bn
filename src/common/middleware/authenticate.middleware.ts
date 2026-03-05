import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import { env } from '../../config/env';
import { AppError } from '../errors/app-error';
import { JwtUser } from '../types/auth.types';

export function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const authHeader = req.header('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    next(new AppError(401, 'AUTH_UNAUTHORIZED', 'Missing bearer token'));
    return;
  }

  const token = authHeader.slice('Bearer '.length);

  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtUser;
    req.user = decoded;
    next();
  } catch (_error) {
    next(new AppError(401, 'AUTH_UNAUTHORIZED', 'Invalid or expired token'));
  }
}
