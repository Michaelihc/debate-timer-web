/**
 * Resolve a `RoundConfig` into everything the runtime needs, once.
 *
 * Every clock the round can run — the segment clock, BOTH free-debate side clocks,
 * and each prep bank — comes out of here with its allotment, its cue ladder, its
 * display format and its grace already resolved. The original assigned the warning
 * threshold and the minutes flag only to the simple timer, so the two chess clocks
 * silently kept Inspector defaults for the whole of free debate (bug 34).
 *
 * Nothing here reorders, dedupes or completes `config.segments`. The run order is
 * the operator's; a speaker may appear anywhere, repeatedly, or not at all.
 */

import type {
  CueSpec,
  Id,
  L10n,
  RoundConfig,
  Rules,
  Segment,
  SegmentKind,
  SideId,
  SpeakerCfg,
  TimeDisplay,
} from './config';
import { cuesFor, speakerById } from './config';
import { configHash } from '../lib/hash';

/** `segId` · `segId:A` · `segId:B` · `bank:A` · `bank:B`. Opaque; never parsed. */
export type ClockId = string;

export type ClockRole = 'segment' | 'chess-side' | 'bank';

export interface ClockPlan {
  id: ClockId;
  role: ClockRole;
  /** null only for prep banks, which belong to a side rather than a segment. */
  segId: Id | null;
  kind: SegmentKind | 'bank';
  side: SideId | null;
  label: L10n;
  allottedMs: number;
  /** Resolved ladder, highest threshold first, one entry per threshold. */
  cues: CueSpec[];
  display: TimeDisplay;
  graceMs: number;
  overtimeCapMs: number;
}

export interface SegmentPlan {
  index: number;
  segment: Segment;
  segId: Id;
  kind: SegmentKind;
  /** What the console shows: explicit label, else role, else speaker name, else kind. */
  label: L10n;
  /** The single speaker of a `speech` segment, when the roster still has them. */
  speaker: SpeakerCfg | null;
  /** Named participants of a `shared` segment, in config order. */
  participants: SpeakerCfg[];
  /** Which floor bars light. Chess and shared light both; a speech lights its own. */
  liveSides: SideId[];
  /** The whole segment, so chess counts both sides. */
  allottedMs: number;
  protectedMs: number;
  /** Scheduled start relative to the round start, from the allotments above it. */
  offsetMs: number;
  clocks: ClockPlan[];
  /** The same clocks by id, in run order. A chess segment has two. */
  clockIds: ClockId[];
  primaryClockId: ClockId;
  cues: CueSpec[];
  /** Referenced speaker ids with no roster entry. `validate.ts` reports these. */
  missingSpeakerIds: Id[];
}

export interface RunPlan {
  config: RoundConfig;
  hash: string;
  /** Alias of `hash`, spelled the way `RoundState.configHash` is. */
  configHash: string;
  display: TimeDisplay;
  graceMs: number;
  overtimeCapMs: number;
  advanceStartsClock: boolean;
  freeDebateExclusive: boolean;
  segments: SegmentPlan[];
  bySegId: Record<Id, SegmentPlan>;
  clocks: Record<ClockId, ClockPlan>;
  /** Every clock id in run order, banks last. */
  clockIds: ClockId[];
  /** `null` for a side with no prep bank configured. */
  banks: Record<SideId, ClockPlan | null>;
  /** The same banks by clock id, for call sites that only need to anchor one. */
  bankIds: Record<SideId, ClockId | null>;
  /** Sum of every segment allotment; chess counts both sides. */
  totalMs: number;
  /** Alias of `totalMs`: what the run sheet says the round should take. */
  scheduledMs: number;
  /** Time each side is scheduled to hold the floor alone. */
  speakingMs: Record<SideId, number>;
  speakerTotals: Record<Id, number>;
}

export const KIND_LABELS: Record<SegmentKind, L10n> = {
  speech: { en: 'Speech', zh: '发言' },
  shared: { en: 'Shared clock', zh: '共用计时' },
  prep: { en: 'Preparation', zh: '准备时间' },
  chess: { en: 'Free debate', zh: '自由辩论' },
  break: { en: 'Break', zh: '休息' },
};

