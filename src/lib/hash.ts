import { canonicalJson } from '../domain/config';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a over UTF-16 code units, both bytes of each. Hashing only the low byte
 * would collapse every CJK label onto its ASCII shadow.
 */
function lane(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h = Math.imul(h ^ (c & 0xff), FNV_PRIME);
    h = Math.imul(h ^ (c >>> 8), FNV_PRIME);
  }
  return h >>> 0;
}

/** 32-bit FNV-1a. */
export function fnv1a(text: string): number {
  return lane(text, FNV_OFFSET);
}

function hex8(n: number): string {
  return (n >>> 0).toString(16).padStart(8, '0');
}

/**
 * 16 hex chars. Two independently seeded 32-bit lanes, because this value is a round's
 * identity — a chance collision would silently treat two different rounds as one.
 */
export function fnv1aHex(text: string): string {
  return hex8(lane(text, FNV_OFFSET)) + hex8(lane(text, FNV_PRIME));
}

/** Identity of a config independent of key order or whitespace. */
export function configHash(config: unknown): string {
  return fnv1aHex(canonicalJson(config));
}
