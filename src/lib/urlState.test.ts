import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RoundConfig } from '../domain/config';
import { canonicalJson } from '../domain/config';
import { configHash } from './hash';
import { migrate } from '../domain/migrate';
import { PRESETS, PRESET_KEYS, instantiatePreset } from '../domain/presets';
import type { PresetKey } from '../domain/presets';
import {
  LINK_BUDGET,
  SHARE_ROUTE,
  buildShareLink,
  decodeShare,
  deflateRaw,
  encodeShare,
  encodeSharePlain,
  fromBase64Url,
  inflateRaw,
  isSelfWritten,
  parseShareToken,
  shareHash,
  shareHashPlain,
  shareUrl,
  subscribeHash,
  supportsCompression,
  toBase64Url,
  tokenFromHash,
  tryDecodeShare,
  writeHash,
} from './urlState';

/** Re-serialise with every object's keys in the opposite order, at every depth. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).reverse()) out[key] = reverseKeys(src[key]);
    return out;
  }
  return value;
}

function shuffled(config: RoundConfig): RoundConfig {
  return reverseKeys(JSON.parse(JSON.stringify(config))) as RoundConfig;
}

/** One turn of the task queue. Not a sleep — the timeout is zero and never grows. */
function macrotask(): Promise<void> {
  const immediate = (globalThis as { setImmediate?: (fn: () => void) => void }).setImmediate;
  return new Promise<void>((resolve) => {
    if (immediate) immediate(() => resolve());
    else setTimeout(() => resolve(), 0);
  });
}

describe('canonical JSON is key-order stable', () => {
  it.each(PRESET_KEYS)('%s hashes identically however its keys are ordered', (key: PresetKey) => {
    const config = PRESETS[key];
    const flipped = shuffled(config);
    expect(JSON.stringify(flipped)).not.toBe(JSON.stringify(config));
    expect(canonicalJson(flipped)).toBe(canonicalJson(config));
    expect(configHash(flipped)).toBe(configHash(config));
  });

  it('produces byte-identical share payloads from differently-ordered inputs', () => {
    const config = PRESETS.chinese4v4;
    expect(encodeSharePlain(shuffled(config))).toBe(encodeSharePlain(config));
  });

  it('sorts keys and drops undefined without whitespace', () => {
    expect(canonicalJson({ b: 1, a: 2, c: undefined })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ z: { y: 1, x: 2 } })).toBe('{"z":{"x":2,"y":1}}');
    // Array order is data, never sorted.
    expect(canonicalJson({ a: [3, 1, 2] })).toBe('{"a":[3,1,2]}');
  });

  it('does not collapse a CJK label onto its ASCII shadow', () => {
    expect(configHash({ t: '正方' })).not.toBe(configHash({ t: '反方' }));
    expect(configHash({ t: '正一' })).not.toBe(configHash({ t: '正二' }));
  });
});

describe('round-trip through both codecs', () => {
  it('supports compression in this environment', () => {
    expect(supportsCompression()).toBe(true);
  });

  it.each(PRESET_KEYS)('%s survives codec 0 unchanged', async (key: PresetKey) => {
    const config = PRESETS[key];
    const token = encodeSharePlain(config);
    expect(token.startsWith('0.')).toBe(true);
    expect(canonicalJson(await decodeShare(token))).toBe(canonicalJson(config));
  });

  it.each(PRESET_KEYS)('%s survives codec 1 unchanged', async (key: PresetKey) => {
    const config = PRESETS[key];
    const token = await encodeShare(config);
    expect(token.startsWith('1.')).toBe(true);
    expect(canonicalJson(await decodeShare(token))).toBe(canonicalJson(config));
  });

  it.each(PRESET_KEYS)('%s decodes to the same config from either codec', async (key: PresetKey) => {
    const config = PRESETS[key];
    const viaPlain = await decodeShare(encodeSharePlain(config));
    const viaDeflate = await decodeShare(await encodeShare(config));
    expect(canonicalJson(viaDeflate)).toBe(canonicalJson(viaPlain));
    expect(configHash(viaDeflate)).toBe(configHash(config));
  });

  it('compresses well below the plain form', async () => {
    for (const key of PRESET_KEYS) {
      const deflated = await encodeShare(PRESETS[key]);
      const plain = encodeSharePlain(PRESETS[key]);
      expect(deflated.length).toBeLessThan(plain.length);
    }
  });

  it('keeps Chinese labels byte-exact through the whole pipeline', async () => {
    const decoded = (await decodeShare(await encodeShare(PRESETS.chinese4v4))) as RoundConfig;
    expect(decoded.title.zh).toBe('华语辩论赛');
    expect(decoded.speakers.map((s) => s.name)).toEqual([
      '正一',
      '正二',
      '正三',
      '正四',
      '反一',
      '反二',
      '反三',
      '反四',
    ]);
  });

  it('round-trips a freshly instantiated round, ids and all', async () => {
    const instance = instantiatePreset('chinese4v4');
    expect(canonicalJson(await decodeShare(await encodeShare(instance)))).toBe(
      canonicalJson(instance),
    );
  });

  it('hands the decoder output to migrate unchanged', async () => {
    const config = PRESETS.policy;
    const result = migrate(await decodeShare(await encodeShare(config)));
    expect(result.source).toBe('v3');
    expect(result.config).not.toBeNull();
    if (result.config) expect(canonicalJson(result.config)).toBe(canonicalJson(config));
  });
});

