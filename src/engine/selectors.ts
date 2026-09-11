/**
 * Everything the UI reads. No component derives a clock number, a band, an on-deck
 * speaker or a floor state on its own — indicator state is passed as data from here
 * (Unity bug #7: an `AnimationController` that resolved the wrong timer by tag and flashed
 * a "next speaker" arrow for an entire free-debate segment off a frozen value).
 */

import type { Id, L10n, Segment, SideId, Speaker } from '../domain/config';
import { onDeckAfter, segmentAt } from '../domain/plan';
import { fillFraction } from '../lib/format';
import type { Now } from './chronometer';
import {
  elapsedMs,
  isRunning,
  overtimeMs,
  remainingMs,
  roundElapsedMs,
  runningClockIds,
} from './chronometer';
import type { CueSpec } from '../domain/config';
import type { ClockId, RoundState, RunPlan, SegmentPlan, Transport } from './state';
import { chessClockId, transportOf } from './state';

export type RoundPhase = 'pre' | 'in' | 'complete';

/** Display bands over RUNNING/PAUSED. Never transport states (§6.1). */
export type Band = 'normal' | 'warning' | 'final10' | 'over';

export const FINAL10_MS = 10_000;

/* ------------------------------------------------------------------ segments */

export function planSegmentAt(plan: RunPlan, index: number): SegmentPlan | null {
  return segmentAt(plan, index);
}

/** The clocks a planned segment owns: one, or two for free debate. */
export function clockIdsOf(ps: SegmentPlan | null): ClockId[] {
  return ps ? ps.clockIds : [];
}

export function roundPhase(s: RoundState, plan: RunPlan): RoundPhase {
  if (s.cursor < 0) return 'pre';
  return s.cursor >= plan.segments.length ? 'complete' : 'in';
}

export function currentPlanSegment(s: RoundState, plan: RunPlan): SegmentPlan | null {
  return planSegmentAt(plan, s.cursor);
}

export function currentSegment(s: RoundState, plan: RunPlan): Segment | null {
  return currentPlanSegment(s, plan)?.segment ?? null;
}

export function nextPlanSegment(s: RoundState, plan: RunPlan): SegmentPlan | null {
  return planSegmentAt(plan, s.cursor + 1);
}

/** Every clock belonging to the current segment (two for chess). */
export function segmentClockIds(s: RoundState, plan: RunPlan): ClockId[] {
  return clockIdsOf(currentPlanSegment(s, plan));
}

/**
 * The clock the transport acts on. A chess segment with no floor yet has none — that is
 * exactly the `CHOOSE A SIDE` state, not a fallback to side A.
 */
export function primaryClockId(s: RoundState, plan: RunPlan): ClockId | null {
  if (s.bankDraw) return plan.banks[s.bankDraw.side]?.id ?? null;
  const ps = currentPlanSegment(s, plan);
  if (!ps) return null;
  if (ps.kind === 'chess') {
    return s.floor ? chessClockId(ps.segId, s.floor) : null;
  }
  return ps.primaryClockId;
}

/**
 * The clocks the display should read this frame: whatever is running, else the segment's
 * own clocks. During a bank draw that is the bank.
 */
export function activeClockIds(s: RoundState, plan: RunPlan): ClockId[] {
  const running = runningClockIds(s);
  if (running.length > 0) return running;
  if (s.bankDraw) {
    const id = plan.banks[s.bankDraw.side]?.id ?? null;
    return id ? [id] : [];
  }
  return segmentClockIds(s, plan);
}

/* ------------------------------------------------------------------ speakers */

/**
 * Whether SWAP is meaningful right now: a chess segment with EXACTLY one side running.
 * The original `swap()` required this too; the difference is that we hide the control when
 * it is false rather than letting it silently no-op. Its keybinding is inert in that state.
 */
export function canSwap(s: RoundState, plan: RunPlan): boolean {
  const ps = currentPlanSegment(s, plan);
  if (!ps || ps.segment.kind !== 'chess') return false;
  const liveA = isRunning(s, chessClockId(ps.segId, 'A'));
  const liveB = isRunning(s, chessClockId(ps.segId, 'B'));
  return liveA !== liveB;
}

export function currentSpeaker(s: RoundState, plan: RunPlan): Speaker | null {
  return currentPlanSegment(s, plan)?.speaker ?? null;
}

/**
 * The next speaker, or null. Never a sentinel index — the original defaulted a failed
 * parse to `0` and relied on no real speaker having that id (Unity bug #17).
 */
export function onDeck(s: RoundState, plan: RunPlan): Speaker | null {
  return onDeckAfter(plan, Math.max(-1, s.cursor))?.speaker ?? null;
}

/** The participants a segment names, in roster order. Empty for prep and breaks. */
export function segmentSpeakers(s: RoundState, plan: RunPlan): Speaker[] {
  return currentPlanSegment(s, plan)?.participants ?? [];
}

/**
 * Speakers whose every turn in the run order is already behind the cursor — the roster
 * figures that have finished and should stand down on the console.
 *
 * The order is the operator's: this walks `plan.segments` verbatim, so a speaker who
 * appears three times is done only after the third, one who never appears is never done,
 * and nothing here reorders, dedupes or completes the sequence.
 */
export function spokenSpeakerIds(s: RoundState, plan: RunPlan): Set<Id> {
  const done = new Set<Id>();
  const pending = new Set<Id>();
  for (const ps of plan.segments) {
    const ids = ps.speaker ? [ps.speaker.id] : ps.participants.map((p) => p.id);
    for (const id of ids) (ps.index < s.cursor ? done : pending).add(id);
  }
  for (const id of pending) done.delete(id);
  return done;
}

/* --------------------------------------------------------------------- bands */

