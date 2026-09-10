import { describe, expect, it } from 'vitest';
import type { Now } from './chronometer';
import {
  addRemaining,
  anchor,
  anchorOf,
  anchorRound,
  elapsedMs,
  fold,
  foldAll,
  foldClock,
  foldRound,
  isRunning,
  liveMs,
  makeAnchor,
  nowFrom,
  overtimeMs,
  remainingMs,
  roundElapsedMs,
  runningClockIds,
  setClock,
} from './chronometer';
import type { ClockId, ClockRec, RoundState } from './state';
import { ROUND_CLOCK, transportOf } from './state';

/** A document whose `performance.now()` origin sits 1_700_000_000_000ms before the epoch. */
const T0 = 1_700_000_000_000;
const at = (mono: number): Now => nowFrom(mono, T0 + mono);

function mkState(
  allotted: Record<ClockId, number>,
  over: Partial<RoundState> = {},
): RoundState {
  const clocks: Record<ClockId, ClockRec> = {};
  for (const [id, ms] of Object.entries(allotted)) {
    clocks[id] = { allottedMs: ms, consumedMs: 0 };
  }
  return {
    configHash: 'hash0000',
    cursor: 0,
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
    ...over,
  };
}

const rec = (s: RoundState, id: ClockId): ClockRec => {
  const r = s.clocks[id];
  if (!r) throw new Error(`no clock ${id}`);
  return r;
};

describe('derivation from anchors', () => {
  it('burns nothing while armed and derives elapsed only from the anchor', () => {
    const s = mkState({ a: 180_000 });
    expect(elapsedMs(s, 'a', at(600_000))).toBe(0);
    expect(remainingMs(s, 'a', at(600_000))).toBe(180_000);
    expect(transportOf(s, 'a')).toBe('armed');

    const running = anchor(s, 'a', at(1_000));
    expect(transportOf(running, 'a')).toBe('running');
    expect(elapsedMs(running, 'a', at(31_000))).toBe(30_000);
    expect(remainingMs(running, 'a', at(31_000))).toBe(150_000);
    // Reading twice at the same instant is the same number; nothing accumulates.
    expect(elapsedMs(running, 'a', at(31_000))).toBe(30_000);
    expect(rec(running, 'a').consumedMs).toBe(0);
  });

  it('records the epoch, the mono and the skew at start', () => {
    const a = makeAnchor('a', at(2_500));
    expect(a).toEqual({
      clockId: 'a',
      startedAtEpoch: T0 + 2_500,
      startedAtMono: 2_500,
      skewAtStart: T0,
    });
  });

  it('is forward-only: a mono that steps backwards yields 0, never a negative', () => {
    const a = makeAnchor('a', at(10_000));
    expect(liveMs(a, at(10_000))).toBe(0);
    expect(liveMs(a, nowFrom(9_000, T0 + 9_000))).toBe(0);
    expect(liveMs(null, at(10_000))).toBe(0);

    const s = anchor(mkState({ a: 180_000 }), 'a', at(10_000));
    expect(elapsedMs(s, 'a', nowFrom(4_000, T0 + 4_000))).toBe(0);
    expect(remainingMs(s, 'a', nowFrom(4_000, T0 + 4_000))).toBe(180_000);
  });

  it('reports 0 for a clock that does not exist rather than throwing', () => {
    const s = mkState({ a: 180_000 });
    expect(elapsedMs(s, 'ghost', at(5_000))).toBe(0);
    expect(remainingMs(s, 'ghost', at(5_000))).toBe(0);
    expect(anchorOf(s, 'ghost')).toBeNull();
    expect(anchor(s, 'ghost', at(5_000))).toBe(s);
    expect(setClock(s, 'ghost', { allottedMs: 1 })).toBe(s);
  });
});

