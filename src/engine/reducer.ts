/**
 * The transport reducer: pure `(RoundState, Command) => RoundState`, given a plan and an
 * instant. Exhaustive over §6.2.
 *
 * Two rules hold everywhere in this file:
 *   1. Every path that starts a clock goes through `anchor()`, which folds first — so two
 *      simultaneous anchors cannot arise by accident (Unity bug #4). The single deliberate
 *      exception is free debate with `rules.freeDebateExclusive === false`, which passes
 *      `{ concurrent: true }` explicitly.
 *   2. Nothing here inspects `remaining` to decide what a control may do. A clock at or
 *      past zero keeps counting up and every command stays live (Unity bugs #3 and #14);
 *      the operator decides when a speech is over, not the clock.
 */

import type { SideId } from '../domain/config';
import type { Now } from './chronometer';
import {
  addRemaining,
  anchor,
  anchorRound,
  fold,
  foldAll,
  foldRound,
  isRunning,
  now as readNow,
  runningClockIds,
  setClock,
} from './chronometer';
import { clearClockCues, reArm } from './cues';
import {
  canSwap,
  clockIdsOf,
  currentPlanSegment,
  planSegmentAt,
  primaryClockId,
  roundPhase,
  segmentClockIds,
} from './selectors';
import type {
  ClockId,
  Command,
  RoundState,
  RunPlan,
  SegmentResult,
  UndoEntry,
} from './state';
import { ROUND_CLOCK, UNDO_DEPTH, chessClockId } from './state';

export interface ReduceCtx {
  plan: RunPlan;
  now: Now;
}

const other = (side: SideId): SideId => (side === 'A' ? 'B' : 'A');

/* ----------------------------------------------------------------- fragments */

/** Upsert this segment's rows. Re-entering a segment updates its row, never duplicates it. */
function writeResults(s: RoundState, plan: RunPlan, index: number): RoundState {
  const ps = planSegmentAt(plan, index);
  if (!ps) return s;
  const ids = clockIdsOf(ps);
  const rows: SegmentResult[] = [];
  for (const clockId of ids) {
    const rec = s.clocks[clockId];
    if (!rec) continue;
    rows.push({
      segId: ps.segId,
      clockId,
      allottedMs: rec.allottedMs,
      usedMs: rec.consumedMs,
      overMs: Math.max(0, rec.consumedMs - rec.allottedMs),
    });
  }
  if (rows.length === 0) return s;

  const order = new Map<ClockId, number>();
  for (const p of plan.segments) {
    p.clockIds.forEach((id, i) => order.set(id, p.index * 16 + i));
  }
  const log = [...s.log.filter((r) => !ids.includes(r.clockId)), ...rows].sort(
    (a, b) => (order.get(a.clockId) ?? 0) - (order.get(b.clockId) ?? 0),
  );
  return { ...s, log };
}

/** Anchor the clock the transport acts on. Never called by ADVANCE unless asked. */
function startPrimary(s: RoundState, plan: RunPlan, n: Now): RoundState {
  if (s.bankDraw) {
    const id = plan.banks[s.bankDraw.side]?.id;
    return id ? anchor(s, id, n) : s;
  }
  const ps = currentPlanSegment(s, plan);
  if (!ps) return s;

  if (ps.segment.kind === 'chess') {
    const first = ps.segment.firstFloor;
    // `firstFloor: 'operator'` means START stays inert until ←/→ picks a side.
    const floor = s.floor ?? (first === 'operator' ? null : first);
    if (!floor) return s;
    return anchor({ ...s, floor }, chessClockId(ps.segId, floor), n);
  }

  return anchor(s, ps.primaryClockId, n);
}

/**
 * Leave the current segment and arm `index`. Never resets a clock: a segment re-entered
 * by PREV or by a pip resumes at its remembered remaining (Unity bugs #11 and #12).
 */
function enterSegment(
  s: RoundState,
  plan: RunPlan,
  index: number,
  n: Now,
  start: boolean,
): RoundState {
  let next = fold(s, n);
  if (s.cursor >= 0 && s.cursor < plan.segments.length) {
    next = writeResults(next, plan, s.cursor);
  }
  next = { ...next, cursor: index, floor: null, bankDraw: null };
  next = index >= 0 ? anchorRound(next, n) : foldRound(next, n);

  // Re-arm the incoming ladder against the remembered remaining, so a rewound segment
  // rings its bells again on the way back down.
  for (const id of clockIdsOf(planSegmentAt(plan, index))) {
    next = reArm(next, plan, id, n);
  }
  return start ? startPrimary(next, plan, n) : next;
}

/** Stop EVERY clock, round clock included. The original left them running behind the end
 *  screen with no code path that ever hid it (Unity bug #23). */
function completeRound(s: RoundState, plan: RunPlan, n: Now): RoundState {
  let next = foldAll(s, n);
  if (s.cursor >= 0 && s.cursor < plan.segments.length) {
    next = writeResults(next, plan, s.cursor);
  }
  return { ...next, cursor: plan.segments.length, floor: null, bankDraw: null };
}