/** The highest positive threshold in a ladder; 0 when the ladder has none. */
export function firstCueMs(cues: readonly CueSpec[]): number {
  let max = 0;
  for (const c of cues) if (c.atMs > max) max = c.atMs;
  return max;
}

export function bandOf(remaining: number, cues: readonly CueSpec[]): Band {
  if (remaining <= 0) return 'over';
  if (remaining <= FINAL10_MS) return 'final10';
  return remaining <= firstCueMs(cues) ? 'warning' : 'normal';
}

/* ---------------------------------------------------------------- clock view */

export interface ClockView {
  clockId: ClockId;
  side: SideId | null;
  label: L10n | null;
  allottedMs: number;
  elapsedMs: number;
  /** Negative in overtime. Never clamped — the clock does not decide a speech is over. */
  remainingMs: number;
  overtimeMs: number;
  transport: Transport;
  band: Band;
  /** 0..1, never NaN and never Infinity (Unity bug #10). */
  fill: number;
  running: boolean;
  /** True while this side holds the floor in a chess segment. */
  hasFloor: boolean;
}

export function clockView(
  s: RoundState,
  plan: RunPlan,
  clockId: ClockId,
  n: Now,
): ClockView | null {
  const pc = plan.clocks[clockId];
  const rec = s.clocks[clockId];
  if (!pc || !rec) return null;
  const remaining = remainingMs(s, clockId, n);
  return {
    clockId,
    side: pc.side,
    label: pc.label,
    allottedMs: rec.allottedMs,
    elapsedMs: elapsedMs(s, clockId, n),
    remainingMs: remaining,
    overtimeMs: overtimeMs(s, clockId, n),
    transport: transportOf(s, clockId),
    band: bandOf(remaining, pc.cues),
    fill: fillFraction(remaining, rec.allottedMs),
    running: isRunning(s, clockId),
    hasFloor: pc.role === 'chess-side' && s.floor === pc.side,
  };
}

/* ------------------------------------------------------------- round readouts */

export { roundElapsedMs };

/** Where the run sheet says we should be by now. */
export function scheduledElapsedMs(s: RoundState, plan: RunPlan, n: Now): number {
  if (s.cursor < 0) return 0;
  const ps = currentPlanSegment(s, plan);
  if (!ps) return plan.totalMs;
  let used = 0;
  for (const id of clockIdsOf(ps)) used += elapsedMs(s, id, n);
  return ps.offsetMs + Math.min(used, ps.allottedMs);
}

/** Positive = the round is running behind its run sheet; negative = ahead. */
export function scheduleDelta(s: RoundState, plan: RunPlan, n: Now): number {
  return roundElapsedMs(s, n) - scheduledElapsedMs(s, plan, n);
}

/** A bank decrements and persists across the whole round; it never resets (§7.35). */
export function bankRemaining(s: RoundState, plan: RunPlan, side: SideId, n: Now): number {
  const id = plan.banks[side]?.id;
  return id ? remainingMs(s, id, n) : 0;
}

/* ----------------------------------------------------------------- round view */

export interface RoundView {
  phase: RoundPhase;
  cursor: number;
  segmentCount: number;
  segment: Segment | null;
  nextSegment: Segment | null;
  /** Transport of the primary clock; 'armed' when there is no primary clock yet. */
  transport: Transport;
  hold: boolean;
  floor: SideId | null;
  /** True in a chess segment that is waiting for the operator to pick a side. */
  awaitingFloor: boolean;
  primary: ClockView | null;
  clocks: ClockView[];
  currentSpeaker: Speaker | null;
  onDeck: Speaker | null;
  /** The "act now" tell: the live clock has expired and the next speaker should stand. */
  onDeckUrgent: boolean;
  band: Band;
  bank: Record<SideId, number>;
  bankDraw: SideId | null;
  roundElapsedMs: number;
  scheduledMs: number;
  scheduleDeltaMs: number;
  sleepPending: { gapMs: number; clockId: ClockId } | null;
  canUndo: boolean;
  canRedo: boolean;
}

/** One call per discrete change. The rAF loop writes digits through refs instead. */
export function roundView(s: RoundState, plan: RunPlan, n: Now): RoundView {
  const ps = currentPlanSegment(s, plan);
  const seg = ps?.segment ?? null;
  const primaryId = primaryClockId(s, plan);
  const primary = primaryId ? clockView(s, plan, primaryId, n) : null;
  const clocks: ClockView[] = [];
  for (const id of activeClockIds(s, plan)) {
    const v = clockView(s, plan, id, n);
    if (v) clocks.push(v);
  }
  const band = primary?.band ?? clocks[0]?.band ?? 'normal';
  return {
    phase: roundPhase(s, plan),
    cursor: s.cursor,
    segmentCount: plan.segments.length,
    segment: seg,
    nextSegment: nextPlanSegment(s, plan)?.segment ?? null,
    transport: primaryId ? transportOf(s, primaryId) : 'armed',
    hold: s.hold,
    floor: s.floor,
    awaitingFloor: ps?.kind === 'chess' && s.floor === null,
    primary,
    clocks,
    currentSpeaker: currentSpeaker(s, plan),
    onDeck: onDeck(s, plan),
    onDeckUrgent: (primary?.remainingMs ?? 1) <= 0,
    band,
    bank: { A: bankRemaining(s, plan, 'A', n), B: bankRemaining(s, plan, 'B', n) },
    bankDraw: s.bankDraw?.side ?? null,
    roundElapsedMs: roundElapsedMs(s, n),
    scheduledMs: plan.totalMs,
    scheduleDeltaMs: scheduleDelta(s, plan, n),
    sleepPending: s.sleepPending,
    canUndo: s.undo.length > 0,
    canRedo: s.redo.length > 0,
  };
}
