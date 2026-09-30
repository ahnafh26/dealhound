import { CA_TAX, REGIONS, US_TAX, type TaxRate } from './config';
import { REGION_CODES, type RegionCode, type SearchRegion } from './types';

/** First letter of a Canadian postal code → province. `X` is handled separately. */
const CA_POSTAL_PREFIX: Record<string, string> = {
  A: 'NL',
  B: 'NS',
  C: 'PE',
  E: 'NB',
  G: 'QC',
  H: 'QC',
  J: 'QC',
  K: 'ON',
  L: 'ON',
  M: 'ON',
  N: 'ON',
  P: 'ON',
  R: 'MB',
  S: 'SK',
  T: 'AB',
  V: 'BC',
  Y: 'YT',
};

const CA_POSTAL_CODE = /^([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z])(\d[ABCEGHJ-NPRSTV-Z]\d)$/;
const US_ZIP_CODE = /^(\d{5})(?:-?\d{4})?$/;

export function isRegionCode(value: unknown): value is RegionCode {
  return REGION_CODES.includes(value as RegionCode);
}

/** "m5v3l9" → "M5V 3L9"; "10001-1234" → "10001". Returns undefined for anything invalid. */
export function normalizePostalCode(region: RegionCode, input: string | undefined): string | undefined {
  const compact = input?.replace(/\s+/g, '').toUpperCase();
  if (!compact) return undefined;
  if (region === 'CA') {
    const match = CA_POSTAL_CODE.exec(compact);
    return match ? `${match[1]} ${match[2]}` : undefined;
  }
  return US_ZIP_CODE.exec(compact)?.[1];
}

export function provinceFromPostalCode(postalCode: string): string | undefined {
  const first = postalCode[0];
  // X0A–X0C are Nunavut; the other X codes are the Northwest Territories.
  if (first === 'X') return /^X0[ABC]/.test(postalCode) ? 'NU' : 'NT';
  return CA_POSTAL_PREFIX[first];
}

export function resolveRegion(code: RegionCode, postalCodeInput?: string): SearchRegion {
  const config = REGIONS[code];
  const postalCode = normalizePostalCode(code, postalCodeInput);
  const fromPostalCode = code === 'CA' && postalCode ? provinceFromPostalCode(postalCode) : undefined;
  return {
    code,
    currency: config.currency,
    postalCode,
    subdivision: fromPostalCode ?? config.defaultSubdivision,
    subdivisionSource: fromPostalCode ? 'postal-code' : 'default',
  };
}

export function taxRateFor(region: Pick<SearchRegion, 'code' | 'subdivision'>): TaxRate {
  if (region.code === 'CA') return CA_TAX[region.subdivision] ?? CA_TAX[REGIONS.CA.defaultSubdivision];
  return US_TAX;
}
