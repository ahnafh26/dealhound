import 'server-only';

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sleep } from './async';
import { POLITENESS } from './config';
import { isEnabled, readEnv } from './env';

/**
 * Every request a source adapter makes goes through politeFetch. It spaces
 * requests to each host, backs off from a site that refuses us, checks
 * robots.txt where asked, and records or replays responses as fixtures.
 */

/**
 * `dealhound` announces itself with DEALHOUND_USER_AGENT. `browser` looks
 * like desktop Chrome, for the sites read the way carbuyer reads them (see
 * the README): they answer anything else with an error or a block page.
 */
export type Identity = 'dealhound' | 'browser';

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const BROWSER_HEADERS: Record<string, string> = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-CA,en;q=0.9,fr-CA;q=0.8',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
};

export interface PoliteRequest {
  /** Adapter id. Names the fixture folder and whose back-off applies. */
  source: string;
  /** File under fixtures/<source>/ that records and replays this request. */
  fixture: string;
  signal: AbortSignal;
  identity?: Identity;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: string;
  /** Check the host's robots.txt first. For pages, not APIs. */
  robots?: boolean;
  /** Overrides the minimum gap between requests to this host. */
  minIntervalMs?: number;
}

export interface PoliteResponse {
  status: number;
  ok: boolean;
  text: string;
}

/** The site refused us, or did recently: a signal to back off, never to retry harder. */
export class BlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedError';
  }
}

export class RobotsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RobotsError';
  }
}

interface HttpState {
  /** Per host: the earliest time the next request may start. */
  nextSlot: Map<string, number>;
  /** Per source: back off until this time. */
  blockedUntil: Map<string, number>;
  robots: Map<string, { groups: RobotsGroup[]; expires: number }>;
}

// On globalThis so dev-mode hot reloads keep the back-off and spacing state.
const globalForHttp = globalThis as typeof globalThis & { __dealhoundHttp?: HttpState };
function state(): HttpState {
  globalForHttp.__dealhoundHttp ??= { nextSlot: new Map(), blockedUntil: new Map(), robots: new Map() };
  return globalForHttp.__dealhoundHttp;
}

export function dealhoundUserAgent(): string {
  return readEnv('DEALHOUND_USER_AGENT') ?? 'DealHound/0.1 (personal price comparison)';
}

export function useFixtures(): boolean {
  return isEnabled('USE_FIXTURES');
}

export async function politeFetch(url: string, request: PoliteRequest): Promise<PoliteResponse> {
  if (useFixtures()) {
    return { status: 200, ok: true, text: await readFixture(request.source, request.fixture) };
  }

  const blockedUntil = state().blockedUntil.get(request.source) ?? 0;
  if (blockedUntil > Date.now()) {
    const minutes = Math.ceil((blockedUntil - Date.now()) / 60_000);
    throw new BlockedError(`Refused recently; resting for ${minutes} more min`);
  }

  const target = new URL(url);
  const identity = request.identity ?? 'dealhound';
  const userAgent = identity === 'browser' ? BROWSER_USER_AGENT : dealhoundUserAgent();

  if (request.robots && !(await robotsAllows(target, request.signal))) {
    throw new RobotsError(`robots.txt asks crawlers to stay out of ${target.pathname}`);
  }

  await waitForTurn(target.host, request.minIntervalMs ?? POLITENESS.minIntervalMs[identity], request.signal);

  const response = await fetch(url, {
    method: request.method ?? 'GET',
    headers: { ...(identity === 'browser' ? BROWSER_HEADERS : {}), 'user-agent': userAgent, ...request.headers },
    body: request.body,
    signal: request.signal,
    redirect: 'follow',
  });
  const text = await response.text();

  if (response.status === 403 || response.status === 429) {
    throw reportBlocked(request.source, `HTTP ${response.status}`);
  }
  if (response.ok && isEnabled('RECORD_FIXTURES')) {
    await recordFixture(request.source, request.fixture, text);
  }
  return { status: response.status, ok: response.ok, text };
}

