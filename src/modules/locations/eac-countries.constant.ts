export interface EacCountryConfig {
  code: string;
  nameEn: string;
  /** Full state name, as printed on official documents. */
  officialName: string;
  timezone: string;
}

export const EAC_COUNTRIES: Record<string, EacCountryConfig> = {
  ke: { code: 'ke', nameEn: 'Kenya', officialName: 'Republic of Kenya', timezone: 'Africa/Nairobi' },
  ug: { code: 'ug', nameEn: 'Uganda', officialName: 'Republic of Uganda', timezone: 'Africa/Kampala' },
  tz: { code: 'tz', nameEn: 'Tanzania', officialName: 'United Republic of Tanzania', timezone: 'Africa/Dar_es_Salaam' },
  rw: { code: 'rw', nameEn: 'Rwanda', officialName: 'Republic of Rwanda', timezone: 'Africa/Kigali' },
  bi: { code: 'bi', nameEn: 'Burundi', officialName: 'Republic of Burundi', timezone: 'Africa/Bujumbura' },
  ss: { code: 'ss', nameEn: 'South Sudan', officialName: 'Republic of South Sudan', timezone: 'Africa/Juba' },
  cd: { code: 'cd', nameEn: 'DR Congo', officialName: 'Democratic Republic of the Congo', timezone: 'Africa/Kinshasa' },
  so: { code: 'so', nameEn: 'Somalia', officialName: 'Federal Republic of Somalia', timezone: 'Africa/Mogadishu' },
};

export const EAC_COUNTRY_CODES = Object.keys(EAC_COUNTRIES);

export function isEacCountryCode(code: string | undefined | null): code is string {
  return Boolean(code) && Object.prototype.hasOwnProperty.call(EAC_COUNTRIES, code as string);
}

/** Official state name for a stored country name; unknown countries print as registered. */
export function officialCountryName(country: string | undefined | null): string {
  const name = country?.trim() ?? '';
  const match = Object.values(EAC_COUNTRIES).find(c => c.nameEn.toLowerCase() === name.toLowerCase());
  return match?.officialName ?? name;
}

/** The school's country: the code picked at registration wins over the free-text name. */
export function schoolCountryName(
  school: { country?: string | null; adminCountryCode?: string | null } | null | undefined
): string | null {
  const code = school?.adminCountryCode?.toLowerCase();
  return (isEacCountryCode(code) ? EAC_COUNTRIES[code].nameEn : school?.country) ?? null;
}
