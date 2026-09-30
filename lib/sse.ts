import type { SearchEvent } from './types';

/**
 * Server-Sent Events framing for /api/search. The browser reads the stream
 * with fetch() rather than EventSource, which can't POST and reconnects on
 * its own (re-running the whole search).
 */

export const SSE_HEADERS: HeadersInit = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  // no-transform keeps proxies and gzip from buffering the stream.
  'Cache-Control': 'no-cache, no-transform',
  'X-Accel-Buffering': 'no',
};

const encoder = new TextEncoder();

export function encodeEvent(event: SearchEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

/** Yields events as they arrive, however the network splits the chunks. */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SearchEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      // `stream: true` keeps a multi-byte character split across chunks intact.
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data) yield JSON.parse(data) as SearchEvent;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
