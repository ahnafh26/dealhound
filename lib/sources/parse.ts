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

/** Decodes text cut out of a JSON string inside a page (\u escapes, \/, \"). */
export function unescapeJsonString(raw: string): string {
  try {
    return (JSON.parse(`"${raw}"`) as string).replace(/ /g, ' ').trim();
  } catch {
    return raw;
  }
}