describe('pause / resume conservation', () => {
  it('conserves elapsed to the millisecond across a pause and a resume', () => {
    let s = anchor(mkState({ a: 180_000 }), 'a', at(1_000));
    s = foldClock(s, 'a', at(4_000.75));
    expect(rec(s, 'a').consumedMs).toBeCloseTo(3_000.75, 9);
    expect(s.run).toBeNull();
    expect(transportOf(s, 'a')).toBe('paused');

    // A paused clock burns nothing, no matter how long the pause lasts.
    expect(elapsedMs(s, 'a', at(4_000.75))).toBeCloseTo(3_000.75, 9);
    expect(elapsedMs(s, 'a', at(9_999_999))).toBeCloseTo(3_000.75, 9);

    s = anchor(s, 'a', at(10_000.5));
    expect(elapsedMs(s, 'a', at(12_500.25))).toBeCloseTo(5_500.5, 9);
    expect(remainingMs(s, 'a', at(12_500.25))).toBeCloseTo(174_499.5, 9);
  });

  it('loses nothing over many pause/resume cycles', () => {
    let s = mkState({ a: 300_000 });
    let t = 0;
    let expected = 0;
    for (let i = 0; i < 20; i++) {
      s = anchor(s, 'a', at(t));
      t += 137.5; // a run leg
      expected += 137.5;
      s = foldClock(s, 'a', at(t));
      t += 9_000; // an arbitrarily long pause, billed to nobody
    }
    expect(rec(s, 'a').consumedMs).toBeCloseTo(expected, 9);
    expect(remainingMs(s, 'a', at(t + 60_000))).toBeCloseTo(300_000 - expected, 9);
  });

  it('re-anchoring a running clock keeps the time it has already run', () => {
    let s = anchor(mkState({ a: 180_000 }), 'a', at(0));
    s = anchor(s, 'a', at(5_000)); // e.g. a redundant START
    expect(rec(s, 'a').consumedMs).toBe(5_000);
    expect(elapsedMs(s, 'a', at(8_000))).toBe(8_000);
  });
});

describe('overtime', () => {
  it('lets remaining go negative instead of clamping at zero', () => {
    const s = anchor(mkState({ a: 20_000 }), 'a', at(0));
    expect(remainingMs(s, 'a', at(20_000))).toBe(0);
    expect(remainingMs(s, 'a', at(20_001))).toBe(-1);
    expect(remainingMs(s, 'a', at(35_000))).toBe(-15_000);
    expect(remainingMs(s, 'a', at(600_000))).toBe(-580_000);
    expect(elapsedMs(s, 'a', at(600_000))).toBe(600_000);
  });

  it('reports overtime as a positive magnitude, 0 while time remains', () => {
    const s = anchor(mkState({ a: 20_000 }), 'a', at(0));
    expect(overtimeMs(s, 'a', at(19_999))).toBe(0);
    expect(overtimeMs(s, 'a', at(20_000))).toBe(0);
    expect(overtimeMs(s, 'a', at(20_500))).toBe(500);
    expect(overtimeMs(s, 'a', at(35_000))).toBe(15_000);
  });

  it('stays negative once paused in overtime', () => {
    let s = anchor(mkState({ a: 20_000 }), 'a', at(0));
    s = foldClock(s, 'a', at(35_000));
    expect(remainingMs(s, 'a', at(35_000))).toBe(-15_000);
    expect(remainingMs(s, 'a', at(999_000))).toBe(-15_000);
    expect(transportOf(s, 'a')).toBe('paused');
  });
});

