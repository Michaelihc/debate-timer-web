/**
 * Epoch anchors, re-based to a local monotonic anchor (§5.3, ruling R5).
 *
 * `performance.timeOrigin` is per-document, so a `startedAtMono` written to localStorage
 * is meaningless once the tab is reopened or the machine has slept. Anchors therefore
 * persist as `startedAtEpoch` and are re-based on restore, after which a resumed round
 * runs purely on `performance.now()` — smooth at 60fps and immune to wall-clock steps.
 */

import type { Now } from './chronometer';
import type { ClockId, RoundState, RunAnchor } from './state';

export interface EpochAnchor {
  clockId: ClockId;
  startedAtEpoch: number;
}

/**
 * The forward-only clamp is the point: a backwards wall-clock step (NTP correction, a
 * user changing the system clock mid-round) can never move a clock backwards.
 */
export function rebase(a: EpochAnchor, n: Now): RunAnchor {
  const elapsedByWall = Math.max(0, n.epoch - a.startedAtEpoch);
  return {
    clockId: a.clockId,
    startedAtEpoch: a.startedAtEpoch,
    startedAtMono: n.mono - elapsedByWall,
    skewAtStart: n.epoch - n.mono,
  };
}

export function toEpochAnchor(a: RunAnchor | null): EpochAnchor | null {
  return a ? { clockId: a.clockId, startedAtEpoch: a.startedAtEpoch } : null;
}

export function rebaseAnchor(a: EpochAnchor | null | undefined, n: Now): RunAnchor | null {
  return a ? rebase(a, n) : null;
}

/**
 * Re-base an incoming anchor against the one this document is already showing.
 *
 * `rebase` alone clamps the *age* at zero, which is not the same promise: re-deriving
 * `startedAtMono` from a wall clock that has just been stepped backwards yields a LATER
 * local start, i.e. a smaller elapsed, i.e. a clock that visibly rewinds.
 * When the incoming anchor is the same run (same clock, same start instant) the local
 * mapping is kept unless the new one says MORE time has passed — so a re-base can pull a
 * lagging clock forward (a suspend, a slow tab) but can never push it back.
 */
function rebaseAgainst(
  prev: RunAnchor | null,
  a: EpochAnchor | null | undefined,
  n: Now,
): RunAnchor | null {
  if (!a) return null;
  const next = rebase(a, n);
  const sameRun =
    prev !== null &&
    prev.clockId === a.clockId &&
    prev.startedAtEpoch === a.startedAtEpoch;
  if (sameRun && prev.startedAtMono <= next.startedAtMono) return prev;
  return next;
}

/** Re-base every anchor a state carries. Idempotent on an already-local state. */
export function rebaseState(s: RoundState, n: Now): RoundState {
  return {
    ...s,
    run: rebaseAgainst(s.run, toEpochAnchor(s.run), n),
    coRun: rebaseAgainst(s.coRun, toEpochAnchor(s.coRun), n),
    roundRun: rebaseAgainst(s.roundRun, toEpochAnchor(s.roundRun), n),
  };
}

/* ------------------------------------------------------------------ snapshot */

/**
 * `RoundState` with every anchor reduced to its epoch form — the shape written to
 * `dt.v3.live`. The undo stacks are dropped: they
 * hold whole prior states, they are worthless after a process death, and they are the
 * only part of the state with unbounded size.
 */
export type SnapshotState = Omit<
  RoundState,
  'run' | 'coRun' | 'roundRun' | 'undo' | 'redo'
> & {
  run: EpochAnchor | null;
  coRun: EpochAnchor | null;
  roundRun: EpochAnchor | null;
};

export function toSnapshot(s: RoundState): SnapshotState {
  const { run, coRun, roundRun, undo: _undo, redo: _redo, ...rest } = s;
  return {
    ...rest,
    run: toEpochAnchor(run),
    coRun: toEpochAnchor(coRun),
    roundRun: toEpochAnchor(roundRun),
  };
}

export function fromSnapshot(snap: SnapshotState, n: Now): RoundState {
  return {
    ...snap,
    run: rebaseAnchor(snap.run, n),
    coRun: rebaseAnchor(snap.coRun, n),
    roundRun: rebaseAnchor(snap.roundRun, n),
    undo: [],
    redo: [],
  };
}
