const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const LIMIT = 252; // 7 * 36 — the largest multiple of 36 that fits in a byte

/** 8 chars of [0-9a-z]. Ids are opaque; nothing may parse meaning out of one. */
export function newId(length = 8): string {
  const buf = new Uint8Array(length);
  let out = '';
  while (out.length < length) {
    crypto.getRandomValues(buf);
    for (const byte of buf) {
      if (byte >= LIMIT) continue; // reject the short tail so every glyph is equally likely
      out += ALPHABET.charAt(byte % 36);
      if (out.length === length) break;
    }
  }
  return out;
}

/**
 * An id not already in `existing`. The new id is added to the set, so a loop that
 * mints many ids in one pass stays collision-free without the caller bookkeeping.
 */
export function uniqueId(existing: Set<string>, length = 8): string {
  let id = newId(length);
  while (existing.has(id)) id = newId(length);
  existing.add(id);
  return id;
}
