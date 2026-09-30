import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BlockedError,
  isAllowedByRobots,
  parseRobots,
  politeFetch,
  reportBlocked,
  resetHttpState,
  RobotsError,
} from '@/lib/http';

const signal = () => new AbortController().signal;

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init ?? {}));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => resetHttpState());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('politeFetch', () => {
  it('spaces requests to the same host, but not across hosts', async () => {
    mockFetch(() => new Response('ok'));
    const request = { source: 'test', fixture: 'x', signal: signal(), minIntervalMs: 60 };

    const started = Date.now();
    await politeFetch('https://a.example/1', request);
    await politeFetch('https://b.example/1', request);
    expect(Date.now() - started).toBeLessThan(50);

    await politeFetch('https://a.example/2', request);
    expect(Date.now() - started).toBeGreaterThanOrEqual(55);
  });

  it('backs off from a source after a 403, without asking again', async () => {
    const fetchMock = mockFetch(() => new Response('denied', { status: 403 }));
    const request = { source: 'grumpy', fixture: 'x', signal: signal(), minIntervalMs: 0 };

    await expect(politeFetch('https://grumpy.example/', request)).rejects.toBeInstanceOf(BlockedError);
    await expect(politeFetch('https://grumpy.example/', request)).rejects.toThrow(/resting/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('backs off when an adapter reports a block only the body shows', async () => {
    const fetchMock = mockFetch(() => new Response('ok'));
    reportBlocked('walled', 'Login wall');
    await expect(
      politeFetch('https://walled.example/', { source: 'walled', fixture: 'x', signal: signal() }),
    ).rejects.toBeInstanceOf(BlockedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('identifies as DealHound by default and as Chrome in browser mode', async () => {
    vi.stubEnv('DEALHOUND_USER_AGENT', 'DealHound/test (+mailto:me@example.com)');
    const fetchMock = mockFetch(() => new Response('ok'));

    await politeFetch('https://api.example/', { source: 'a', fixture: 'x', signal: signal(), minIntervalMs: 0 });
    await politeFetch('https://page.example/', {
      source: 'b',
      fixture: 'x',
      signal: signal(),
      identity: 'browser',
      minIntervalMs: 0,
    });

    const headers = fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers));
    expect(headers[0].get('user-agent')).toBe('DealHound/test (+mailto:me@example.com)');
    expect(headers[0].get('sec-fetch-mode')).toBeNull();
    expect(headers[1].get('user-agent')).toContain('Chrome/');
    expect(headers[1].get('sec-fetch-mode')).toBe('navigate');
  });

  it('honours robots.txt when asked, fetching it once per origin', async () => {
    const fetchMock = mockFetch((url) =>
      url.endsWith('/robots.txt')
        ? new Response('User-agent: *\nDisallow: /private\n')
        : new Response('page'),
    );
    const request = { source: 'polite', fixture: 'x', signal: signal(), robots: true, minIntervalMs: 0 };

    await expect(politeFetch('https://shop.example/private/deal', request)).rejects.toBeInstanceOf(RobotsError);
    await expect(politeFetch('https://shop.example/public', request)).resolves.toMatchObject({ text: 'page' });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/robots.txt'))).toHaveLength(1);
  });

  describe('fixtures', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(path.join(os.tmpdir(), 'dealhound-'));
      vi.spyOn(process, 'cwd').mockReturnValue(dir);
    });
    afterEach(async () => {
      vi.restoreAllMocks();
      await rm(dir, { recursive: true, force: true });
    });

    it('records a live response, then replays it with no network', async () => {
      vi.stubEnv('RECORD_FIXTURES', '1');
      mockFetch(() => new Response('{"live":true}'));
      await politeFetch('https://api.example/search', { source: 'rec', fixture: 'search.json', signal: signal() });

      vi.stubEnv('RECORD_FIXTURES', '');
      vi.stubEnv('USE_FIXTURES', '1');
      const fetchMock = mockFetch(() => new Response('network!'));
      const replay = await politeFetch('https://api.example/other', { source: 'rec', fixture: 'search.json', signal: signal() });

      expect(replay.text).toBe('{"live":true}');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('explains how to get a fixture that is missing', async () => {
      vi.stubEnv('USE_FIXTURES', '1');
      await expect(
        politeFetch('https://api.example/', { source: 'none', fixture: 'search.json', signal: signal() }),
      ).rejects.toThrow(/RECORD_FIXTURES=1/);
    });
  });
});

describe('robots.txt rules', () => {
  const groups = parseRobots(`
# comments and blank lines are ignored

User-agent: *
Disallow: /shop/bag
Disallow: /*?filter=
Allow: /shop/bag/help

User-agent: BadBot
User-agent: dealhound
Disallow: /refurbished$
`);

  it('applies the longest matching rule, with Allow winning ties', () => {
    const everyone = groups.filter((group) => group.agents.includes('*'));
    expect(isAllowedByRobots(everyone, '/shop/bag/checkout', 'somebot')).toBe(false);
    expect(isAllowedByRobots(everyone, '/shop/bag/help', 'somebot')).toBe(true);
    expect(isAllowedByRobots(everyone, '/shop/refurbished', 'somebot')).toBe(true);
  });

  it('supports * wildcards and $ anchors', () => {
    expect(isAllowedByRobots(groups, '/mac?filter=m4', 'somebot')).toBe(false);
    expect(isAllowedByRobots(groups, '/refurbished', 'dealhound')).toBe(false);
    expect(isAllowedByRobots(groups, '/refurbished/mac', 'dealhound')).toBe(true);
  });

  it('uses the group naming us instead of the * group', () => {
    // Our group has no /shop/bag rule, so the * group's rule does not apply to us.
    expect(isAllowedByRobots(groups, '/shop/bag', 'dealhound')).toBe(true);
    expect(isAllowedByRobots(groups, '/shop/bag', 'otherbot')).toBe(false);
  });

  it('allows everything when there are no rules', () => {
    expect(isAllowedByRobots([], '/anything', 'dealhound')).toBe(true);
  });
});
