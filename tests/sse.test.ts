import { describe, expect, it } from 'vitest';
import { encodeEvent, readEvents } from '@/lib/sse';
import type { SearchEvent } from '@/lib/types';

const events: SearchEvent[] = [
  { type: 'sources', sources: [] },
  { type: 'error', message: 'multi\nline "quoted" text' },
  { type: 'done', ms: 1234, total: 0 },
];

/** A stream that delivers `bytes` in chunks of `size`, splitting frames anywhere. */
function chunked(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<SearchEvent[]> {
  const received: SearchEvent[] = [];
  for await (const event of readEvents(stream)) received.push(event);
  return received;
}

describe('SSE framing', () => {
  const bytes = new Uint8Array(events.flatMap((event) => [...encodeEvent(event)]));

  it.each([1, 3, 7, 64, 100_000])('round-trips events split into %i-byte chunks', async (size) => {
    expect(await collect(chunked(bytes, size))).toEqual(events);
  });
});
