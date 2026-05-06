import { NextFunction, Request, Response } from 'express';

/**
 * Middleware to enforce read-only access for AUDITOR role.
 * Auditors are read-only by default, with a small allowlist for the
 * government audit workflow.
 */
export const auditorReadExtraGuard = (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).user;

  if (!user) {
    return next(); // Let auth middleware handle missing user
  }

  // Check if the user has the GOV_AUDITOR role
  const isAuditor = user.roles?.includes('GOV_AUDITOR');
  const allowedWrites = [
    { method: 'POST', pattern: /^\/gov\/audits$/ },
    { method: 'POST', pattern: /^\/gov\/reports$/ },
    { method: 'POST', pattern: /^\/gov\/incidents\/[^/]+\/feedback$/ },
  ];

  const allowedReadPaths = [
    '/gov/dashboard',
    '/gov/schools',
    '/gov/audits',
  ];

  const isAllowedRead = allowedReadPaths.some(path => req.path.startsWith(path)) || req.path.startsWith('/gov/schools/');

  const isAllowedWrite = allowedWrites.some(
    entry => entry.method === req.method && entry.pattern.test(req.path)
  );

  if (isAuditor && req.method !== 'GET' && !isAllowedWrite) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Auditors have read-only access and cannot perform this action.',
    });
  }

  if (isAuditor && req.method === 'GET' && !isAllowedRead) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Auditors cannot access this endpoint.',
    });
  }

  next();
};
