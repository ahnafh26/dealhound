import { SEARCH } from '@/lib/config';
import { defaultPostalCode, defaultRegion } from '@/lib/env';
import { resolveRegion } from '@/lib/region';
import { SearchRequestSchema } from '@/lib/schemas';
import { fanOut, toClientListing } from '@/lib/search';
import { planSources } from '@/lib/sources';
import { parseQuery } from '@/lib/spec';
import { encodeEvent, SSE_HEADERS } from '@/lib/sse';
import type { SearchEvent } from '@/lib/types';

// Vercel: allow for the spec parser plus the slowest source.
export const maxDuration = 30;

/**
 * POST { query, postalCode?, region? } → text/event-stream of SearchEvents.
 * Each source's results are sent the moment that source answers.
 */
export async function POST(request: Request) {
  const parsed = SearchRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' }, { status: 400 });
  }
  const { query, postalCode, region: regionCode } = parsed.data;
  const region = resolveRegion(regionCode ?? defaultRegion(), postalCode ?? defaultPostalCode());

  // Stops outstanding source requests when the shopper navigates away or starts a new search.
  const abort = new AbortController();
  request.signal.addEventListener('abort', () => abort.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const started = Date.now();
      const send = (event: SearchEvent) => {
        try {
          controller.enqueue(encodeEvent(event));
        } catch {
          abort.abort(); // The client is gone.
        }
      };

      try {
        const result = await parseQuery(query);
        if (result.kind === 'clarify') {
          send({ type: 'clarify', question: result.question });
          return;
        }

        const { spec } = result;
        send({ type: 'spec', spec, region });

        const plan = planSources(region.code);
        send({ type: 'sources', sources: plan.statuses });

        let total = 0;
        await fanOut(
          plan.active,
          spec,
          { region, signal: abort.signal, limit: SEARCH.maxListingsPerSource },
          ({ status, listings }) => {
            send({ type: 'source', source: status });
            if (listings.length > 0) {
              total += listings.length;
              send({ type: 'listings', source: status.id, listings: listings.map(toClientListing) });
            }
          },
        );
        send({ type: 'done', ms: Date.now() - started, total });
      } catch (err) {
        console.error('[api/search] failed', err);
        send({ type: 'error', message: 'Search failed unexpectedly. Please try again.' });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by a disconnect.
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
