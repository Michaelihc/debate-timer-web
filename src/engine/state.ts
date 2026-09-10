/**
 * Runtime state for one round. Never serialized to a share URL — only snapshotted to
 * localStorage (see `rebase.ts` for the epoch-anchored snapshot form).
 *
 * Nothing in `src/engine/` imports React, touches the DOM, or reads a global.
 */

import type { Id, Rules, SideId } from '../domain/config';
import type { ClockId, ClockPlan, RunPlan, SegmentPlan } from '../domain/plan';
import { bankClockId, chessClockId } from '../domain/plan';

/**
 * The resolved round lives in `domain/plan.ts`; the engine only consumes it. Re-exported
 * here so every engine module has one import for the shapes it touches.
 */
export type { ClockId, ClockPlan, RunPlan, SegmentPlan };
export { bankClockId, chessClockId };

/** The round-elapsed clock. It is not in `clocks`; it lives in its own anchor. */
export const ROUND_CLOCK: ClockId = 'round';

/* -------------------------------------------------------------------- clocks */

export interface ClockRec {
  /** Banks: the configured bank total. Editable live via ADJUST. */
  allottedMs: number;
  /** Folded on every stop. The ONLY accumulated number in the app. */
  consumedMs: number;
}

export interface RunAnchor {
  clockId: ClockId;
  /** `Date.now()` — survives a reload and crosses a window boundary (R5). */
  startedAtEpoch: number;
  /** `performance.now()` — meaningful in THIS document only. */
  startedAtMono: number;
  /** `epoch - mono` at start; a change in this is a sleep/suspend (§5.4). */
  skewAtStart: number;
}

export interface SegmentResult {
  segId: Id;
  clockId: ClockId;
  allottedMs: number;
  usedMs: number;
  overMs: number;
}

export type Transport = 'armed' | 'running' | 'paused';

/* ------------------------------------------------------------------ commands */

export type Command =
  /** Arm the segment at `cursor`. Never resets; resumes the remembered remaining. */
  | { t: 'LOAD'; cursor: number; start?: boolean }
  | { t: 'START' }
  | { t: 'PAUSE' }
  | { t: 'RESUME' }
  /** Context-sensitive Space/PageDown: start, pause, resume, or hand off in chess. */
  | { t: 'TOGGLE'; pauseInChess?: boolean }
  | { t: 'ADVANCE'; start?: boolean }
  | { t: 'PREV' }
  | { t: 'RESET_SEGMENT' }
  | { t: 'ADJUST'; deltaMs: number }
  | { t: 'GIVE_FLOOR'; side: SideId }
  | { t: 'SWAP' }
  | { t: 'HOLD'; sleep?: { gapMs: number; clockId: ClockId } }
  | { t: 'RELEASE' }
  | { t: 'BANK_DRAW'; side: SideId }
  | { t: 'BANK_END' }
  /** `charge: true` bills the suspend gap to the clock that was running. */
  | { t: 'RECONCILE'; charge: boolean }
  | { t: 'END_ROUND' }
  | { t: 'UNDO' }
  | { t: 'REDO' };

export const UNDO_DEPTH = 50;

/* --------------------------------------------------------------------- state */

export interface RoundState {
  configHash: string;
  /** -1 = pre-round; `segments.length` = complete. */
  cursor: number;
  clocks: Record<ClockId, ClockRec>;
  /**
   * THE running clock. A single field, so `ADVANCE`/`HOLD`/`SWAP`/`BANK_DRAW`/`PREV` all
   * fold before anchoring and two simultaneous clocks cannot be expressed (Unity bug #4).
   */
  run: RunAnchor | null;
  /**
   * The one deliberate exception: free debate with `rules.freeDebateExclusive === false`.
   * Only `anchor(..., { concurrent: true })` can set it, only the chess path in the
   * reducer passes that flag, and `coRun !== null` implies `run !== null`.
   */
  coRun: RunAnchor | null;
  /** Round-elapsed anchor. Runs from the first ADVANCE; stops on HOLD and at COMPLETE. */
  roundRun: RunAnchor | null;
  /** Chess-clock floor; null = nobody has it yet. */
  floor: SideId | null;
  /** Round hold; freezes every clock including banks and the round clock. */
  hold: boolean;
  /** What to re-anchor on RELEASE — a hold that froze nothing must resume nothing. */
  resumeOnRelease: ClockId[];
  /** True when the round clock itself was running at the moment of the hold. */
  roundHeld: boolean;
  bankDraw: { side: SideId; resumeAfter: boolean; resumeClockId: ClockId | null } | null;
  roundStartedAtEpoch: number | null;
  /** Folded round elapsed, excluding holds and pre-round time. */
  roundConsumedMs: number;
  /** Key: `${clockId}@${atMs}` or `${clockId}@grace`. Latched, never edge-detected. */
  cuesFired: Record<string, true>;
  log: SegmentResult[];
  undo: UndoEntry[];
  redo: UndoEntry[];
  sleepPending: { gapMs: number; clockId: ClockId } | null;
}

