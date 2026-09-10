/**
 * The Ribbon's shape and its two adapters. Kept apart from `Ribbon.tsx` so that file
 * exports components and nothing else.
 *
 * The run order is the operator's. These adapters walk `plan.segments` in the order given
 * and read `state.clocks[id].consumedMs`; they compute no schedule, sort nothing, and
 * drop nothing. Repeats, omissions and out-of-sequence speakers pass through verbatim.
 */

import type { Id, L10n, Lang, SegmentKind, SideId } from '../domain/config';
import { KIND_LABELS } from '../domain/plan';
import type { RoundState, RunPlan } from '../engine/state';
import { resolveL10n } from '../i18n/useLang';

export interface RibbonSegment {
  segId: Id;
  /** Position in the run order. */
  index: number;
  kind: SegmentKind;
  /** Identity colour lives on the block's 2px edge only — never on its fill. */
  side: SideId | null;
  label: string;
  /** Rendered when the block is too narrow for `label`. */
  short: string;
  allottedMs: number;
  /** Actual consumption. Omit for a segment that has not run. */
  usedMs?: number;
}

/** How narrow a block may get before its label is dropped; exported for the CSS contract. */
export const RIBBON_LABEL_PX = 60;
export const RIBBON_SHORT_PX = 30;

function shortLabel(kind: SegmentKind, index: number, lang: Lang): string {
  switch (kind) {
    case 'prep':
      return lang === 'zh' ? '备' : 'P';
    case 'chess':
      return lang === 'zh' ? '自' : 'F';
    case 'shared':
      return lang === 'zh' ? '共' : 'S';
    case 'break':
      return lang === 'zh' ? '休' : 'B';
    default:
      return String(index + 1);
  }
}

/**
 * The live Ribbon's data. Every number is READ from the plan and the clock records —
 * nothing is recomputed here.
 */
export function ribbonFromPlan(
  plan: RunPlan,
  state: RoundState | null,
  lang: Lang,
): RibbonSegment[] {
  return plan.segments.map((ps) => {
    let used: number | undefined;
    if (state) {
      let sum = 0;
      let seen = false;
      for (const id of ps.clockIds) {
        const rec = state.clocks[id];
        if (!rec) continue;
        seen = true;
        sum += rec.consumedMs;
      }
      if (seen) used = sum;
    }
    const label = resolveL10n(ps.label, lang) || resolveL10n(KIND_LABELS[ps.kind], lang);
    const base: RibbonSegment = {
      segId: ps.segId,
      index: ps.index,
      kind: ps.kind,
      side: ps.speaker?.side ?? (ps.liveSides.length === 1 ? (ps.liveSides[0] ?? null) : null),
      label,
      short: ps.speaker ? label.slice(0, 3) : shortLabel(ps.kind, ps.index, lang),
      allottedMs: ps.allottedMs,
    };
    return used === undefined ? base : { ...base, usedMs: used };
  });
}

/** A preset thumbnail from `presets/index.ts` ribbon metadata. */
export function ribbonFromShares(
  blocks: readonly {
    segId: Id;
    kind: SegmentKind;
    side: SideId | null;
    share: number;
    label?: L10n;
  }[],
  totalMs: number,
  lang: Lang,
): RibbonSegment[] {
  return blocks.map((b, i) => ({
    segId: b.segId,
    index: i,
    kind: b.kind,
    side: b.side,
    label: resolveL10n(b.label, lang) || resolveL10n(KIND_LABELS[b.kind], lang),
    short: shortLabel(b.kind, i, lang),
    allottedMs: Math.max(1, Math.round(b.share * totalMs)),
  }));
}