describe('base64url', () => {
  it('never emits a character that needs escaping in a URL', () => {
    const bytes = new Uint8Array(768);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) % 256;
    const text = toBase64Url(bytes);
    expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
    expect(text).not.toContain('=');
  });

  it('round-trips every byte value', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect([...fromBase64Url(toBase64Url(bytes))]).toEqual([...bytes]);
  });

  it('round-trips each of the three padding remainders', () => {
    for (const length of [1, 2, 3, 4, 5]) {
      const bytes = Uint8Array.from({ length }, (_, i) => 200 + i);
      expect([...fromBase64Url(toBase64Url(bytes))]).toEqual([...bytes]);
    }
    expect(toBase64Url(new Uint8Array(0))).toBe('');
    expect(fromBase64Url('')).toHaveLength(0);
  });

  it('deflates and inflates arbitrary bytes', async () => {
    const bytes = new TextEncoder().encode('正方'.repeat(400));
    const packed = await deflateRaw(bytes);
    expect(packed.length).toBeLessThan(bytes.length);
    expect([...(await inflateRaw(packed))]).toEqual([...bytes]);
  });
});

describe('token and route parsing', () => {
  it('accepts exactly a one-character codec followed by a dot', () => {
    expect(parseShareToken('0.abc')).toEqual({ codec: '0', payload: 'abc' });
    expect(parseShareToken('1.abc')).toEqual({ codec: '1', payload: 'abc' });
    expect(parseShareToken('0.')).toEqual({ codec: '0', payload: '' });
  });

  it('rejects anything else without throwing', () => {
    for (const token of ['', 'abc', '2.abc', 'x.abc', '.abc', '01.abc', '0abc', '.']) {
      expect(parseShareToken(token)).toBeNull();
    }
  });

  it('pulls a token out of a share route only', () => {
    expect(tokenFromHash('#/r/0.abc')).toBe('0.abc');
    expect(tokenFromHash('#/console')).toBeNull();
    expect(tokenFromHash('#/summary')).toBeNull();
    expect(tokenFromHash('')).toBeNull();
    expect(tokenFromHash('#/r/nope')).toBeNull();
  });

  it('builds the route from the config', async () => {
    const hash = await shareHash(PRESETS.ld);
    expect(hash.startsWith(`${SHARE_ROUTE}1.`)).toBe(true);
    expect(shareHashPlain(PRESETS.ld).startsWith(`${SHARE_ROUTE}0.`)).toBe(true);
    const token = tokenFromHash(hash);
    expect(token).not.toBeNull();
    if (token) expect(canonicalJson(await decodeShare(token))).toBe(canonicalJson(PRESETS.ld));
  });

  it('never rejects into a blank screen', async () => {
    expect(await tryDecodeShare('not a token')).toEqual({ ok: false, error: 'Not a share payload' });
    const garbage = await tryDecodeShare('1.AAAAAAAA');
    expect(garbage.ok).toBe(false);
    const notJson = await tryDecodeShare(`0.${toBase64Url(new TextEncoder().encode('{oops'))}`);
    expect(notJson.ok).toBe(false);
    await expect(decodeShare('nope')).rejects.toThrow('Not a share payload');
  });

  it('leaks no unhandled rejection when a payload is corrupt', async () => {
    // The writer promises inside the compression pipe settle independently of the
    // read the caller awaits. Left unhandled they reach the page as an
    // `unhandledrejection` even though `tryDecodeShare` returned cleanly.
    const leaked: unknown[] = [];
    const onLeak = (reason: unknown): void => {
      leaked.push(reason);
    };
    const host = globalThis as {
      process?: {
        on(event: 'unhandledRejection', fn: (reason: unknown) => void): void;
        off(event: 'unhandledRejection', fn: (reason: unknown) => void): void;
      };
    };
    host.process?.on('unhandledRejection', onLeak);
    try {
      expect((await tryDecodeShare('1.AAAAAAAAAAAA')).ok).toBe(false);
      expect((await tryDecodeShare(`1.${toBase64Url(new Uint8Array([1, 2, 3, 4, 5]))}`)).ok).toBe(
        false,
      );
      // The runner reports an unhandled rejection at the end of the tick, so two
      // macrotask turns is enough — nothing here waits on a clock.
      await macrotask();
      await macrotask();
    } finally {
      host.process?.off('unhandledRejection', onLeak);
    }
    expect(leaked).toEqual([]);
  });

  it('reports ok with the raw parse for a good token', async () => {
    const outcome = await tryDecodeShare(encodeSharePlain(PRESETS.blank));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(canonicalJson(outcome.raw)).toBe(canonicalJson(PRESETS.blank));
  });
});

