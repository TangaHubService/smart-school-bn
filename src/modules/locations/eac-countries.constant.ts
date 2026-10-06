export interface EacCountryConfig {
  code: string;
  nameEn: string;
  timezone: string;
}

export const EAC_COUNTRIES: Record<string, EacCountryConfig> = {
  ke: { code: 'ke', nameEn: 'Kenya', timezone: 'Africa/Nairobi' },
  ug: { code: 'ug', nameEn: 'Uganda', timezone: 'Africa/Kampala' },
  tz: { code: 'tz', nameEn: 'Tanzania', timezone: 'Africa/Dar_es_Salaam' },
  rw: { code: 'rw', nameEn: 'Rwanda', timezone: 'Africa/Kigali' },
  bi: { code: 'bi', nameEn: 'Burundi', timezone: 'Africa/Bujumbura' },
  ss: { code: 'ss', nameEn: 'South Sudan', timezone: 'Africa/Juba' },
  cd: { code: 'cd', nameEn: 'DR Congo', timezone: 'Africa/Kinshasa' },
  so: { code: 'so', nameEn: 'Somalia', timezone: 'Africa/Mogadishu' },
};

export const EAC_COUNTRY_CODES = Object.keys(EAC_COUNTRIES);

export function isEacCountryCode(code: string | undefined | null): code is string {
  return Boolean(code) && Object.prototype.hasOwnProperty.call(EAC_COUNTRIES, code as string);
}
