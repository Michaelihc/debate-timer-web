/**
 * The config is the URL: `#/r/<codec>.<payload>`.
 *
 * Codec `1` is deflate-raw over canonical JSON; codec `0` is the same canonical JSON
 * uncompressed, for engines without `CompressionStream`. Both decode, always — the
 * decoder switches on the prefix, so a link made on one browser opens on the other.
 *
 * Hash, not query, because the host is static: the payload never reaches a server or
 * a log, and it sidesteps the SPA-404 rewrite problem entirely.
 */

import type { RoundConfig } from '../domain/config';
import { canonicalJson } from '../domain/config';

export const SHARE_ROUTE = '#/r/';
/** Above this, the share sheet makes DOWNLOAD the primary action and says why. */
export const LINK_BUDGET = 1800;

export type Codec = '0' | '1';

export interface ShareToken {
  codec: Codec;
  payload: string;
}

export function supportsCompression(): boolean {
  return (
    typeof globalThis.CompressionStream === 'function' &&
    typeof globalThis.DecompressionStream === 'function'
  );
}

// Base64url, chunked so a large payload never blows the argument limit.
const CHUNK = 0x8000;

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function pipeThrough(bytes: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // Not awaited: `write` only settles once the reader drains, which happens below.
  // The catches are load-bearing rather than decorative — a corrupt payload errors
  // the writable side too, and a rejection with no handler attached surfaces as an
  // `unhandledrejection` in the page even though the caller handled the read side.
  const ignore = (): undefined => undefined;
  writer.write(bytes).catch(ignore);
  writer.close().catch(ignore);
  const buffer = await new Response(stream.readable).arrayBuffer();
  return new Uint8Array(buffer);
}

export async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  return pipeThrough(bytes, new CompressionStream('deflate-raw'));
}

export async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  return pipeThrough(bytes, new DecompressionStream('deflate-raw'));
}

/** Codec `0`. Synchronous, and the guaranteed path on every engine. */
export function encodeSharePlain(config: RoundConfig): string {
  const bytes = new TextEncoder().encode(canonicalJson(config));
  return `0.${toBase64Url(bytes)}`;
}

/** `<codec>.<payload>`. Deflated when the engine can, plain when it cannot. */
export async function encodeShare(config: RoundConfig): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(config));
  if (!supportsCompression()) return `0.${toBase64Url(bytes)}`;
  try {
    return `1.${toBase64Url(await deflateRaw(bytes))}`;
  } catch {
    return `0.${toBase64Url(bytes)}`;
  }
}

export function parseShareToken(token: string): ShareToken | null {
  const dot = token.indexOf('.');
  if (dot !== 1) return null;
  const codec = token.slice(0, 1);
  if (codec !== '0' && codec !== '1') return null;
  return { codec, payload: token.slice(dot + 1) };
}

/**
 * Raw parsed JSON, not a `RoundConfig` — the caller runs it through `migrate` so a
 * link from an older schema is upgraded rather than trusted.
 */
export async function decodeShare(token: string): Promise<unknown> {
  const parsed = parseShareToken(token);
  if (!parsed) throw new Error('Not a share payload');
  const bytes = fromBase64Url(parsed.payload);
  const json = new TextDecoder().decode(parsed.codec === '1' ? await inflateRaw(bytes) : bytes);
  return JSON.parse(json);
}

export type DecodeOutcome =
  | { ok: true; raw: unknown }
  | { ok: false; error: string };

/** The boot path: a bad link shows a message, it never rejects into a blank screen. */
export async function tryDecodeShare(token: string): Promise<DecodeOutcome> {
  try {
    return { ok: true, raw: await decodeShare(token) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function shareHash(config: RoundConfig): Promise<string> {
  return SHARE_ROUTE + (await encodeShare(config));
}

export function shareHashPlain(config: RoundConfig): string {
  return SHARE_ROUTE + encodeSharePlain(config);
}

/** The token out of `#/r/<token>`, or `null` for any other route. */
export function tokenFromHash(hash: string): string | null {
  if (!hash.startsWith(SHARE_ROUTE)) return null;
  const token = hash.slice(SHARE_ROUTE.length);
  return parseShareToken(token) ? token : null;
}

export function shareUrl(hash: string, base: string = location.href): string {
  const url = new URL(base);
  url.hash = hash;
  return url.toString();
}

// The self-write guard. `replaceState` fires no `hashchange`, but a user edit racing
// a programmatic write still can, so every write we make is remembered and any
// `hashchange` that matches it is ignored.

let lastWritten: string | null = null;

export function isSelfWritten(hash: string): boolean {
  return lastWritten !== null && hash === lastWritten;
}

/** Skips a write that is already byte-identical to the current hash. */
export function writeHash(hash: string, mode: 'replace' | 'push' = 'replace'): boolean {
  if (location.hash === hash) {
    lastWritten = hash;
    return false;
  }
  lastWritten = hash;
  const url = location.pathname + location.search + hash;
  // Explicit navigation pushes, so browser Back never eats an edit.
  if (mode === 'push') history.pushState(null, '', url);
  else history.replaceState(null, '', url);
  return true;
}

export function subscribeHash(onChange: (hash: string) => void): () => void {
  const handler = () => {
    const hash = location.hash;
    if (isSelfWritten(hash)) return;
    onChange(hash);
  };
  addEventListener('hashchange', handler);
  return () => removeEventListener('hashchange', handler);
}

export interface ShareLink {
  hash: string;
  url: string;
  length: number;
  overBudget: boolean;
}

export async function buildShareLink(config: RoundConfig): Promise<ShareLink> {
  const hash = await shareHash(config);
  const url = shareUrl(hash);
  return { hash, url, length: url.length, overBudget: url.length > LINK_BUDGET };
}
