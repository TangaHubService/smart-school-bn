import { z } from 'zod';

/**
 * Generic EAC administrative-division fields, shared by every "create/update school"
 * schema. `adminLevel1..4` hold division names (not ids) for whichever country's
 * hierarchy applies — depth and labels vary per country and are resolved via the
 * locations module (see src/modules/locations).
 */
export const schoolLocationFields = {
  adminCountryCode: z
    .string()
    .trim()
    .length(2)
    .toLowerCase()
    .optional(),
  adminLevel1: z.string().trim().max(150).optional(),
  adminLevel2: z.string().trim().max(150).optional(),
  adminLevel3: z.string().trim().max(150).optional(),
  adminLevel4: z.string().trim().max(150).optional(),
};
