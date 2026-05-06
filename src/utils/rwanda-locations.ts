import { Provinces, Districts, Sectors, Cells, Villages } from 'rwanda';

export type Province = string;
export type District = string;
export type Sector = string;
export type Cell = string;
export type Village = string;

export interface LocationHierarchy {
  province: Province;
  district: District;
  sector: Sector;
  cell?: Cell;
  village?: Village;
}

export function getProvinces(): string[] {
  return Provinces();
}

export function getDistricts(province: string): string[] {
  const provincesList = getProvinces();
  const normalizedProvince = provincesList.find(
    (p: string) => p.toLowerCase() === province.toLowerCase()
  );
  if (!normalizedProvince) return [];
  return (Districts({ provinces: [normalizedProvince] } as any) as string[]) || [];
}

export function getSectors(province: string, district: string): string[] {
  const districtsList = getDistricts(province);
  const normalizedDistrict = districtsList.find(
    (d: string) => d.toLowerCase() === district.toLowerCase()
  );
  if (!normalizedDistrict) return [];

  const sectors = Sectors({ province, district: normalizedDistrict } as any) as string[];
  return sectors || [];
}

interface SectorDistrictFlat {
  sector: string;
  district: string;
  province: string;
}

const sectorToDistrictFlat: SectorDistrictFlat[] = (() => {
  const result: SectorDistrictFlat[] = [];
  const provincesList = getProvinces();

  const allSectors = Sectors() as string[];
  const allDistricts = Districts() as string[];

  for (const province of provincesList) {
    const provinceDistricts = getDistricts(province);

    for (const sector of allSectors) {
      for (const d of provinceDistricts) {
        const sectorLower = sector.toLowerCase();
        const districtLower = d.toLowerCase();

        if (sectorBelongsToDistrict(sector, d)) {
          result.push({ sector, district: d, province });
          break;
        }
      }
    }
  }

  return result;
})();

function sectorBelongsToDistrict(sector: string, district: string): boolean {
  const allDistricts = Districts() as string[];
  const districtDistricts = getDistrictsContainingSector(sector);

  for (const d of allDistricts) {
    if (d.toLowerCase() === district.toLowerCase()) {
      return districtDistricts.some(dd => dd.toLowerCase() === district.toLowerCase());
    }
  }
  return false;
}

function getDistrictsContainingSector(sector: string): string[] {
  const allSectors = Sectors() as string[];
  const allDistricts = Districts() as string[];
  const result: string[] = [];

  for (const district of allDistricts) {
    const isInDistrict = allSectors.some(s => s.toLowerCase() === sector.toLowerCase());
    if (isInDistrict) {
      const sectorDistricts = getAllDistrictsForSectorName(sector);
      if (sectorDistricts.includes(district)) {
        result.push(district);
      }
    }
  }

  return result;
}

function getAllDistrictsForSectorName(sectorName: string): string[] {
  const sectorDistricts: string[] = [];
  const allDistricts = Districts() as string[];

  for (const district of allDistricts) {
    const sectors = getSectorsWithoutFilter();
    if (sectors.includes(sectorName)) {
      sectorDistricts.push(district);
    }
  }

  return sectorDistricts;
}

function getSectorsWithoutFilter(): string[] {
  return Sectors() as string[];
}

export function getCells(province: string, district: string, sector: string): string[] {
  const sectorsList = getSectors(province, district);
  const normalizedSector = sectorsList.find(
    (s: string) => s.toLowerCase() === sector.toLowerCase()
  );
  if (!normalizedSector) return [];

  const cells = Cells({ province, district, sector: normalizedSector } as any) as string[];
  return cells || [];
}

function buildCellToSectorMap(): Record<string, string> {
  const map: Record<string, string> = {};
  const provincesList = getProvinces();

  for (const province of provincesList) {
    const districtsList = getDistricts(province);
    for (const district of districtsList) {
      const sectorsList = getSectors(province, district);
      for (const sector of sectorsList) {
        try {
          const cells = Cells({ province, district, sector } as any) as string[];
          for (const cell of cells) {
            map[cell] = sector;
          }
        } catch {}
      }
    }
  }
  return map;
}

export function getVillages(
  province: string,
  district: string,
  sector: string,
  cell: string
): string[] {
  const cellsList = getCells(province, district, sector);
  const normalizedCell = cellsList.find((c: string) => c.toLowerCase() === cell.toLowerCase());
  if (!normalizedCell) return [];

  const villages = Villages({
    province,
    district,
    sector,
    cell: normalizedCell,
  } as any) as string[];
  return villages || [];
}

function buildVillageToCellMap(): Record<string, string> {
  const map: Record<string, string> = {};
  const provincesList = getProvinces();

  for (const province of provincesList) {
    const districtsList = getDistricts(province);
    for (const district of districtsList) {
      const sectorsList = getSectors(province, district);
      for (const sector of sectorsList) {
        try {
          const cells = getCells(province, district, sector);
          for (const cell of cells) {
            try {
              const villages = Villages({ province, district, sector, cell } as any) as string[];
              for (const village of villages) {
                map[village] = cell;
              }
            } catch {}
          }
        } catch {}
      }
    }
  }
  return map;
}

export function getAllDistricts(): { province: string; districts: string[] }[] {
  const provincesList = getProvinces();
  return provincesList.map(province => ({
    province,
    districts: getDistricts(province),
  }));
}

export function getAllSectors(): { province: string; district: string; sectors: string[] }[] {
  const result: { province: string; district: string; sectors: string[] }[] = [];
  const provinceDistrictList = getAllDistricts();

  for (const { province, districts } of provinceDistrictList) {
    for (const district of districts) {
      result.push({
        province,
        district,
        sectors: getSectors(province, district),
      });
    }
  }

  return result;
}

export function normalizeProvince(province: string): string | null {
  const provincesList = getProvinces();
  return provincesList.find((p: string) => p.toLowerCase() === province.toLowerCase()) || null;
}

export function normalizeDistrict(province: string, district: string): string | null {
  const districtsList = getDistricts(province);
  return districtsList.find((d: string) => d.toLowerCase() === district.toLowerCase()) || null;
}

export function normalizeSector(province: string, district: string, sector: string): string | null {
  const sectorsList = getSectors(province, district);
  return sectorsList.find((s: string) => s.toLowerCase() === sector.toLowerCase()) || null;
}
