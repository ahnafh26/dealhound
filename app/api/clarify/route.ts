import { SearchRequestSchema } from '@/lib/schemas';
import { parseQuery } from '@/lib/spec';

const ClarifyRequestSchema = SearchRequestSchema.pick({ query: true, clarify: true });

/**
 * POST { query, clarify? } → SpecResult as JSON: how a query will be read
 * (a spec, or the clarifying question it needs), without running a search.
 */
export async function POST(request: Request) {
  const parsed = ClarifyRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' }, { status: 400 });
  }
  const result = await parseQuery(parsed.data.query, {
    allowClarify: parsed.data.clarify !== false,
    signal: request.signal,
  });
  return Response.json(result);
}
