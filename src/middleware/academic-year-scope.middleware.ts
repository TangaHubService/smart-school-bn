import { NextFunction, Request, Response } from 'express';
import { prisma } from '../db/prisma';

declare global {
  namespace Express {
    interface Request {
      academicYearId?: string;
      termId?: string;
    }
  }
}

export async function academicYearScopeMiddleware(req: Request, _res: Response, next: NextFunction) {
  try {
    let academicYearId = (req.query.academicYearId as string) || req.body?.academicYearId;
    let termId = (req.query.termId as string) || req.body?.termId;

    if (!academicYearId) {
      academicYearId = req.headers['x-academic-year-id'] as string;
      termId = termId || (req.headers['x-term-id'] as string);
    }

    if (!academicYearId && req.user?.sub && req.tenantId) {
      const pref = await prisma.userAcademicYearPreference.findUnique({
        where: { userId: req.user.sub },
      });
      if (pref) {
        academicYearId = pref.academicYearId;
        termId = termId || pref.termId ?? undefined;
      }
    }

    req.academicYearId = academicYearId;
    req.termId = termId;
    next();
  } catch (error) {
    next(error);
  }
}
