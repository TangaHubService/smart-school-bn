import { NextFunction, Request, Response } from 'express';

declare global {
  namespace Express {
    interface Request {
      academicYearId?: string;
      termId?: string;
    }
  }
}

/**
 * Runs before authentication (mounted globally ahead of apiRouter), so it can only resolve
 * an academic year from the request itself (query/body/header) — never from a saved user
 * preference, since req.user isn't populated yet at this point. The preference fallback
 * lives in resolveAcademicYearId() (src/common/utils/academic-year-scope.ts), which runs
 * inside controllers after each router's own authenticate/enforceTenant middleware.
 */
export function academicYearScopeMiddleware(req: Request, _res: Response, next: NextFunction) {
  let academicYearId = (req.query.academicYearId as string) || req.body?.academicYearId;
  let termId = (req.query.termId as string) || req.body?.termId;

  if (!academicYearId) {
    academicYearId = req.headers['x-academic-year-id'] as string;
    termId = termId || (req.headers['x-term-id'] as string);
  }

  req.academicYearId = academicYearId;
  req.termId = termId;
  next();
}
