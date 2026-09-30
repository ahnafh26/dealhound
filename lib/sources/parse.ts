/** Parsing helpers shared by the source adapters. */

/** "$1,049.99", "CA$1 049", "1.049,99 $" → 1049.99. Null when there's no number. */
export function parseMoney(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = text.replace(/[^\d.,]/g, '');
  if (!/\d/.test(cleaned)) return null;
  // A separator followed by exactly two final digits is the cents; every other separator groups thousands.
  const match = /^(.*?)(?:[.,](\d{2}))?$/.exec(cleaned);
  if (!match) return null;
  const amount = Number(`${match[1].replace(/[.,]/g, '') || '0'}.${match[2] ?? '0'}`);
  return Number.isFinite(amount) ? amount : null;
}

/** Plain text from an HTML fragment: tags dropped, common entities decoded, whitespace collapsed. */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncate(text: string, max = 400): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The JSON object starting at `start` (a "{"), found by matching braces outside strings. */
export function sliceJsonObject(text: string, start: number): string | null {
  if (text[start] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth++;
    } else if (char === '}' && --depth === 0) {
      return text.slice(start, i + 1);
    }
  }
  return null;
}

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'in', 'of', 'on']);

/** Lowercase words, with sizes like "16 GB" joined into "16gb". */
export function searchTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/(\d+)\s*(gb|tb)\b/g, '$1$2')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/** Share of the query's words found in a title: a crude stand-in for a site's own search. */
export function relevance(query: string, title: string): number {
  const wanted = searchTokens(query);
  if (wanted.length === 0) return 0;
  const have = searchTokens(title);
  const found = wanted.filter((word) =>
    have.some((token) => token === word || (word.length >= 3 && token.includes(word))),
  );
  return found.length / wanted.length;
}

/** Decodes text cut out of a JSON string inside a page (\u escapes, \/, \"). */
export function unescapeJsonString(raw: string): string {
  try {
    return (JSON.parse(`"${raw}"`) as string).replace(/ /g, ' ').trim();
  } catch {
    return raw;
  }
}
