import { describe, expect, it } from 'vitest';
import { parseMoney, stripHtml, truncate, unescapeJsonString } from '@/lib/sources/parse';

describe('parseMoney', () => {
  it.each([
    ['$1,049.99', 1049.99],
    ['CA$1,000', 1000],
    ['4 500 C$', 4500],
    ['1.049,99 $', 1049.99],
    ['$0', 0],
    ['1 299 $', 1299],
  ])('%s → %d', (text, amount) => {
    expect(parseMoney(text)).toBe(amount);
  });

  it('is null without a number', () => {
    expect(parseMoney('Free')).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
  });
});

describe('text helpers', () => {
  it('strips tags and entities', () => {
    expect(stripHtml('Like new<br />AppleCare&nbsp;until <b>2028</b> &amp; box')).toBe(
      'Like new AppleCare until 2028 & box',
    );
  });

  it('decodes JSON string escapes, including non-breaking spaces', () => {
    expect(unescapeJsonString('Montr\\u00e9al')).toBe('Montréal');
    expect(unescapeJsonString('https:\\/\\/example.com\\/p.jpg')).toBe('https://example.com/p.jpg');
    expect(unescapeJsonString('4\\u00a0500\\u00a0C$')).toBe('4 500 C$');
  });

  it('truncates with an ellipsis', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
  });
});