const BANK_LABEL: L10n = { en: 'Prep bank', zh: '准备时间储备' };
const SIDES: readonly SideId[] = ['A', 'B'];

export function chessClockId(segId: Id, side: SideId): ClockId {
  return `${segId}:${side}`;
}

export function bankClockId(side: SideId): ClockId {
  return `bank:${side}`;
}

/** A speech with `allottedMs: null` inherits its speaker; a missing speaker gives 0. */
export function resolveAllotted(segment: Segment, config: RoundConfig): number {
  switch (segment.kind) {
    case 'speech': {
      if (segment.allottedMs !== null) return segment.allottedMs;
      return speakerById(config, segment.speakerId)?.defaultMs ?? 0;
    }
    case 'chess':
      // Each side receives perSideMs in full; the segment as a whole is both.
      return segment.perSideMs * 2;
    default:
      return segment.allottedMs;
  }
}

/**
 * Highest threshold first, one entry per threshold. A cue whose `atMs` is at or
 * above the allotment is kept deliberately: it fires on the first running frame,
 * which is the exact case the original could never reach.
 */
export function resolveCues(segment: Segment, rules: Rules): CueSpec[] {
  const seen = new Set<number>();
  return [...cuesFor(segment, rules)]
    .sort((a, b) => b.atMs - a.atMs)
    .filter((cue) => {
      if (seen.has(cue.atMs)) return false;
      seen.add(cue.atMs);
      return true;
    });
}

export function segmentLabel(segment: Segment, config: RoundConfig): L10n {
  if (segment.kind === 'speech') {
    if (segment.label) return segment.label;
    const speaker = speakerById(config, segment.speakerId);
    if (!speaker) return KIND_LABELS.speech;
    if (speaker.role) return speaker.role;
    const name = speaker.name.trim();
    return name ? { en: name, zh: name } : KIND_LABELS.speech;
  }
  return segment.label;
}

function liveSidesOf(segment: Segment, config: RoundConfig): SideId[] {
  switch (segment.kind) {
    case 'speech': {
      const speaker = speakerById(config, segment.speakerId);
      return speaker ? [speaker.side] : [];
    }
    case 'shared':
      return [...segment.live];
    case 'prep':
      return segment.side === 'both' ? ['A', 'B'] : [segment.side];
    case 'chess':
      return ['A', 'B'];
    case 'break':
      return [];
  }
}

function participantsOf(segment: Segment, config: RoundConfig): SpeakerCfg[] {
  if (segment.kind === 'speech') {
    const speaker = speakerById(config, segment.speakerId);
    return speaker ? [speaker] : [];
  }
  if (segment.kind === 'shared') {
    const out: SpeakerCfg[] = [];
    for (const id of segment.speakerIds ?? []) {
      const speaker = speakerById(config, id);
      if (speaker) out.push(speaker);
    }
    return out;
  }
  return [];
}

function referencedSpeakerIds(segment: Segment): Id[] {
  if (segment.kind === 'speech') return [segment.speakerId];
  if (segment.kind === 'shared') return [...(segment.speakerIds ?? [])];
  return [];
}

