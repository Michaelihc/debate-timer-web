/**
 * The invariant: nothing counts down, nothing accumulates per frame (§5.1).
 *
 * A running clock's elapsed time is DERIVED from its anchor every time it is read. The
 * original subtracted `Time.deltaTime` from a running total (Unity bug #35), which drifts,
 * loses time under tab throttling, and cannot survive a suspend. Here a throttled tab
 * simply recomputes a correct number less often instead of accumulating a wrong one.
 */

import type { ClockId, ClockRec, RoundState, RunAnchor } from './state';
import { ROUND_CLOCK } from './state';

export interface Now {
  /** `performance.now()` — monotonic, immune to NTP steps and user clock changes. */
  mono: number;
  /** `Date.now()` — the only value that means anything in another document. */
  epoch: number;
}

export function now(): Now {
  return { mono: performance.now(), epoch: Date.now() };
}

/** Deterministic `Now` for tests and for replaying a recorded timeline. */
export function nowFrom(mono: number, epoch: number): Now {
  return { mono, epoch };
}

export function makeAnchor(clockId: ClockId, n: Now): RunAnchor {
  return {
    clockId,
    startedAtEpoch: n.epoch,
    startedAtMono: n.mono,
    skewAtStart: n.epoch - n.mono,
  };
}

/** Live milliseconds since an anchor. Forward-only: a clock can never move backwards. */
export function liveMs(a: RunAnchor | null | undefined, n: Now): number {
  return a ? Math.max(0, n.mono - a.startedAtMono) : 0;
}

export function anchorOf(s: RoundState, clockId: ClockId): RunAnchor | null {
  if (s.run?.clockId === clockId) return s.run;
  if (s.coRun?.clockId === clockId) return s.coRun;
  return null;
}

export function isRunning(s: RoundState, clockId: ClockId): boolean {
  return anchorOf(s, clockId) !== null;
}

/** The primary anchor first, so a caller that takes `[0]` gets the floor side. */
export function runningClockIds(s: RoundState): ClockId[] {
  const out: ClockId[] = [];
  if (s.run) out.push(s.run.clockId);
  if (s.coRun && s.coRun.clockId !== s.run?.clockId) out.push(s.coRun.clockId);
  return out;
}

export function elapsedMs(s: RoundState, clockId: ClockId, n: Now): number {
  const rec = s.clocks[clockId];
  if (!rec) return 0;
  return rec.consumedMs + liveMs(anchorOf(s, clockId), n);
}

/** MAY GO NEGATIVE. Overtime is not an error state; it is the number going past zero. */
export function remainingMs(s: RoundState, clockId: ClockId, n: Now): number {
  const rec = s.clocks[clockId];
  if (!rec) return 0;
  return rec.allottedMs - elapsedMs(s, clockId, n);
}

/** Positive milliseconds past expiry, 0 while time remains. */
export function overtimeMs(s: RoundState, clockId: ClockId, n: Now): number {
  return Math.max(0, -remainingMs(s, clockId, n));
}

function foldInto(
  clocks: Record<ClockId, ClockRec>,
  a: RunAnchor | null,
  n: Now,
): Record<ClockId, ClockRec> {
  if (!a) return clocks;
  const rec = clocks[a.clockId];
  if (!rec) return clocks;
  const add = liveMs(a, n);
  if (add === 0) return clocks;
  return { ...clocks, [a.clockId]: { ...rec, consumedMs: rec.consumedMs + add } };
}

/** Stop every segment/bank clock: fold its live time into `consumedMs`, drop the anchors. */
export function fold(s: RoundState, n: Now): RoundState {
  if (!s.run && !s.coRun) return s;
  let clocks = foldInto(s.clocks, s.run, n);
  clocks = foldInto(clocks, s.coRun, n);
  return { ...s, clocks, run: null, coRun: null };
}

/** Fold exactly one clock; a co-runner is promoted so `coRun` never outlives `run`. */
export function foldClock(s: RoundState, clockId: ClockId, n: Now): RoundState {
  const a = anchorOf(s, clockId);
  if (!a) return s;
  const clocks = foldInto(s.clocks, a, n);
  if (s.run?.clockId === clockId) {
    return { ...s, clocks, run: s.coRun, coRun: null };
  }
  return { ...s, clocks, coRun: null };
}

export interface AnchorOpts {
  /**
   * Free debate with `freeDebateExclusive: false` only. The incoming clock becomes the
   * primary anchor and the incumbent keeps running as the secondary one. Every other
   * caller folds first, which is why two anchors are otherwise unreachable.
   */
  concurrent?: boolean;
}

export function anchor(
  s: RoundState,
  clockId: ClockId,
  n: Now,
  opts?: AnchorOpts,
): RoundState {
  if (!s.clocks[clockId]) return s;

  if (opts?.concurrent === true) {
    if (isRunning(s, clockId)) {
      // Already live — promote it to primary rather than re-anchoring, which would
      // discard the time it has run so far.
      if (s.run?.clockId === clockId) return s;
      return { ...s, run: s.coRun, coRun: s.run };
    }
    if (s.run) {
      const demoted = s.run;
      const clocks = foldInto(s.clocks, s.coRun, n); // never more than two anchors
      return { ...s, clocks, run: makeAnchor(clockId, n), coRun: demoted };
    }
  }

  const folded = fold(s, n); // structural: only one anchor survives this
  return { ...folded, run: makeAnchor(clockId, n) };
}

/* ------------------------------------------------------------- round elapsed */

export function anchorRound(s: RoundState, n: Now): RoundState {
  if (s.roundRun) return s;
  return {
    ...s,
    roundRun: makeAnchor(ROUND_CLOCK, n),
    roundStartedAtEpoch: s.roundStartedAtEpoch ?? n.epoch,
  };
}

export function foldRound(s: RoundState, n: Now): RoundState {
  if (!s.roundRun) return s;
  return {
    ...s,
    roundConsumedMs: s.roundConsumedMs + liveMs(s.roundRun, n),
    roundRun: null,
  };
}

/** Excludes held time and pre-round time, because the anchor is dropped for both. */
export function roundElapsedMs(s: RoundState, n: Now): number {
  return s.roundConsumedMs + liveMs(s.roundRun, n);
}

/** Freeze everything, round clock included. HOLD, COMPLETE and undo snapshots use this. */
export function foldAll(s: RoundState, n: Now): RoundState {
  return foldRound(fold(s, n), n);
}

/* -------------------------------------------------------------- clock edits */

export function setClock(
  s: RoundState,
  clockId: ClockId,
  patch: Partial<ClockRec>,
): RoundState {
  const rec = s.clocks[clockId];
  if (!rec) return s;
  return { ...s, clocks: { ...s.clocks, [clockId]: { ...rec, ...patch } } };
}

/**
 * Move `deltaMs` of remaining time onto a clock. Positive adds time. `consumedMs` is
 * spent down first and clamped at zero; whatever is left raises `allottedMs`, so an ARMED
 * clock (consumed 0) still gains exactly `deltaMs` and remaining always moves by exactly
 * `deltaMs`.
 */
export function addRemaining(s: RoundState, clockId: ClockId, deltaMs: number): RoundState {
  const rec = s.clocks[clockId];
  if (!rec || deltaMs === 0) return s;
  if (deltaMs < 0) {
    return setClock(s, clockId, { consumedMs: rec.consumedMs - deltaMs });
  }
  const fromConsumed = Math.min(rec.consumedMs, deltaMs);
  return setClock(s, clockId, {
    consumedMs: rec.consumedMs - fromConsumed,
    allottedMs: rec.allottedMs + (deltaMs - fromConsumed),
  });
}
