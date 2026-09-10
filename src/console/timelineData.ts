/**
 * The timeline strip's data.
 *
 * The original's `Timeline` is a `HorizontalLayoutGroup` of 31x30 squares, one per event,
 * labelled `P` for a prep block, `F` for free debate, and otherwise the SPEAKER'S NUMBER —
 * not the segment index. That number is the speaker's position in their own side's roster,
 * so this module resolves it once from the config rather than making a component guess.
 *
 * The run order is the operator's: this walks `plan.segments` in the order given and
 * sorts, dedupes and flags nothing. A repeat draws twice; an omission draws not at all.
 */

import type { Id, Lang, SegmentKind, SideId, SpeakerCfg } from '../domain/config';
import { KIND_LABELS } from '../domain/plan';
import type { RunPlan } from '../engine/state';
import type { StringKey } from '../i18n/strings';
import type { TFn } from '../i18n/useLang';
import { resolveL10n } from '../i18n/useLang';

export interface Pip {
  segId: Id;
  /** Position in the run order. */
  index: number;
  kind: SegmentKind;
  /** Identity colour on the pip's tick mark only — never on its face. */
  side: SideId | null;
  /** The glyph inside the square: `P`, `F`, else the speaker's roster number. */
  mark: string;
  /** The full segment name, for the accessible label and the tooltip. */
  label: string;
  allottedMs: number;
}

/** `P` / `F` / `S` / `B` — glyph marks, but still translated, like every other string. */
const MARK_KEY: Record<Exclude<SegmentKind, 'speech'>, StringKey> = {
  prep: 'tl.prep',
  chess: 'tl.free',
  shared: 'tl.shared',
  break: 'tl.break',
};

/**
 * Each speaker's number WITHIN THEIR OWN SIDE, 1-based — what the original prints on the
 * figure and on the timeline square.
 */
export function rosterOrdinals(speakers: readonly SpeakerCfg[]): Record<Id, number> {
  const out: Record<Id, number> = {};
  const seen: Record<string, number> = {};
  for (const sp of speakers) {
    const n = (seen[sp.side] ?? 0) + 1;
    seen[sp.side] = n;
    out[sp.id] = n;
  }
  return out;
}

export function pipsFromPlan(plan: RunPlan, lang: Lang, t: TFn): Pip[] {
  const ordinals = rosterOrdinals(plan.config.speakers);
  return plan.segments.map((ps) => {
    const speaker = ps.speaker;
    const mark =
      ps.kind === 'speech'
        ? String(speaker === null ? ps.index + 1 : (ordinals[speaker.id] ?? ps.index + 1))
        : t(MARK_KEY[ps.kind]);
    return {
      segId: ps.segId,
      index: ps.index,
      kind: ps.kind,
      side: speaker?.side ?? (ps.liveSides.length === 1 ? (ps.liveSides[0] ?? null) : null),
      mark,
      label: resolveL10n(ps.label, lang) || resolveL10n(KIND_LABELS[ps.kind], lang),
      allottedMs: ps.allottedMs,
    };
  });
}
