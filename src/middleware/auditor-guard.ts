import { NextFunction, Request, Response } from 'express';

/**
 * Middleware to enforce read-only access for AUDITOR role.
 * Auditors are only allowed to perform GET requests.
 * Any non-GET request (POST, PUT, PATCH, DELETE) will be rejected with 403 Forbidden.
 */
export const auditorReadExtraGuard = (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).user;

  if (!user) {
    return next(); // Let auth middleware handle missing user
  }

  // Check if the user has the GOV_AUDITOR role
  const isAuditor = user.roles?.includes('GOV_AUDITOR');

  if (isAuditor && req.method !== 'GET') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Auditors have read-only access and cannot perform this action.',
    });
  }

  next();
};
