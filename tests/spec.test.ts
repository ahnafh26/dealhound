import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryCache } from '@/lib/cache';
import type { CompleteJsonRequest, LlmClient } from '@/lib/llm';
import { parseQuery } from '@/lib/spec';

/** A stand-in LLM that answers with `reply` and records what it was asked. */
function fakeLlm(reply: unknown | (() => Promise<unknown>)): LlmClient & { calls: CompleteJsonRequest<unknown>[] } {
  const calls: CompleteJsonRequest<unknown>[] = [];
  return {
    label: 'fake/model',
    calls,
    async completeJson<T>(request: CompleteJsonRequest<T>): Promise<T> {
      calls.push(request as CompleteJsonRequest<unknown>);
      const value = typeof reply === 'function' ? await (reply as () => Promise<unknown>)() : reply;
      return request.validate.parse(value);
    },
  };
}

const switchSpec = {
  spec: {
    category: 'game console',
    brand: 'Nintendo',
    model: 'Switch 2',
    variant: null,
    required: [{ name: 'Storage', value: '256 gb' }],
    optional: [],
    searchQuery: '  Nintendo   Switch 2 ',
  },
  question: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseQuery', () => {
  it('answers from rules for known families, without calling the LLM', async () => {
    const llm = fakeLlm(switchSpec);
    const result = await parseQuery('M4 MacBook Air 16GB', { llm, cache: new MemoryCache() });
    expect(result).toMatchObject({ kind: 'spec', spec: { model: 'MacBook Air', parsedBy: 'rules' } });
    expect(llm.calls).toHaveLength(0);
  });

  it('asks the rules question for a known ambiguity, and skips it on request', async () => {
    const llm = fakeLlm(switchSpec);
    expect((await parseQuery('Sony XM5', { llm })).kind).toBe('clarify');
    expect(await parseQuery('Sony XM5', { llm, allowClarify: false })).toMatchObject({
      kind: 'spec',
      spec: { brand: 'Sony', searchQuery: 'Sony 1000XM5' },
    });
    expect(llm.calls).toHaveLength(0);
  });

  it('sends unknown products to the LLM and normalizes its answer', async () => {
    const llm = fakeLlm(switchSpec);
    const result = await parseQuery('cheap switch 2', { llm, cache: new MemoryCache() });
    expect(result).toEqual({
      kind: 'spec',
      spec: {
        query: 'cheap switch 2',
        searchQuery: 'Nintendo Switch 2',
        category: 'game console',
        brand: 'Nintendo',
        model: 'Switch 2',
        variant: null,
        required: { storage: '256GB' },
        optional: {},
        parsedBy: 'llm',
      },
    });
    expect(llm.calls[0].user).toBe('cheap switch 2');
  });

  it('caches the LLM reading of a query', async () => {
    const llm = fakeLlm(switchSpec);
    const cache = new MemoryCache();
    await parseQuery('switch 2', { llm, cache });
    await parseQuery('Switch  2', { llm, cache });
    expect(llm.calls).toHaveLength(1);
  });

  it('passes on a clarifying question from the LLM, but only a usable one', async () => {
    const ask = (options: { label: string; query: string }[]) =>
      fakeLlm({ ...switchSpec, question: { attribute: 'Model', question: 'Which one?', options } });

    const good = await parseQuery('galaxy s25', {
      llm: ask([
        { label: 'Galaxy S25', query: 'Samsung Galaxy S25' },
        { label: 'Galaxy S25 Ultra', query: 'Samsung Galaxy S25 Ultra' },
      ]),
      cache: new MemoryCache(),
    });
    expect(good).toMatchObject({ kind: 'clarify', question: { attribute: 'model', question: 'Which one?' } });

    // One distinct option is no choice at all: fall back to the spec.
    const useless = await parseQuery('galaxy s25', {
      llm: ask([
        { label: 'Galaxy S25', query: 'galaxy s25' },
        { label: 'Galaxy S25 again', query: 'Samsung Galaxy S25' },
      ]),
      cache: new MemoryCache(),
    });
    expect(useless.kind).toBe('spec');
  });

  it('falls back to the rules reading when the LLM fails, and tries again next time', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const llm = fakeLlm(async () => {
      throw new Error('HTTP 503');
    });
    const cache = new MemoryCache();

    const result = await parseQuery('used Dell XPS 13 16GB', { llm, cache });
    expect(result).toMatchObject({ kind: 'spec', spec: { brand: 'Dell', parsedBy: 'rules' } });

    await parseQuery('used Dell XPS 13 16GB', { llm, cache });
    expect(llm.calls).toHaveLength(2);
  });

  it('falls back when the LLM answers outside the schema', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await parseQuery('steam deck oled', { llm: fakeLlm({ nonsense: true }), cache: new MemoryCache() });
    expect(result).toMatchObject({ kind: 'spec', spec: { parsedBy: 'rules', searchQuery: 'steam deck oled' } });
  });

  it('uses rules alone when no LLM is configured', async () => {
    const result = await parseQuery('Nintendo Switch 2 under $500', { llm: null });
    expect(result).toMatchObject({ kind: 'spec', spec: { brand: 'Nintendo', searchQuery: 'Nintendo Switch 2' } });
  });
});
