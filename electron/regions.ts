import { AirportRecord, RegionOption } from '../shared/types';

export const REGION_OPTIONS: RegionOption[] = [
  { id: 'ALL', label: 'Mundo todo (Global)', group: 'Continente' },
  { id: 'SA', label: 'América do Sul', group: 'Continente' },
  { id: 'NA', label: 'América do Norte', group: 'Continente' },
  { id: 'EU', label: 'Europa', group: 'Continente' },
  { id: 'AS', label: 'Ásia', group: 'Continente' },
  { id: 'AF', label: 'África', group: 'Continente' },
  { id: 'OC', label: 'Oceania', group: 'Continente' },

  { id: 'country:BR', label: 'Brasil', group: 'País / Área' },
  { id: 'area:SOUTH_CONE', label: 'Cone Sul (AR, CL, UY, PY)', group: 'País / Área' },
  { id: 'area:ANDES', label: 'Andes & Norte da AS (CO, EC, PE, BO, VE)', group: 'País / Área' },
  { id: 'country:US', label: 'Estados Unidos', group: 'País / Área' },
  { id: 'country:CA', label: 'Canadá', group: 'País / Área' },
  { id: 'area:CARIBBEAN', label: 'Caribe & América Central', group: 'País / Área' },
  { id: 'area:EU_WEST', label: 'Europa Ocidental (UK, FR, DE, ES, PT, IT, CH, AT, NL, BE)', group: 'País / Área' },
  { id: 'area:NORDICS', label: 'Nórdicos (NO, SE, FI, DK, IS)', group: 'País / Área' },
  { id: 'area:MEDITERRANEAN', label: 'Mediterrâneo (PT, ES, FR, IT, GR, HR, TR)', group: 'País / Área' },
  { id: 'country:JP', label: 'Japão', group: 'País / Área' },
  { id: 'area:ANZ', label: 'Austrália & Nova Zelândia', group: 'País / Área' },
];

const AREA_COUNTRIES: Record<string, Set<string>> = {
  'area:SOUTH_CONE': new Set(['AR', 'CL', 'UY', 'PY']),
  'area:ANDES': new Set(['CO', 'EC', 'PE', 'BO', 'VE']),
  'area:CARIBBEAN': new Set([
    'BS', 'CU', 'JM', 'HT', 'DO', 'PR', 'VI', 'KY', 'TC', 'AG', 'DM',
    'LC', 'VC', 'GD', 'BB', 'TT', 'AW', 'CW', 'SX', 'MF', 'GP', 'MQ',
    'BZ', 'GT', 'HN', 'SV', 'NI', 'CR', 'PA', 'MX',
  ]),
  'area:EU_WEST': new Set(['GB', 'IE', 'FR', 'DE', 'ES', 'PT', 'IT', 'CH', 'AT', 'NL', 'BE', 'LU']),
  'area:NORDICS': new Set(['NO', 'SE', 'FI', 'DK', 'IS']),
  'area:MEDITERRANEAN': new Set(['PT', 'ES', 'FR', 'IT', 'GR', 'HR', 'TR', 'MT', 'CY', 'ME', 'AL']),
  'area:ANZ': new Set(['AU', 'NZ']),
};

export function matchesRegion(airport: AirportRecord, regionId: string): boolean {
  if (!regionId || regionId === 'ALL') {
    return true;
  }

  if (regionId.startsWith('country:')) {
    const isoCountry = regionId.slice('country:'.length).toUpperCase();
    return airport.country === isoCountry;
  }

  const areaSet = AREA_COUNTRIES[regionId];
  if (areaSet) {
    return areaSet.has(airport.country);
  }

  return airport.continent === regionId.toUpperCase();
}