/** Hand the floor to `side`, resuming it from where it froze. Works from any state and in
 *  both directions, including when either side is at or past zero. */
function giveFloor(s: RoundState, plan: RunPlan, side: SideId, n: Now): RoundState {
  const ps = currentPlanSegment(s, plan);
  if (!ps || ps.kind !== 'chess') return s;
  const incoming = chessClockId(ps.segId, side);
  const outgoing = chessClockId(ps.segId, other(side));
  const wasLive = isRunning(s, incoming) || isRunning(s, outgoing);

  if (s.floor === side && (!wasLive || isRunning(s, incoming))) return s;
  const withFloor: RoundState = { ...s, floor: side };
  if (!wasLive) return withFloor; // arming only; Space still starts the clock
  return anchor(withFloor, incoming, n, { concurrent: !plan.freeDebateExclusive });
}

/* ------------------------------------------------------------------- reducer */

function apply(s: RoundState, cmd: Command, ctx: ReduceCtx): RoundState {
  const { plan, now: n } = ctx;
  const segCount = plan.segments.length;

  // A held round accepts nothing but its own release and the reconcile answer (§6.4).
  if (s.hold && cmd.t !== 'RELEASE' && cmd.t !== 'RECONCILE' && cmd.t !== 'HOLD') return s;

  switch (cmd.t) {
    case 'LOAD': {
      const target = Math.max(-1, Math.min(segCount, Math.trunc(cmd.cursor)));
      const start = cmd.start === true;
      if (target === s.cursor && !start) return s;
      if (target >= segCount) return completeRound(s, plan, n);
      return enterSegment(s, plan, target, n, start);
    }

    case 'START':
    case 'RESUME': {
      if (roundPhase(s, plan) !== 'in') return s;
      const id = primaryClockId(s, plan);
      if (id && isRunning(s, id)) return s;
      return startPrimary(s, plan, n);
    }

    case 'PAUSE':
      return fold(s, n); // the round clock keeps accruing; only HOLD stops it

    case 'TOGGLE': {
      const phase = roundPhase(s, plan);
      if (phase === 'pre') return enterSegment(s, plan, 0, n, plan.advanceStartsClock);
      if (phase === 'complete') return s;
      // Start, pause and resume, in every kind of segment. In free debate that pauses
      // whichever side is running and resumes the side holding the floor, which stays
      // where it was. Handing the floor over is GIVE_FLOOR and SWAP, on keys of their own.
      return runningClockIds(s).length > 0 ? fold(s, n) : startPrimary(s, plan, n);
    }

    case 'ADVANCE': {
      if (s.cursor >= segCount) return s;
      const target = s.cursor + 1;
      if (target >= segCount) return completeRound(s, plan, n);
      return enterSegment(s, plan, target, n, cmd.start ?? plan.advanceStartsClock);
    }

    case 'PREV': {
      const from = Math.min(s.cursor, segCount);
      if (from <= 0) return s;
      return enterSegment(s, plan, from - 1, n, false);
    }

    case 'RESET_SEGMENT': {
      const ids = segmentClockIds(s, plan);
      if (ids.length === 0) return s;
      let next = fold(s, n);
      for (const id of ids) {
        // "Full time" means the planned allotment, so a live ADJUST is undone too.
        const planned = plan.clocks[id]?.allottedMs;
        next = setClock(next, id, {
          consumedMs: 0,
          ...(planned === undefined ? {} : { allottedMs: planned }),
        });
      }
      return { ...clearClockCues(next, ids), floor: null };
    }

    case 'ADJUST': {
      if (cmd.deltaMs === 0) return s;
      const id = primaryClockId(s, plan);
      if (!id) return s;
      return reArm(addRemaining(s, id, cmd.deltaMs), plan, id, n);
    }

    case 'GIVE_FLOOR':
      return giveFloor(s, plan, cmd.side, n);

    case 'SWAP': {
      // SWAP hands the floor from the running side to the other, and is defined ONLY when
      // exactly one side is running. That restriction is the original's deliberate design,
      // not the dead end it looks like: with neither or both live the command is inert and
      // the UI hides the control (see `canSwap`), so it never renders as a control that
      // silently does nothing. Opening a segment is `GIVE_FLOOR`/START, not SWAP.
      if (!canSwap(s, plan)) return s;
      const ps = currentPlanSegment(s, plan);
      if (!ps) return s;
      const liveA = isRunning(s, chessClockId(ps.segId, 'A'));
      return giveFloor(s, plan, liveA ? 'B' : 'A', n);
    }

    case 'HOLD': {
      if (s.hold) {
        return cmd.sleep ? { ...s, sleepPending: cmd.sleep } : s;
      }
      const running = runningClockIds(s);
      const roundHeld = s.roundRun !== null;
      return {
        ...foldAll(s, n),
        hold: true,
        resumeOnRelease: running,
        roundHeld,
        sleepPending: cmd.sleep ?? s.sleepPending,
      };
    }

    case 'RELEASE': {
      if (!s.hold) return s;
      let next: RoundState = { ...s, hold: false, resumeOnRelease: [], roundHeld: false };
      // Re-anchor back-to-front so the primary anchor ends up primary again.
      for (let i = s.resumeOnRelease.length - 1; i >= 0; i -= 1) {
        const id = s.resumeOnRelease[i];
        if (!id) continue;
        next = anchor(next, id, n, { concurrent: i < s.resumeOnRelease.length - 1 });
      }
      if (s.roundHeld) next = anchorRound(next, n);
      return next;
    }

    case 'BANK_DRAW': {
      const id = plan.banks[cmd.side]?.id;
      if (!id) return s;
      if (s.bankDraw?.side === cmd.side) return apply(s, { t: 'BANK_END' }, ctx);
      const base = s.bankDraw ? apply(s, { t: 'BANK_END' }, ctx) : s;
      const resumeClockId = base.run?.clockId ?? null;
      return {
        ...anchor(base, id, n),
        bankDraw: { side: cmd.side, resumeAfter: resumeClockId !== null, resumeClockId },
      };
    }

    case 'BANK_END': {
      const draw = s.bankDraw;
      if (!draw) return s;
      // The bank's own `consumedMs` IS the balance, so folding writes it back; a bank
      // decrements across the whole round and never resets (§7.35).
      const folded: RoundState = { ...fold(s, n), bankDraw: null };
      return draw.resumeAfter && draw.resumeClockId
        ? anchor(folded, draw.resumeClockId, n)
        : folded;
    }

    case 'RECONCILE': {
      const pending = s.sleepPending;
      if (!pending) return s;
      if (!cmd.charge) return { ...s, sleepPending: null };
      let next = s;
      if (pending.clockId !== ROUND_CLOCK) {
        next = addRemaining(next, pending.clockId, -pending.gapMs);
      }
      return {
        ...next,
        roundConsumedMs: Math.max(0, next.roundConsumedMs + pending.gapMs),
        sleepPending: null,
      };
    }

    case 'END_ROUND':
      return s.cursor >= segCount ? s : completeRound(s, plan, n);

    case 'UNDO':
    case 'REDO':
      return s; // handled by `reduce`, before the state is touched

    default: {
      const never: never = cmd;
      return never;
    }
  }
}

