import 'server-only';

import { FALLBACK_REGION } from './config';
import { isRegionCode } from './region';
import type { RegionCode } from './types';

/**
 * Server-side settings from environment variables. `server-only` makes any
 * attempt to import this from a client component a build error, so API keys
 * can't end up in the browser bundle.
 */

export function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function missingEnv(names: readonly string[]): string[] {
  return names.filter((name) => !readEnv(name));
}

export function defaultRegion(): RegionCode {
  const value = readEnv('DEFAULT_REGION')?.toUpperCase();
  return isRegionCode(value) ? value : FALLBACK_REGION;
}

export function defaultPostalCode(): string | undefined {
  return readEnv('DEFAULT_POSTAL_CODE');
}

export type DemoMode = 'auto' | 'on' | 'off';

/** auto (default): demo sources run only while no real source is configured. */
export function demoMode(): DemoMode {
  const value = readEnv('DEMO_MODE')?.toLowerCase();
  return value === 'on' || value === 'off' ? value : 'auto';
}

/** DEMO_SIMULATE_FAILURES="demo-local:timeout,demo-refurb:error" makes those demo sources misbehave. */
export function simulatedFailure(sourceId: string): 'error' | 'timeout' | undefined {
  for (const entry of (readEnv('DEMO_SIMULATE_FAILURES') ?? '').split(',')) {
    const [id, kind] = entry.split(':').map((part) => part.trim());
    if (id === sourceId) return kind === 'timeout' ? 'timeout' : 'error';
  }
  return undefined;
}