describe('anchor folds first — two simultaneous clocks are unreachable', () => {
  it('stops the incumbent when a second clock starts', () => {
    let s = anchor(mkState({ a: 180_000, b: 180_000 }), 'a', at(0));
    s = anchor(s, 'b', at(5_000));

    expect(s.run?.clockId).toBe('b');
    expect(s.coRun).toBeNull();
    expect(runningClockIds(s)).toEqual(['b']);
    expect(isRunning(s, 'a')).toBe(false);
    expect(rec(s, 'a').consumedMs).toBe(5_000);
    // 'a' is frozen at the handover instant, not still burning.
    expect(elapsedMs(s, 'a', at(60_000))).toBe(5_000);
    expect(elapsedMs(s, 'b', at(60_000))).toBe(55_000);
  });

  it('never holds more than one anchor however many clocks are started', () => {
    let s = mkState({ a: 60_000, b: 60_000, c: 60_000, d: 60_000 });
    const order: ClockId[] = ['a', 'b', 'c', 'd', 'a', 'c', 'b'];
    order.forEach((id, i) => {
      s = anchor(s, id, at(i * 1_000));
      expect(runningClockIds(s)).toHaveLength(1);
      expect(s.coRun).toBeNull();
      expect(s.run?.clockId).toBe(id);
    });
    // Every millisecond went somewhere: 6 handovers of 1s each.
    const total = Object.keys(s.clocks).reduce(
      (sum, id) => sum + rec(s, id).consumedMs,
      0,
    );
    expect(total).toBe(6_000);
  });

  it('fold stops everything and foldClock stops exactly one', () => {
    let s = anchor(mkState({ a: 180_000, b: 180_000 }), 'a', at(0));
    const stopped = fold(s, at(4_000));
    expect(stopped.run).toBeNull();
    expect(stopped.coRun).toBeNull();
    expect(rec(stopped, 'a').consumedMs).toBe(4_000);
    expect(fold(stopped, at(9_000))).toBe(stopped); // nothing running: identity

    s = anchor(s, 'b', at(4_000));
    const one = foldClock(s, 'a', at(9_000)); // 'a' is not running any more
    expect(one).toBe(s);
    expect(foldClock(s, 'b', at(9_000)).run).toBeNull();
  });
});

describe('the deliberate concurrent exception', () => {
  it('keeps the incumbent alive only when concurrent is passed', () => {
    let s = anchor(mkState({ a: 240_000, b: 240_000 }), 'a', at(0));
    s = anchor(s, 'b', at(5_000), { concurrent: true });

    expect(s.run?.clockId).toBe('b');
    expect(s.coRun?.clockId).toBe('a');
    expect(runningClockIds(s)).toEqual(['b', 'a']); // primary first
    expect(isRunning(s, 'a')).toBe(true);
    expect(elapsedMs(s, 'a', at(10_000))).toBe(10_000);
    expect(elapsedMs(s, 'b', at(10_000))).toBe(5_000);
  });

  it('promotes rather than re-anchors a clock that is already the co-runner', () => {
    let s = anchor(mkState({ a: 240_000, b: 240_000 }), 'a', at(0));
    s = anchor(s, 'b', at(5_000), { concurrent: true });
    s = anchor(s, 'a', at(9_000), { concurrent: true });

    expect(s.run?.clockId).toBe('a');
    expect(s.coRun?.clockId).toBe('b');
    // Neither clock lost or gained time in the swap.
    expect(elapsedMs(s, 'a', at(9_000))).toBe(9_000);
    expect(elapsedMs(s, 'b', at(9_000))).toBe(4_000);
  });

  it('caps at two anchors: a third concurrent start folds the co-runner', () => {
    let s = anchor(mkState({ a: 60_000, b: 60_000, c: 60_000 }), 'a', at(0));
    s = anchor(s, 'b', at(1_000), { concurrent: true });
    s = anchor(s, 'c', at(3_000), { concurrent: true });

    expect(runningClockIds(s)).toEqual(['c', 'b']);
    expect(isRunning(s, 'a')).toBe(false);
    expect(rec(s, 'a').consumedMs).toBe(3_000);
  });

  it('promotes the co-runner so it never outlives the primary', () => {
    let s = anchor(mkState({ a: 240_000, b: 240_000 }), 'a', at(0));
    s = anchor(s, 'b', at(5_000), { concurrent: true });
    s = foldClock(s, 'b', at(9_000));

    expect(s.run?.clockId).toBe('a');
    expect(s.coRun).toBeNull();
    expect(rec(s, 'b').consumedMs).toBe(4_000);
    expect(elapsedMs(s, 'a', at(12_000))).toBe(12_000);
  });

  it('a non-concurrent anchor collapses both anchors', () => {
    let s = anchor(mkState({ a: 240_000, b: 240_000, c: 60_000 }), 'a', at(0));
    s = anchor(s, 'b', at(5_000), { concurrent: true });
    s = anchor(s, 'c', at(11_000));

    expect(runningClockIds(s)).toEqual(['c']);
    expect(rec(s, 'a').consumedMs).toBe(11_000);
    expect(rec(s, 'b').consumedMs).toBe(6_000);
  });
});

