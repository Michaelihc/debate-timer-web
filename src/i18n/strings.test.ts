/**
 * The string table's own promises: both languages carry the same keys, and no visible copy
 * leans on a dash (an em dash, an en dash, or the Chinese double dash) to join its clauses.
 * Copy that needs a pause gets a comma, a full stop, or a rewrite.
 */

import { describe, expect, it } from 'vitest';
import { STRINGS } from './strings';

/** Em dash, en dash, horizontal bar. `——` is two em dashes. U+2212 minus is not a dash. */
const DASH = /[–—―]/;

describe('string table', () => {
  it('has exactly the same keys in English and Chinese', () => {
    expect(Object.keys(STRINGS.zh).sort()).toEqual(Object.keys(STRINGS.en).sort());
  });

  for (const lang of ['en', 'zh'] as const) {
    it(`has no dashes in the ${lang} copy`, () => {
      const offenders = Object.entries(STRINGS[lang])
        .filter(([, text]) => DASH.test(text))
        .map(([key, text]) => `${key}: ${text}`);
      expect(offenders).toEqual([]);
    });
  }
});
