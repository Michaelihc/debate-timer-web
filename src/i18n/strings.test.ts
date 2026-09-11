/**
 * The string table's own promises: both languages carry the same keys, and no visible copy
 * leans on a dash (an em dash, an en dash, or the Chinese double dash) to join its clauses.
 * Copy that needs a pause gets a comma, a full stop, or a rewrite.
 */

import { describe, expect, it } from 'vitest';
import { STRINGS } from './strings';

/**
 * Keys owned by the setup editor that still carry a dash and are being rewritten there.
 * Named one by one, so any other key with a dash, new or old, still fails.
 */
const EDITOR_PENDING: ReadonlySet<string> = new Set([
  'v.linkTooLong',
  'sh.copyFailed',
  'ed.speakerDeleted',
]);

/** Em dash, en dash, horizontal bar. `——` is two em dashes. U+2212 minus is not a dash. */
const DASH = /[–—―]/;

describe('string table', () => {
  it('has exactly the same keys in English and Chinese', () => {
    expect(Object.keys(STRINGS.zh).sort()).toEqual(Object.keys(STRINGS.en).sort());
  });

  for (const lang of ['en', 'zh'] as const) {
    it(`has no dashes in the ${lang} copy`, () => {
      const offenders = Object.entries(STRINGS[lang])
        .filter(([key, text]) => !EDITOR_PENDING.has(key) && DASH.test(text))
        .map(([key, text]) => `${key}: ${text}`);
      expect(offenders).toEqual([]);
    });
  }
});