describe('clock edits', () => {
  it('addRemaining moves remaining by exactly deltaMs whatever the transport', () => {
    const armed = mkState({ a: 180_000 });
    expect(remainingMs(addRemaining(armed, 'a', 15_000), 'a', at(0))).toBe(195_000);
    expect(remainingMs(addRemaining(armed, 'a', -15_000), 'a', at(0))).toBe(165_000);

    const running = anchor(armed, 'a', at(0));
    const bumped = addRemaining(running, 'a', 15_000);
    expect(remainingMs(bumped, 'a', at(30_000))).toBe(165_000);
    expect(isRunning(bumped, 'a')).toBe(true);
  });

  it('addRemaining pulls a clock out of overtime by exactly deltaMs', () => {
    let s = anchor(mkState({ a: 20_000 }), 'a', at(0));
    s = foldClock(s, 'a', at(35_000)); // remaining −15s
    s = addRemaining(s, 'a', 15_000);
    expect(remainingMs(s, 'a', at(35_000))).toBe(0);
    expect(rec(s, 'a').consumedMs).toBe(20_000);

    s = addRemaining(s, 'a', 30_000);
    expect(remainingMs(s, 'a', at(35_000))).toBe(30_000);
    expect(rec(s, 'a').consumedMs).toBe(0); // consumed is spent down first, clamped at 0
    expect(rec(s, 'a').allottedMs).toBe(30_000);
  });

  it('is an identity for a zero delta or an unknown clock', () => {
    const s = mkState({ a: 180_000 });
    expect(addRemaining(s, 'a', 0)).toBe(s);
    expect(addRemaining(s, 'ghost', 5_000)).toBe(s);
  });
});

describe('the round clock', () => {
  it('runs on its own anchor and excludes stopped stretches', () => {
    let s = anchorRound(mkState({ a: 180_000 }), at(1_000));
    expect(s.roundRun?.clockId).toBe(ROUND_CLOCK);
    expect(s.roundStartedAtEpoch).toBe(T0 + 1_000);
    expect(roundElapsedMs(s, at(31_000))).toBe(30_000);

    const again = anchorRound(s, at(20_000)); // idempotent while already running
    expect(again).toBe(s);

    s = foldRound(s, at(31_000));
    expect(roundElapsedMs(s, at(999_000))).toBe(30_000);

    s = anchorRound(s, at(100_000));
    expect(s.roundStartedAtEpoch).toBe(T0 + 1_000); // the original start survives a hold
    expect(roundElapsedMs(s, at(110_000))).toBe(40_000);
    expect(foldRound(foldRound(s, at(110_000)), at(900_000)).roundConsumedMs).toBe(40_000);
  });

  it('foldAll freezes the segment clocks and the round clock together', () => {
    let s = anchorRound(mkState({ a: 180_000 }), at(0));
    s = anchor(s, 'a', at(0));
    s = foldAll(s, at(12_000));

    expect(s.run).toBeNull();
    expect(s.coRun).toBeNull();
    expect(s.roundRun).toBeNull();
    expect(rec(s, 'a').consumedMs).toBe(12_000);
    expect(roundElapsedMs(s, at(500_000))).toBe(12_000);
  });
});