export function plan(config: RoundConfig): RunPlan {
  const rules = config.rules;
  const display = rules.display;
  const graceMs = rules.graceMs;
  const overtimeCapMs = rules.overtimeCapMs;

  const segments: SegmentPlan[] = [];
  const bySegId: Record<Id, SegmentPlan> = {};
  const clocks: Record<ClockId, ClockPlan> = {};
  const clockIds: ClockId[] = [];
  const speakingMs: Record<SideId, number> = { A: 0, B: 0 };
  const speakerTotals: Record<Id, number> = {};

  let offsetMs = 0;

  for (const [index, segment] of config.segments.entries()) {
    const allottedMs = resolveAllotted(segment, config);
    const cues = resolveCues(segment, rules);
    const label = segmentLabel(segment, config);
    const liveSides = liveSidesOf(segment, config);
    const participants = participantsOf(segment, config);
    const missingSpeakerIds = referencedSpeakerIds(segment).filter(
      (id) => speakerById(config, id) === undefined,
    );

    const segClocks: ClockPlan[] = [];
    if (segment.kind === 'chess') {
      // Both sides carry the same ladder and format; the original gave them neither.
      for (const side of SIDES) {
        segClocks.push({
          id: chessClockId(segment.id, side),
          role: 'chess-side',
          segId: segment.id,
          kind: 'chess',
          side,
          label,
          allottedMs: segment.perSideMs,
          cues,
          display,
          graceMs,
          overtimeCapMs,
        });
      }
      speakingMs.A += segment.perSideMs;
      speakingMs.B += segment.perSideMs;
    } else {
      segClocks.push({
        id: segment.id,
        role: 'segment',
        segId: segment.id,
        kind: segment.kind,
        side: liveSides.length === 1 ? (liveSides[0] ?? null) : null,
        label,
        allottedMs,
        cues,
        display,
        graceMs,
        overtimeCapMs,
      });
      if (segment.kind === 'speech') {
        const speaker = participants[0];
        if (speaker) {
          speakingMs[speaker.side] += allottedMs;
          speakerTotals[speaker.id] = (speakerTotals[speaker.id] ?? 0) + allottedMs;
        }
      }
    }

    for (const clock of segClocks) {
      clocks[clock.id] = clock;
      clockIds.push(clock.id);
    }

    const primary = segClocks[0];
    const segPlan: SegmentPlan = {
      index,
      segment,
      segId: segment.id,
      kind: segment.kind,
      label,
      speaker: segment.kind === 'speech' ? (participants[0] ?? null) : null,
      participants,
      liveSides,
      allottedMs,
      protectedMs: segment.kind === 'speech' ? (segment.protectedMs ?? 0) : 0,
      offsetMs,
      clocks: segClocks,
      clockIds: segClocks.map((c) => c.id),
      primaryClockId: primary ? primary.id : segment.id,
      cues,
      missingSpeakerIds,
    };
    segments.push(segPlan);
    bySegId[segment.id] = segPlan;
    offsetMs += allottedMs;
  }

  const banks: Record<SideId, ClockPlan | null> = { A: null, B: null };
  for (const side of SIDES) {
    const cfg = side === 'A' ? config.sides[0] : config.sides[1];
    if (cfg.prepBankMs <= 0) continue;
    const bank: ClockPlan = {
      id: bankClockId(side),
      role: 'bank',
      segId: null,
      kind: 'bank',
      side,
      label: BANK_LABEL,
      allottedMs: cfg.prepBankMs,
      cues: resolveCues({ id: bankClockId(side), kind: 'break', label: BANK_LABEL, allottedMs: cfg.prepBankMs }, rules),
      display,
      graceMs,
      overtimeCapMs,
    };
    banks[side] = bank;
    clocks[bank.id] = bank;
    clockIds.push(bank.id);
  }

  const hash = configHash(config);
  return {
    config,
    hash,
    configHash: hash,
    display,
    graceMs,
    overtimeCapMs,
    advanceStartsClock: rules.advanceStartsClock ?? false,
    freeDebateExclusive: rules.freeDebateExclusive ?? true,
    segments,
    bySegId,
    clocks,
    clockIds,
    banks,
    bankIds: { A: banks.A?.id ?? null, B: banks.B?.id ?? null },
    totalMs: offsetMs,
    scheduledMs: offsetMs,
    speakingMs,
    speakerTotals,
  };
}

export function segmentAt(runPlan: RunPlan, index: number): SegmentPlan | null {
  return runPlan.segments[index] ?? null;
}

export function clockOf(runPlan: RunPlan, clockId: ClockId): ClockPlan | null {
  return runPlan.clocks[clockId] ?? null;
}

/** The next `speech` segment after `index`, for the on-deck strip. `null` if none. */
export function onDeckAfter(runPlan: RunPlan, index: number): SegmentPlan | null {
  for (let i = index + 1; i < runPlan.segments.length; i++) {
    const candidate = runPlan.segments[i];
    if (candidate && candidate.kind === 'speech') return candidate;
  }
  return null;
}

/** Proportional widths for the Ribbon; sums to 1, or all zero on an empty round. */
export function ribbonShares(runPlan: RunPlan): number[] {
  if (runPlan.totalMs <= 0) return runPlan.segments.map(() => 0);
  return runPlan.segments.map((s) => s.allottedMs / runPlan.totalMs);
}
