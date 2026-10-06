import { EAC_COUNTRIES } from '../locations/eac-countries.constant';

export interface SchoolLocationInput {
  adminCountryCode?: string;
  adminLevel1?: string;
  adminLevel2?: string;
  adminLevel3?: string;
  adminLevel4?: string;
  country?: string;
  timezone?: string;
  province?: string;
  city?: string;
  district?: string;
  sector?: string;
  cell?: string;
}

export interface ResolvedSchoolLocation {
  adminCountryCode: string | undefined;
  adminLevel1: string | undefined;
  adminLevel2: string | undefined;
  adminLevel3: string | undefined;
  adminLevel4: string | undefined;
  country: string | undefined;
  timezone: string | undefined;
  province: string | undefined;
  city: string | undefined;
  district: string | undefined;
  sector: string | undefined;
  cell: string | undefined;
}

/**
 * Maps the new generic adminLevel1..4 fields onto the legacy province/district/
 * sector/cell columns so existing readers (dashboard region filters, conduct
 * payloads, exam/audit-report PDFs) keep working unmodified for every EAC
 * country, not just Rwanda, while adminLevel1..4 become the source of truth
 * going forward. Falls back to any raw legacy fields the caller sent directly,
 * for back-compat with older clients.
 */
export function resolveSchoolLocation(input: SchoolLocationInput): ResolvedSchoolLocation {
  const countryMeta = input.adminCountryCode ? EAC_COUNTRIES[input.adminCountryCode] : undefined;

  return {
    adminCountryCode: input.adminCountryCode,
    adminLevel1: input.adminLevel1,
    adminLevel2: input.adminLevel2,
    adminLevel3: input.adminLevel3,
    adminLevel4: input.adminLevel4,
    country: countryMeta?.nameEn ?? input.country,
    timezone: countryMeta?.timezone ?? input.timezone,
    province: input.adminLevel1 ?? input.province,
    district: input.adminLevel2 ?? input.district,
    sector: input.adminLevel3 ?? input.sector,
    cell: input.adminLevel4 ?? input.cell,
    city: input.adminLevel2 ?? input.city,
  };
}