/** For refusals only the body shows, like a login wall: back off like a 403. */
export function reportBlocked(source: string, reason: string): BlockedError {
  state().blockedUntil.set(source, Date.now() + POLITENESS.blockCooldownMs);
  return new BlockedError(`${reason}; leaving this source alone for ${POLITENESS.blockCooldownMs / 60_000} min`);
}

/** Forgets back-off and spacing state. For tests. */
export function resetHttpState(): void {
  globalForHttp.__dealhoundHttp = undefined;
}

// Reserves a slot synchronously, so concurrent requests to one host queue up.
async function waitForTurn(host: string, intervalMs: number, signal: AbortSignal): Promise<void> {
  const slots = state().nextSlot;
  const now = Date.now();
  const start = Math.max(now, slots.get(host) ?? 0);
  slots.set(host, start + intervalMs);
  if (start > now) await sleep(start - now, signal);
}

// ─── Fixtures ────────────────────────────────────────────────────────────

function fixturePath(source: string, name: string): string {
  return path.join(process.cwd(), 'fixtures', source, name);
}

async function readFixture(source: string, name: string): Promise<string> {
  try {
    return await readFile(fixturePath(source, name), 'utf8');
  } catch {
    throw new Error(`No fixture at fixtures/${source}/${name}. Record one with RECORD_FIXTURES=1.`);
  }
}

async function recordFixture(source: string, name: string, text: string): Promise<void> {
  const file = fixturePath(source, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

// ─── robots.txt ──────────────────────────────────────────────────────────

export interface RobotsGroup {
  agents: string[];
  rules: { allow: boolean; pattern: string }[];
}

const ROBOTS_TOKEN = 'dealhound';
const DISALLOW_ALL: RobotsGroup[] = [{ agents: ['*'], rules: [{ allow: false, pattern: '/' }] }];

async function robotsAllows(url: URL, signal: AbortSignal): Promise<boolean> {
  const cache = state().robots;
  let entry = cache.get(url.origin);
  if (!entry || entry.expires < Date.now()) {
    let groups: RobotsGroup[];
    try {
      const response = await fetch(`${url.origin}/robots.txt`, {
        headers: { 'user-agent': dealhoundUserAgent() },
        signal,
      });
      // RFC 9309: a missing robots.txt allows everything; a server error means stay out for now.
      groups = response.ok ? parseRobots(await response.text()) : response.status < 500 ? [] : DISALLOW_ALL;
    } catch (err) {
      if (signal.aborted) throw err;
      groups = DISALLOW_ALL;
    }
    entry = { groups, expires: Date.now() + POLITENESS.robotsCacheMs };
    cache.set(url.origin, entry);
  }
  return isAllowedByRobots(entry.groups, url.pathname + url.search, ROBOTS_TOKEN);
}

export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let collectingAgents = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === 'user-agent') {
      // Consecutive user-agent lines share one group of rules.
      if (!current || !collectingAgents) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      collectingAgents = true;
    } else if (field === 'allow' || field === 'disallow') {
      // An empty Disallow allows everything, so it adds no rule.
      if (current && value) current.rules.push({ allow: field === 'allow', pattern: value });
      collectingAgents = false;
    } else {
      collectingAgents = false;
    }
  }
  return groups;
}

/** The longest matching rule wins; on a tie, Allow wins. No matching rule means allowed. */
export function isAllowedByRobots(groups: RobotsGroup[], pathAndQuery: string, token: string): boolean {
  const ours = groups.filter((group) => group.agents.some((agent) => agent !== '*' && token.includes(agent)));
  const applicable = ours.length > 0 ? ours : groups.filter((group) => group.agents.includes('*'));

  let best: { allow: boolean; length: number } | null = null;
  for (const rule of applicable.flatMap((group) => group.rules)) {
    if (!robotsPatternMatches(rule.pattern, pathAndQuery)) continue;
    if (!best || rule.pattern.length > best.length || (rule.pattern.length === best.length && rule.allow)) {
      best = { allow: rule.allow, length: rule.pattern.length };
    }
  }
  return best?.allow ?? true;
}

function robotsPatternMatches(pattern: string, pathAndQuery: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}${anchored ? '$' : ''}`).test(pathAndQuery);
}