/* ---------------------------------------------------------------------- undo */

function snapshot(s: RoundState, cmd: Command, n: Now): UndoEntry {
  const running = runningClockIds(s);
  const roundRunning = s.roundRun !== null;
  const { undo: _undo, redo: _redo, ...prev } = foldAll(s, n);
  return { cmd, prev, running, roundRunning };
}

function restore(
  entry: UndoEntry,
  n: Now,
  undo: UndoEntry[],
  redo: UndoEntry[],
): RoundState {
  let out: RoundState = { ...entry.prev, undo, redo };
  for (let i = entry.running.length - 1; i >= 0; i -= 1) {
    const id = entry.running[i];
    if (!id) continue;
    out = anchor(out, id, n, { concurrent: i < entry.running.length - 1 });
  }
  return entry.roundRunning ? anchorRound(out, n) : out;
}

/**
 * Undo restores the folded state as it stood when the command ran and re-anchors what was
 * running AT THE CURRENT INSTANT — so undoing a mistaken ADVANCE three seconds later does
 * not silently bill those three seconds to the speaker who was interrupted.
 */
export function reduce(s: RoundState, cmd: Command, ctx: ReduceCtx): RoundState {
  if (cmd.t === 'UNDO') {
    const entry = s.undo[s.undo.length - 1];
    if (!entry) return s;
    const redoEntry = snapshot(s, entry.cmd, ctx.now);
    return restore(
      entry,
      ctx.now,
      s.undo.slice(0, -1),
      [...s.redo, redoEntry].slice(-UNDO_DEPTH),
    );
  }
  if (cmd.t === 'REDO') {
    const entry = s.redo[s.redo.length - 1];
    if (!entry) return s;
    const undoEntry = snapshot(s, entry.cmd, ctx.now);
    return restore(
      entry,
      ctx.now,
      [...s.undo, undoEntry].slice(-UNDO_DEPTH),
      s.redo.slice(0, -1),
    );
  }

  const next = apply(s, cmd, ctx);
  if (next === s) return s; // a no-op never fills the undo stack
  return {
    ...next,
    undo: [...s.undo, snapshot(s, cmd, ctx.now)].slice(-UNDO_DEPTH),
    redo: [],
  };
}

/**
 * Store-facing convenience: the same pure reduction with the instant read for you.
 * `reduce` remains the pure form — pass an explicit `Now` to replay a recorded timeline
 * or to drive a test without touching the wall clock.
 */
export function reducer(
  s: RoundState,
  cmd: Command,
  plan: RunPlan,
  n: Now = readNow(),
): RoundState {
  return reduce(s, cmd, { plan, now: n });
}