/** The slice an undo entry restores. The stacks themselves are excluded, or they nest. */
export type UndoState = Omit<RoundState, 'undo' | 'redo'>;

export interface UndoEntry {
  cmd: Command;
  /**
   * Fully folded: every anchor was collapsed into `consumedMs` at the moment the command
   * ran. Restoring re-anchors `running` at the CURRENT instant, so undoing three seconds
   * after a mistaken ADVANCE does not silently bill those three seconds to the speaker.
   */
  prev: UndoState;
  running: ClockId[];
  roundRunning: boolean;
}

/* ---------------------------------------------------------------- rule flags */
/* Both are optional on `Rules` so every existing construction site still compiles; these
   two accessors are the only place their defaults are decided. */

/** Default false: ADVANCE arms and Space starts. */
export function advanceStarts(rules: Rules): boolean {
  return rules.advanceStartsClock === true;
}

/** Default true: the two free-debate side clocks are mutually exclusive. */
export function chessExclusive(rules: Rules): boolean {
  return rules.freeDebateExclusive !== false;
}

/* ----------------------------------------------------------------- transport */

/**
 * Transport is DERIVED, never stored. There is no field that can disagree with the
 * anchors, and therefore none that can claim a clock is running when it is not.
 */
export function transportOf(s: RoundState, clockId: ClockId): Transport {
  if (s.run?.clockId === clockId || s.coRun?.clockId === clockId) return 'running';
  return (s.clocks[clockId]?.consumedMs ?? 0) > 0 ? 'paused' : 'armed';
}

/* ------------------------------------------------------------- construction */

export function initialState(plan: RunPlan): RoundState {
  const clocks: Record<ClockId, ClockRec> = {};
  for (const id of plan.clockIds) {
    const pc = plan.clocks[id];
    if (pc) clocks[id] = { allottedMs: pc.allottedMs, consumedMs: 0 };
  }
  return {
    configHash: plan.hash,
    cursor: -1,
    clocks,
    run: null,
    coRun: null,
    roundRun: null,
    floor: null,
    hold: false,
    resumeOnRelease: [],
    roundHeld: false,
    bankDraw: null,
    roundStartedAtEpoch: null,
    roundConsumedMs: 0,
    cuesFired: {},
    log: [],
    undo: [],
    redo: [],
    sleepPending: null,
  };
}

/**
 * Apply a re-planned config to a live round by stable id (§9.5). A clock whose id
 * survives keeps its `consumedMs`; one that disappears is dropped. `droppedRunning` tells
 * the caller the running clock vanished — the one case that must auto-HOLD.
 */
export function reconcileState(
  prev: RoundState,
  plan: RunPlan,
): { state: RoundState; dropped: ClockId[]; droppedRunning: boolean } {
  const fresh = initialState(plan);
  const clocks: Record<ClockId, ClockRec> = {};
  for (const id of Object.keys(fresh.clocks)) {
    const base = fresh.clocks[id];
    if (!base) continue;
    const old = prev.clocks[id];
    clocks[id] = old ? { allottedMs: base.allottedMs, consumedMs: old.consumedMs } : base;
  }
  const dropped = Object.keys(prev.clocks).filter((id) => !(id in clocks));
  const runningIds = [prev.run?.clockId, prev.coRun?.clockId].filter(
    (id): id is ClockId => typeof id === 'string',
  );
  const droppedRunning = runningIds.some((id) => dropped.includes(id));

  const cuesFired: Record<string, true> = {};
  for (const key of Object.keys(prev.cuesFired)) {
    const at = key.lastIndexOf('@');
    if (at > 0 && key.slice(0, at) in clocks) cuesFired[key] = true;
  }

  return {
    state: {
      ...prev,
      configHash: plan.hash,
      cursor: Math.min(prev.cursor, plan.segments.length),
      clocks,
      run: droppedRunning ? null : prev.run,
      coRun: prev.coRun && dropped.includes(prev.coRun.clockId) ? null : prev.coRun,
      hold: prev.hold || droppedRunning,
      cuesFired,
      log: prev.log.filter((r) => r.clockId in clocks),
      undo: [],
      redo: [],
    },
    dropped,
    droppedRunning,
  };
}
