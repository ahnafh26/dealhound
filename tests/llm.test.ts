import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createLlmClient, LlmError, llmConfig, type LlmConfig } from '@/lib/llm';

const config: LlmConfig = {
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1',
  model: 'gpt-5-nano',
  apiKey: 'sk-test',
  extra: { reasoning_effort: 'minimal' },
};

const Answer = z.object({ answer: z.string() });
const request = {
  system: 'Answer in JSON.',
  user: 'Say hi',
  format: { name: 'answer', schema: { type: 'object' } },
  validate: Answer,
};

function reply(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

function completion(content: string | null, refusal: string | null = null) {
  return { choices: [{ message: { content, refusal } }], usage: { prompt_tokens: 12, completion_tokens: 5 } };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('createLlmClient', () => {
  it('sends a strict JSON-schema chat completion with the provider extras', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const fetchMock = reply(completion('{"answer":"hi"}'));
    const client = createLlmClient(config, fetchMock);

    await expect(client.completeJson(request)).resolves.toEqual({ answer: 'hi' });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer sk-test');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: 'gpt-5-nano',
      reasoning_effort: 'minimal',
      response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true } },
    });
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user']);
  });

  it('reports HTTP errors with the provider message, not the key', async () => {
    const client = createLlmClient(config, reply({ error: { message: 'Incorrect API key' } }, 401));
    const error = await client.completeJson(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).status).toBe(401);
    expect((error as LlmError).message).toContain('Incorrect API key');
    expect((error as LlmError).message).not.toContain('sk-test');
  });

  it('rejects refusals, invalid JSON, and JSON outside the schema', async () => {
    for (const body of [completion(null, 'I cannot help'), completion('not json'), completion('{"wrong":1}')]) {
      const client = createLlmClient(config, reply(body));
      await expect(client.completeJson(request)).rejects.toBeInstanceOf(LlmError);
    }
  });

  it('gives up when the deadline passes', async () => {
    const hang = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const client = createLlmClient(config, hang as unknown as typeof fetch);
    await expect(client.completeJson({ ...request, timeoutMs: 20 })).rejects.toThrow();
  });
});

describe('llmConfig', () => {
  it('uses gpt-5-nano with minimal reasoning when only an OpenAI key is set', () => {
    vi.stubEnv('LLM_PROVIDER', '');
    vi.stubEnv('OPENAI_API_KEY', 'sk-live');
    expect(llmConfig()).toMatchObject({ provider: 'openai', model: 'gpt-5-nano', extra: { reasoning_effort: 'minimal' } });
  });

  it('switches to Gemini Flash-Lite with thinking off', () => {
    vi.stubEnv('LLM_PROVIDER', 'gemini');
    vi.stubEnv('GEMINI_API_KEY', 'g-key');
    expect(llmConfig()).toMatchObject({
      provider: 'gemini',
      model: 'gemini-2.5-flash-lite',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      extra: { reasoning_effort: 'none' },
    });
  });

  it('drops preset extras when the model is overridden', () => {
    vi.stubEnv('LLM_PROVIDER', 'openai');
    vi.stubEnv('OPENAI_API_KEY', 'sk-live');
    vi.stubEnv('LLM_MODEL', 'some-other-model');
    expect(llmConfig()?.extra).toEqual({});
  });

  it('is null without a key, for LLM_PROVIDER=none, or an unknown provider', () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    expect(llmConfig()).toBeNull();
    vi.stubEnv('OPENAI_API_KEY', 'sk-live');
    vi.stubEnv('LLM_PROVIDER', 'none');
    expect(llmConfig()).toBeNull();
    vi.stubEnv('LLM_PROVIDER', 'mystery');
    expect(llmConfig()).toBeNull();
  });

  it('supports any OpenAI-compatible endpoint as custom', () => {
    vi.stubEnv('LLM_PROVIDER', 'custom');
    vi.stubEnv('LLM_BASE_URL', 'http://localhost:11434/v1/');
    vi.stubEnv('LLM_MODEL', 'llama3.2');
    vi.stubEnv('LLM_API_KEY', 'ollama');
    expect(llmConfig()).toMatchObject({ provider: 'custom', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' });
  });
});
