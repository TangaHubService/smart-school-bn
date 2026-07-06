import { Request } from 'express';

import { prisma } from '../../db/prisma';

/**
 * Resolves the academic year a request should be scoped to: an explicit query/body value
 * wins, then the x-academic-year-id header (set by academicYearScopeMiddleware, which runs
 * before authentication so it cannot read a saved preference), then the caller's saved
 * preference looked up here — this runs inside a controller, after that router's own
 * authenticate/enforceTenant middleware, so req.user/req.tenantId are guaranteed to be set.
 * Prevents endpoints from silently returning data mixed across every academic year when a
 * client omits the filter.
 */
export async function resolveAcademicYearId(req: Request, explicit?: string): Promise<string | undefined> {
  if (explicit) {
    return explicit;
  }

  if (req.academicYearId) {
    return req.academicYearId;
  }

  if (req.user?.sub && req.tenantId) {
    const pref = await prisma.userAcademicYearPreference.findUnique({
      where: { userId: req.user.sub },
    });
    if (pref) {
      return pref.academicYearId;
    }
  }

  return undefined;
}
