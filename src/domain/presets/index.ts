/**
 * The seven shipped formats. A preset is a starting point: applying one fills the
 * roster and the run order and then gets out of the way. Nothing downstream ever
 * compares a config back against its preset or reports a deviation.
 */

import type { Id, L10n, RoundConfig, SegmentKind, SideId } from '../config';
import { uniqueId } from '../id';
import { plan } from '../plan';
import { blank } from './blank';
import { bp } from './bp';
import { chinese4v4 } from './chinese4v4';
import { ld } from './ld';
import { pf } from './pf';
import { policy } from './policy';
import { wsdc } from './wsdc';

export { blank, bp, chinese4v4, ld, pf, policy, wsdc };
export * from './common';

export type PresetKey = 'chinese4v4' | 'bp' | 'wsdc' | 'ld' | 'policy' | 'pf' | 'blank';

/** The format the operator actually runs, first card on the launch screen. */
export const DEFAULT_PRESET: PresetKey = 'chinese4v4';

export const PRESETS: Record<PresetKey, RoundConfig> = {
  chinese4v4,
  bp,
  wsdc,
  ld,
  policy,
  pf,
  blank,
};

export const PRESET_KEYS: readonly PresetKey[] = [
  'chinese4v4',
  'bp',
  'wsdc',
  'ld',
  'policy',
  'pf',
  'blank',
];

/** One block of the Ribbon thumbnail: width is that segment's share of the round. */
export interface RibbonBlock {
  segId: Id;
  kind: SegmentKind;
  side: SideId | null;
  share: number;
  label: L10n;
}

export interface PresetMeta {
  key: PresetKey;
  config: RoundConfig;
  name: L10n;
  /** `4v4 · 9 segments · 42:30` is assembled from these three. */
  speakerCount: number;
  speakersPerSide: Record<SideId, number>;
  segmentCount: number;
  totalMs: number;
  ribbon: RibbonBlock[];
}

function metaOf(key: PresetKey): PresetMeta {
  const config = PRESETS[key];
  const runPlan = plan(config);
  const total = runPlan.totalMs;
  return {
    key,
    config,
    name: config.title,
    speakerCount: config.speakers.length,
    speakersPerSide: {
      A: config.speakers.filter((s) => s.side === 'A').length,
      B: config.speakers.filter((s) => s.side === 'B').length,
    },
    segmentCount: config.segments.length,
    totalMs: total,
    ribbon: runPlan.segments.map((s) => ({
      segId: s.segId,
      kind: s.kind,
      side: s.liveSides.length === 1 ? (s.liveSides[0] ?? null) : null,
      share: total > 0 ? s.allottedMs / total : 0,
      label: s.label,
    })),
  };
}

const META_CACHE = new Map<PresetKey, PresetMeta>();

export function presetMeta(key: PresetKey): PresetMeta {
  const cached = META_CACHE.get(key);
  if (cached) return cached;
  const meta = metaOf(key);
  META_CACHE.set(key, meta);
  return meta;
}

export const PRESET_META: readonly PresetMeta[] = PRESET_KEYS.map(presetMeta);

export function isPresetKey(key: string): key is PresetKey {
  return (PRESET_KEYS as readonly string[]).includes(key);
}

export function getPreset(key: string): RoundConfig | undefined {
  return isPresetKey(key) ? PRESETS[key] : undefined;
}

/**
 * A fresh, independently-owned copy: new round id, new speaker ids, new segment ids,
 * every reference rewritten. Two rounds started from the same preset must not share
 * ids, or the library keys collide and a stage window trusts the wrong frame.
 */
export function instantiatePreset(key: PresetKey): RoundConfig {
  return instantiateConfig(PRESETS[key]);
}

export function instantiateConfig(source: RoundConfig): RoundConfig {
  const copy = structuredClone(source);
  const minted = new Set<string>();
  const speakerMap = new Map<Id, Id>();

  copy.id = uniqueId(minted);

  for (const speaker of copy.speakers) {
    const next = uniqueId(minted);
    speakerMap.set(speaker.id, next);
    speaker.id = next;
  }

  for (const segment of copy.segments) {
    segment.id = uniqueId(minted);
    if (segment.kind === 'speech') {
      // A reference we cannot remap is left verbatim so validate.ts still names it.
      segment.speakerId = speakerMap.get(segment.speakerId) ?? segment.speakerId;
    } else if (segment.kind === 'shared' && segment.speakerIds) {
      segment.speakerIds = segment.speakerIds.map((id) => speakerMap.get(id) ?? id);
    }
  }

  return copy;
}