describe('codec 0 fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back when the engine has no CompressionStream', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    expect(supportsCompression()).toBe(false);
    const token = await encodeShare(PRESETS.wsdc);
    expect(token.startsWith('0.')).toBe(true);
  });

  it('falls back when the engine has no DecompressionStream either', async () => {
    vi.stubGlobal('DecompressionStream', undefined);
    expect(supportsCompression()).toBe(false);
    expect((await encodeShare(PRESETS.wsdc)).startsWith('0.')).toBe(true);
  });

  it('falls back when compression throws rather than failing the share', async () => {
    vi.stubGlobal(
      'CompressionStream',
      class {
        constructor() {
          throw new Error('nope');
        }
      },
    );
    const token = await encodeShare(PRESETS.pf);
    expect(token.startsWith('0.')).toBe(true);
    // And a real decoder still reads it.
    vi.unstubAllGlobals();
    expect(canonicalJson(await decodeShare(token))).toBe(canonicalJson(PRESETS.pf));
  });

  it('a link written by a plain engine still opens on a modern one', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    const token = await encodeShare(PRESETS.bp);
    vi.unstubAllGlobals();
    expect(canonicalJson(await decodeShare(token))).toBe(canonicalJson(PRESETS.bp));
  });
});

describe('share links', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports the real URL length and stays inside the budget when deflated', async () => {
    for (const key of PRESET_KEYS) {
      const link = await buildShareLink(PRESETS[key]);
      expect(link.url).toContain(link.hash);
      expect(link.length).toBe(link.url.length);
      expect(link.overBudget).toBe(false);
      expect(link.length).toBeLessThanOrEqual(LINK_BUDGET);
    }
  });

  it('reports overBudget so the sheet can promote DOWNLOAD', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    const link = await buildShareLink(PRESETS.bp);
    expect(link.length).toBeGreaterThan(LINK_BUDGET);
    expect(link.overBudget).toBe(true);
  });

  it('hangs the hash off an explicit base', () => {
    expect(shareUrl('#/r/0.abc', 'https://example.com/app/index.html?x=1')).toBe(
      'https://example.com/app/index.html?x=1#/r/0.abc',
    );
    expect(shareUrl('#/console', 'https://example.com/app/#/r/0.old')).toBe(
      'https://example.com/app/#/console',
    );
  });
});

describe('the self-write guard', () => {
  beforeEach(() => {
    history.replaceState(null, '', location.pathname + location.search);
  });

  it('writes a hash and remembers that it did', () => {
    expect(writeHash('#/r/0.first')).toBe(true);
    expect(location.hash).toBe('#/r/0.first');
    expect(isSelfWritten('#/r/0.first')).toBe(true);
    expect(isSelfWritten('#/r/0.other')).toBe(false);
  });

  it('skips a write that would change nothing', () => {
    writeHash('#/r/0.same');
    expect(writeHash('#/r/0.same')).toBe(false);
    expect(location.hash).toBe('#/r/0.same');
  });

  it('pushes a history entry only when asked', () => {
    const before = history.length;
    writeHash('#/console', 'replace');
    expect(history.length).toBe(before);
    writeHash('#/summary', 'push');
    expect(history.length).toBe(before + 1);
  });

  it('does not preserve a foreign query string change, only the hash', () => {
    writeHash('#/r/0.abc');
    expect(location.hash).toBe('#/r/0.abc');
    expect(location.pathname).toBe('/');
  });

  it('ignores the hashchange its own write provoked, and reports a real one', () => {
    const seen: string[] = [];
    const stop = subscribeHash((hash) => seen.push(hash));

    writeHash('#/r/0.mine');
    dispatchEvent(new Event('hashchange'));
    expect(seen).toEqual([]);

    history.replaceState(null, '', `${location.pathname}#/r/0.theirs`);
    dispatchEvent(new Event('hashchange'));
    expect(seen).toEqual(['#/r/0.theirs']);

    stop();
    history.replaceState(null, '', `${location.pathname}#/r/0.after`);
    dispatchEvent(new Event('hashchange'));
    expect(seen).toEqual(['#/r/0.theirs']);
  });
});

describe('the whole boot path', () => {
  it('config → link → hash → token → decode → migrate → same config', async () => {
    const original = instantiatePreset('chinese4v4');
    const link = await buildShareLink(original);

    const token = tokenFromHash(new URL(link.url).hash);
    expect(token).not.toBeNull();
    if (!token) return;

    const outcome = await tryDecodeShare(token);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const result = migrate(outcome.raw);
    expect(result.source).toBe('v3');
    expect(result.config).not.toBeNull();
    if (result.config) {
      expect(canonicalJson(result.config)).toBe(canonicalJson(original));
      expect(configHash(result.config)).toBe(configHash(original));
    }
  });
});
