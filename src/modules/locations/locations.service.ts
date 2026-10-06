import axios from 'axios';

import { AppError } from '../../common/errors/app-error';
import { env } from '../../config/env';
import { EAC_COUNTRIES, EAC_COUNTRY_CODES, isEacCountryCode } from './eac-countries.constant';

interface OpenAdminDataLevel {
  key: string;
  name_en: string;
  name_local: string;
}

interface OpenAdminDataCountryMeta {
  code: string;
  name_en: string;
  name_local: string;
  levels: OpenAdminDataLevel[];
  stats: Record<string, number>;
}

interface OpenAdminDataCountriesResponse {
  countries: OpenAdminDataCountryMeta[];
}

interface OpenAdminDataDivisionRecord {
  id: string;
  name_en: string;
  name_local: string;
  slug: string;
  lat?: number;
  lon?: number;
  parent_id?: string;
}

interface OpenAdminDataCountryResponse {
  meta: {
    country: string;
    levels: OpenAdminDataLevel[];
    stats: Record<string, number>;
  };
  data: Record<string, OpenAdminDataDivisionRecord[]>;
}

export interface EacCountrySummary {
  code: string;
  nameEn: string;
  levels: { key: string; nameEn: string }[];
}

export interface LocationDivisionSummary {
  id: string;
  nameEn: string;
  nameLocal: string;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class LocationsService {
  private countriesMetaCache: CacheEntry<OpenAdminDataCountryMeta[]> | null = null;
  private readonly countryDataCache = new Map<string, CacheEntry<OpenAdminDataCountryResponse>>();

  async listEacCountries(): Promise<EacCountrySummary[]> {
    const allCountries = await this.fetchAllCountriesMeta();
    const eacMeta = allCountries.filter(country => isEacCountryCode(country.code));

    return EAC_COUNTRY_CODES.map(code => {
      const meta = eacMeta.find(country => country.code === code);
      return {
        code,
        nameEn: meta?.name_en ?? EAC_COUNTRIES[code].nameEn,
        levels: (meta?.levels ?? []).map(level => ({ key: level.key, nameEn: level.name_en })),
      };
    });
  }

  async getDivisions(
    countryCode: string,
    level: number,
    parentId?: string
  ): Promise<LocationDivisionSummary[]> {
    const normalizedCode = countryCode.toLowerCase();
    if (!isEacCountryCode(normalizedCode)) {
      throw new AppError(
        400,
        'LOCATION_COUNTRY_NOT_SUPPORTED',
        `Country code "${countryCode}" is not a supported EAC country`
      );
    }

    const countryData = await this.fetchCountryData(normalizedCode);
    const levels = countryData.meta.levels;
    const levelIndex = level - 1;

    if (!Number.isInteger(levelIndex) || levelIndex < 0 || levelIndex >= levels.length) {
      throw new AppError(
        400,
        'LOCATION_LEVEL_INVALID',
        `Level ${level} is not valid for country "${normalizedCode}" (expected 1-${levels.length})`
      );
    }

    if (levelIndex > 0 && !parentId) {
      throw new AppError(
        400,
        'LOCATION_PARENT_ID_REQUIRED',
        `parentId is required to look up level ${level} divisions`
      );
    }

    const levelKey = levels[levelIndex].key;
    const records = countryData.data[levelKey] ?? [];

    const filtered = levelIndex === 0 ? records : records.filter(record => record.parent_id === parentId);

    return filtered.map(record => ({
      id: record.id,
      nameEn: record.name_en,
      nameLocal: record.name_local,
    }));
  }

  private async fetchAllCountriesMeta(): Promise<OpenAdminDataCountryMeta[]> {
    const now = Date.now();
    if (this.countriesMetaCache && this.countriesMetaCache.expiresAt > now) {
      return this.countriesMetaCache.value;
    }

    const response = await axios.get<OpenAdminDataCountriesResponse>(
      `${env.OPENADMINDATA_API_BASE_URL}/countries.json`,
      { timeout: 10_000 }
    );

    const countries = response.data.countries;
    this.countriesMetaCache = { value: countries, expiresAt: now + CACHE_TTL_MS };
    return countries;
  }

  private async fetchCountryData(countryCode: string): Promise<OpenAdminDataCountryResponse> {
    const now = Date.now();
    const cached = this.countryDataCache.get(countryCode);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const response = await axios.get<OpenAdminDataCountryResponse>(
      `${env.OPENADMINDATA_API_BASE_URL}/countries/${countryCode}.json`,
      { timeout: 10_000 }
    );

    this.countryDataCache.set(countryCode, { value: response.data, expiresAt: now + CACHE_TTL_MS });
    return response.data;
  }
}
