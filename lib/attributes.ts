/**
 * Attribute names and value formats shared by the rules reader, the LLM
 * reader and (later) the matcher, so "16 gb", "16GB" and "16 GB" compare equal.
 *
 * Preferred names: chip, ram, storage, screen, generation, year, size,
 * capacity, connectivity, color.
 */

export function normalizeAttributeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function normalizeAttributeValue(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/(\d+(?:\.\d+)?)\s?(gb|tb)\b/gi, (_match, amount: string, unit: string) => `${amount}${unit.toUpperCase()}`)
    .replace(/(\d+(?:\.\d+)?)\s?(?:"|”|''|-?\s?inch(?:es)?\b|-?\s?in\b)/gi, '$1-inch')
    .replace(/\bm([1-9])(?:\s?(pro|max|ultra))?\b/gi, (_match, generation: string, tier?: string) =>
      tier ? `M${generation} ${capitalize(tier)}` : `M${generation}`,
    );
}

export function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}
