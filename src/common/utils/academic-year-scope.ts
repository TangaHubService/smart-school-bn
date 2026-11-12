import { Request } from 'express';
import { z } from 'zod';

import { prisma } from '../../db/prisma';

/**
 * Sent by the client as `academicYearId=all` when the user explicitly picks "All years".
 * Without it, an omitted year falls back to the saved preference below, so "All years"
 * could never show more than one year.
 */
export const ALL_ACADEMIC_YEARS = 'all';

/** Query-schema field for list endpoints: a year id, or ALL_ACADEMIC_YEARS. */
export const academicYearFilterSchema = z
  .union([z.string().uuid(), z.literal(ALL_ACADEMIC_YEARS)])
  .optional();

/**
 * Resolves the academic year a request should be scoped to: an explicit query/body value
 * wins, then the x-academic-year-id header (set by academicYearScopeMiddleware, which runs
 * before authentication so it cannot read a saved preference), then the caller's saved
 * preference looked up here — this runs inside a controller, after that router's own
 * authenticate/enforceTenant middleware, so req.user/req.tenantId are guaranteed to be set.
 * Prevents endpoints from silently returning data mixed across every academic year when a
 * client omits the filter. An explicit ALL_ACADEMIC_YEARS returns undefined (no year scope).
 */
export async function resolveAcademicYearId(req: Request, explicit?: string): Promise<string | undefined> {
  if (explicit === ALL_ACADEMIC_YEARS) {
    return undefined;
  }

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
