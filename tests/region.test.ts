import { describe, expect, it } from 'vitest';
import { normalizePostalCode, resolveRegion, taxRateFor } from '@/lib/region';

describe('Canadian postal codes', () => {
  it.each([
    ['M5V 3L9', 'ON'],
    ['h2x1y4', 'QC'],
    ['V6B 1A1', 'BC'],
    ['T2P 1J9', 'AB'],
    ['B3H 4R2', 'NS'],
    ['A1C 5M2', 'NL'],
    ['X0A 0H0', 'NU'],
    ['X1A 2P7', 'NT'],
    ['Y1A 1B1', 'YT'],
  ])('%s is in %s', (postalCode, province) => {
    const region = resolveRegion('CA', postalCode);
    expect(region.subdivision).toBe(province);
    expect(region.subdivisionSource).toBe('postal-code');
  });

  it('normalizes case and spacing', () => {
    expect(normalizePostalCode('CA', ' m5v3l9 ')).toBe('M5V 3L9');
  });

  it('rejects codes that cannot exist', () => {
    expect(normalizePostalCode('CA', 'D5V 3L9')).toBeUndefined(); // No postal code starts with D.
    expect(normalizePostalCode('CA', '12345')).toBeUndefined();
  });

  it('falls back to the default province without a usable code', () => {
    for (const input of [undefined, '', 'nope']) {
      const region = resolveRegion('CA', input);
      expect(region).toMatchObject({ subdivision: 'ON', subdivisionSource: 'default', postalCode: undefined });
    }
  });
});

describe('taxRateFor', () => {
  it('combines federal and provincial tax', () => {
    expect(taxRateFor(resolveRegion('CA', 'H2X 1Y4')).rate).toBeCloseTo(0.14975);
    expect(taxRateFor(resolveRegion('CA', 'T2P 1J9')).rate).toBe(0.05);
    expect(taxRateFor(resolveRegion('CA', 'B3H 4R2')).rate).toBe(0.14);
  });

  it('uses the flat estimate for the US', () => {
    const region = resolveRegion('US', '10001-1234');
    expect(region.postalCode).toBe('10001');
    expect(taxRateFor(region).rate).toBe(0.08);
  });
});
