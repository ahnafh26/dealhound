import { describe, expect, it } from 'vitest';
import { normalizeAttributeName, normalizeAttributeValue } from '@/lib/attributes';
import { cleanSearchQuery, parseWithRules } from '@/lib/spec-rules';

describe('parseWithRules: known families', () => {
  it('reads an M4 MacBook Air query completely', () => {
    const { spec, confident, clarify } = parseWithRules('M4 MacBook Air 16GB 512GB midnight');
    expect(confident).toBe(true);
    expect(clarify).toBeUndefined();
    expect(spec).toMatchObject({
      brand: 'Apple',
      category: 'laptop',
      model: 'MacBook Air',
      searchQuery: 'MacBook Air M4',
      required: { chip: 'M4', ram: '16GB', storage: '512GB' },
      optional: { color: 'Midnight' },
      parsedBy: 'rules',
    });
  });

  it('does not mistake an M4 Pro chip for the MacBook Pro line, or vice versa', () => {
    expect(parseWithRules('MacBook Pro M4 Pro 24GB 14"').spec).toMatchObject({
      model: 'MacBook Pro',
      required: { chip: 'M4 Pro', ram: '24GB', screen: '14-inch' },
    });
    // Pro and Max chips only ship in the MacBook Pro.
    expect(parseWithRules('M3 Max macbook').spec.model).toBe('MacBook Pro');
  });

  it('asks Air or Pro when a MacBook query does not say, keeping the specs', () => {
    const { clarify, confident, spec } = parseWithRules('M4 MacBook 16GB');
    expect(confident).toBe(true);
    expect(spec.model).toBeNull();
    expect(clarify?.options).toEqual([
      { label: 'MacBook Air', query: 'MacBook Air M4 16GB' },
      { label: 'MacBook Pro', query: 'MacBook Pro M4 16GB' },
    ]);
  });

  it('infers the MacBook line from the screen size', () => {
    expect(parseWithRules('15 inch macbook m3').spec.model).toBe('MacBook Air');
    expect(parseWithRules('macbook 16-inch').spec.model).toBe('MacBook Pro');
  });

  it('reads iPhone models, with storage rather than RAM', () => {
    expect(parseWithRules('iphone 15 pro max 256gb').spec).toMatchObject({
      model: 'iPhone 15 Pro Max',
      category: 'phone',
      searchQuery: 'iPhone 15 Pro Max',
      required: { storage: '256GB' },
    });
    expect(parseWithRules('iPhone 16e').spec.model).toBe('iPhone 16e');
    expect(parseWithRules('iphone se 64gb').spec.model).toBe('iPhone SE');
  });

  it('knows Sony WH headphones from WF earbuds, and asks when neither is named', () => {
    expect(parseWithRules('sony wh1000xm5 black').spec).toMatchObject({
      model: 'WH-1000XM5',
      category: 'headphones',
      searchQuery: 'Sony WH-1000XM5',
      optional: { color: 'Black' },
    });
    expect(parseWithRules('Sony WF-1000XM4').spec.category).toBe('earbuds');

    const { clarify } = parseWithRules('Sony XM5');
    expect(clarify?.options.map((o) => o.query)).toEqual(['Sony WH-1000XM5', 'Sony WF-1000XM5']);
  });
});

describe('parseWithRules: anything else', () => {
  it('is not confident, but still finds the brand and specs', () => {
    const { spec, confident } = parseWithRules('used Dell XPS 13 16GB under $900');
    expect(confident).toBe(false);
    expect(spec).toMatchObject({
      brand: 'Dell',
      searchQuery: 'Dell XPS 13 16GB',
      required: { ram: '16GB' },
    });
  });

  it('reads M4 as a chip only in an Apple context', () => {
    expect(parseWithRules('BMW M4 floor mats').spec.required).toEqual({});
  });

  it('ignores "2-in-1" as a screen size', () => {
    expect(parseWithRules('HP Spectre 2-in-1 laptop').spec.required.screen).toBeUndefined();
  });
});

describe('cleanSearchQuery', () => {
  it('drops budget and purchase words', () => {
    expect(cleanSearchQuery('cheapest refurbished Nintendo Switch 2 under 500')).toBe('Nintendo Switch 2');
    expect(cleanSearchQuery('Steam Deck OLED $450')).toBe('Steam Deck OLED');
  });

  it('keeps the query when nothing would be left', () => {
    expect(cleanSearchQuery('cheap')).toBe('cheap');
  });
});

describe('attribute normalization', () => {
  it.each([
    ['16 gb', '16GB'],
    ['1 tb', '1TB'],
    ['13"', '13-inch'],
    ['14 inch', '14-inch'],
    ['m4 pro', 'M4 Pro'],
    ['  Space   Black ', 'Space Black'],
  ])('%s → %s', (input, output) => {
    expect(normalizeAttributeValue(input)).toBe(output);
  });

  it('snake-cases names', () => {
    expect(normalizeAttributeName(' Screen Size ')).toBe('screen_size');
  });
});
