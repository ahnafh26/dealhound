import 'server-only';

import type { ZodType } from 'zod';
import { readEnv } from './env';

/**
 * The smallest useful LLM client: one JSON-only chat completion against any
 * OpenAI-compatible endpoint. Speaking that one dialect means switching to
 * whichever provider is cheapest is an env change, not a code change.
 */

export type LlmProvider = 'openai' | 'gemini' | 'custom';

export interface LlmConfig {
  provider: LlmProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Provider-specific request fields, e.g. reasoning_effort. */
  extra: Record<string, unknown>;
}

interface Preset {
  baseUrl: string;
  model: string;
  keyEnv: string;
  /** Only sent with the preset's own model; another model may reject them. */
  extra: Record<string, unknown>;
}

// The cheapest model with structured outputs at each provider (September 2026, per 1M tokens in / out).
const PRESETS: Record<Exclude<LlmProvider, 'custom'>, Preset> = {
  // $0.05 / $0.40. Minimal reasoning keeps hidden reasoning tokens, billed as output, near zero.
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5-nano',
    keyEnv: 'OPENAI_API_KEY',
    extra: { reasoning_effort: 'minimal' },
  },
  // Free tier with daily limits, then $0.10 / $0.40. "none" switches thinking off on 2.5 models.
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash-lite',
    keyEnv: 'GEMINI_API_KEY',
    extra: { reasoning_effort: 'none' },
  },
};

/** LLM settings from env, or null when none is usable: callers then fall back to rules. */
export function llmConfig(): LlmConfig | null {
  const provider = (readEnv('LLM_PROVIDER') ?? 'openai').toLowerCase();
  const effort = readEnv('LLM_REASONING_EFFORT');
  const effortOverride = effort ? { reasoning_effort: effort } : {};

  if (provider === 'custom') {
    const baseUrl = readEnv('LLM_BASE_URL');
    const model = readEnv('LLM_MODEL');
    const apiKey = readEnv('LLM_API_KEY');
    if (!baseUrl || !model || !apiKey) return null;
    return { provider, baseUrl: withoutTrailingSlash(baseUrl), model, apiKey, extra: effortOverride };
  }
  if (provider !== 'openai' && provider !== 'gemini') return null;

  const preset = PRESETS[provider];
  const apiKey = readEnv(preset.keyEnv);
  if (!apiKey) return null;
  const model = readEnv('LLM_MODEL') ?? preset.model;
  return {
    provider,
    baseUrl: withoutTrailingSlash(readEnv('LLM_BASE_URL') ?? preset.baseUrl),
    model,
    apiKey,
    extra: model === preset.model ? { ...preset.extra, ...effortOverride } : effortOverride,
  };
}

export interface JsonSchemaFormat {
  /** Short identifier sent to the provider, e.g. `product_spec`. */
  name: string;
  /** JSON Schema in the strict subset: every object closed, every property required. */
  schema: Record<string, unknown>;
}

export interface CompleteJsonRequest<T> {
  system: string;
  user: string;
  format: JsonSchemaFormat;
  /** Checks the parsed JSON; a response that fails is an error, never passed on. */
  validate: ZodType<T>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface LlmClient {
  /** e.g. `openai/gpt-5-nano`, for logs and cache keys. */
  readonly label: string;
  completeJson<T>(request: CompleteJsonRequest<T>): Promise<T>;
}

export class LlmError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
  }
}

interface ChatCompletion {
  choices?: { message?: { content?: string | null; refusal?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

export function createLlmClient(config: LlmConfig, fetchImpl: typeof fetch = fetch): LlmClient {
  const label = `${config.provider}/${config.model}`;

  return {
    label,
    async completeJson<T>({ system, user, format, validate, signal, timeoutMs = 10_000 }: CompleteJsonRequest<T>) {
      const started = Date.now();
      const deadline = AbortSignal.timeout(timeoutMs);
      const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          response_format: { type: 'json_schema', json_schema: { name: format.name, strict: true, schema: format.schema } },
          ...config.extra,
        }),
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      });

      const body = (await response.json().catch(() => null)) as ChatCompletion | null;
      if (!response.ok) {
        const detail = body?.error?.message?.slice(0, 200) ?? 'no details';
        throw new LlmError(`${label} returned HTTP ${response.status}: ${detail}`, response.status);
      }

      const message = body?.choices?.[0]?.message;
      if (message?.refusal) throw new LlmError(`${label} declined: ${message.refusal.slice(0, 200)}`);
      if (!message?.content) throw new LlmError(`${label} returned no content`);

      let json: unknown;
      try {
        json = JSON.parse(message.content);
      } catch {
        throw new LlmError(`${label} returned invalid JSON`);
      }
      const checked = validate.safeParse(json);
      if (!checked.success) {
        throw new LlmError(`${label} returned JSON that doesn't fit the schema: ${checked.error.issues[0]?.message}`);
      }

      const usage = body?.usage;
      console.info(
        `[llm] ${label}: ${usage?.prompt_tokens ?? '?'} in / ${usage?.completion_tokens ?? '?'} out tokens, ${Date.now() - started} ms`,
      );
      return checked.data;
    },
  };
}

/** The client configured in env, or null to use rules only. */
export function defaultLlm(): LlmClient | null {
  const config = llmConfig();
  return config ? createLlmClient(config) : null;
}

function withoutTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
