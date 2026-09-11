/**
 * §6.2 transition table, end to end, plus the four behaviours the Unity original got
 * wrong: ADVANCE arms rather than starts, PREV resumes the remembered remaining, the end
 * of the round stops every clock, and nothing is disabled in overtime.
 *
 * Every instant is injected. No test reads the wall clock except the one that deliberately
 * exercises the store-facing `reducer(s, cmd, plan)` form under fake timers.
 */

import { describe, expect, it, vi } from 'vitest';
import type { RoundConfig, Rules } from '../domain/config';
import { SCHEMA_VERSION, defaultRules } from '../domain/config';
import type { RunPlan } from '../domain/plan';
import { plan } from '../domain/plan';
import type { Now } from './chronometer';
import { elapsedMs, isRunning, now, nowFrom, remainingMs, roundElapsedMs } from './chronometer';
import { evaluateCues, markFired } from './cues';
import { reduce, reducer } from './reducer';
import { bankRemaining, primaryClockId, roundPhase } from './selectors';
import type { ClockId, Command, RoundState } from './state';
import { initialState, transportOf } from './state';

const T0 = 1_700_000_000_000;

/** Monotonic and wall time advance together — a plain, un-suspended machine. */
const at = (ms: number): Now => nowFrom(ms, T0 + ms);

const SP1 = 'sp1'; // speech, 3:00
const SP2 = 'sp2'; // speech, 0:20 — short enough to overrun inside a test
const FD1 = 'fd1'; // free debate, 0:30 per side
const BR1 = 'br1'; // break, 1:00
const FD_A: ClockId = 'fd1:A';
const FD_B: ClockId = 'fd1:B';
const BANK_A: ClockId = 'bank:A';

function makeConfig(rules: Partial<Rules> = {}): RoundConfig {
  return {
    v: SCHEMA_VERSION,
    id: 'cfgtest1',
    title: { en: 'Test round', zh: '测试' },
    sides: [
      { id: 'A', label: { en: 'Prop', zh: '正方' }, color: '#E69F00', prepBankMs: 60_000 },
      { id: 'B', label: { en: 'Opp', zh: '反方' }, color: '#0072B2', prepBankMs: 60_000 },
    ],
    speakers: [
      { id: 'spkA1', side: 'A', name: 'A1', defaultMs: 180_000 },
      { id: 'spkB1', side: 'B', name: 'B1', defaultMs: 180_000 },
    ],
    segments: [
      { id: SP1, kind: 'speech', speakerId: 'spkA1', allottedMs: 180_000 },
      { id: SP2, kind: 'speech', speakerId: 'spkB1', allottedMs: 20_000 },
      {
        id: FD1,
        kind: 'chess',
        label: { en: 'Free debate', zh: '自由辩论' },
        perSideMs: 30_000,
        firstFloor: 'A',
      },
      { id: BR1, kind: 'break', label: { en: 'Break', zh: '休息' }, allottedMs: 60_000 },
    ],
    rules: { ...defaultRules(), ...rules },
  };
}

interface Harness {
  plan: RunPlan;
  state: () => RoundState;
  set: (next: RoundState) => void;
  go: (cmd: Command, ms: number) => RoundState;
  rem: (clockId: ClockId, ms: number) => number;
  bank: (side: 'A' | 'B', ms: number) => number;
}

function harness(config: RoundConfig = makeConfig()): Harness {
  const p = plan(config);
  let s = initialState(p);
  return {
    plan: p,
    state: () => s,
    set: (next) => {
      s = next;
    },
    go: (cmd, ms) => {
      s = reduce(s, cmd, { plan: p, now: at(ms) });
      return s;
    },
    rem: (clockId, ms) => remainingMs(s, clockId, at(ms)),
    bank: (side, ms) => bankRemaining(s, p, side, at(ms)),
  };
}

/* ------------------------------------------------------- §6.2 transition table */

describe('§6.2 transition table', () => {
  it('PRE-ROUND + ADVANCE arms segment 0 and starts the round clock', () => {
    const h = harness();
    expect(roundPhase(h.state(), h.plan)).toBe('pre');

    h.go({ t: 'ADVANCE' }, 0);

    expect(h.state().cursor).toBe(0);
    expect(roundPhase(h.state(), h.plan)).toBe('in');
    expect(h.state().roundStartedAtEpoch).toBe(T0);
    expect(transportOf(h.state(), SP1)).toBe('armed');
    expect(isRunning(h.state(), SP1)).toBe(false);
    // The round clock runs from the first ADVANCE even though no speech clock does.
    expect(roundElapsedMs(h.state(), at(10_000))).toBe(10_000);
  });

  it('PRE-ROUND + LOAD arms the chosen pip, not segment 0', () => {
    const h = harness();
    h.go({ t: 'LOAD', cursor: 2 }, 0);
    expect(h.state().cursor).toBe(2);
    expect(h.state().roundStartedAtEpoch).toBe(T0);
    expect(isRunning(h.state(), FD_A)).toBe(false);
  });

  it('ARMED + START runs exactly one clock', () => {
    const h = harness();
    h.go({ t: 'ADVANCE' }, 0);
    h.go({ t: 'START' }, 1_000);

    expect(transportOf(h.state(), SP1)).toBe('running');
    expect(h.state().run?.clockId).toBe(SP1);
    expect(h.state().coRun).toBeNull();
    expect(h.rem(SP1, 31_000)).toBe(150_000);
  });

  it('ARMED + ADVANCE logs a 0:00 result for the skipped segment', () => {
    const h = harness();
    h.go({ t: 'ADVANCE' }, 0);
    h.go({ t: 'ADVANCE' }, 4_000);

    expect(h.state().cursor).toBe(1);
    expect(h.state().log).toEqual([
      { segId: SP1, clockId: SP1, allottedMs: 180_000, usedMs: 0, overMs: 0 },
    ]);
  });

  it('ARMED + PREV lands ARMED; a used segment lands PAUSED', () => {
    const h = harness();
    h.go({ t: 'ADVANCE' }, 0); // @0, untouched
    h.go({ t: 'ADVANCE' }, 0); // @1, untouched
    h.go({ t: 'PREV' }, 1_000);
    expect(h.state().cursor).toBe(0);
    expect(transportOf(h.state(), SP1)).toBe('armed');

    h.go({ t: 'START' }, 1_000);
    h.go({ t: 'ADVANCE' }, 61_000); // leaves @0 with 1:00 consumed
    h.go({ t: 'PREV' }, 61_000);
    expect(h.state().cursor).toBe(0);
    expect(transportOf(h.state(), SP1)).toBe('paused');
  });

  it('RUNNING + PAUSE folds the speech clock and leaves the round clock accruing', () => {
    const h = harness();
    h.go({ t: 'ADVANCE' }, 0);
    h.go({ t: 'START' }, 0);
    h.go({ t: 'PAUSE' }, 30_000);

    expect(transportOf(h.state(), SP1)).toBe('paused');
    expect(h.rem(SP1, 900_000)).toBe(150_000); // a paused clock burns nothing
    expect(h.state().roundRun).not.toBeNull();
    expect(roundElapsedMs(h.state(), at(90_000))).toBe(90_000);
  });

  it('RUNNING + ADVANCE folds, writes the result, and arms the next segment stopped', () => {
    const h = harness();
    h.go({ t: 'ADVANCE' }, 0);
    h.go({ t: 'START' }, 0);
    h.go({ t: 'ADVANCE' }, 40_000);

    expect(h.state().cursor).toBe(1);
    expect(h.state().run).toBeNull();
    expect(h.state().log).toEqual([
      { segId: SP1, clockId: SP1, allottedMs: 180_000, usedMs: 40_000, overMs: 0 },
    ]);
    expect(h.rem(SP2, 40_000)).toBe(20_000);
  });

  it('PAUSED + RESUME re-anchors and conserves the elapsed time exactly', () => {
    const h = harness();
    h.go({ t: 'ADVANCE' }, 0);
    h.go({ t: 'START' }, 0);
    h.go({ t: 'PAUSE' }, 30_000);
    h.go({ t: 'RESUME' }, 500_000);

    expect(transportOf(h.state(), SP1)).toBe('running');
    expect(h.rem(SP1, 530_000)).toBe(120_000);
    expect(elapsedMs(h.state(), SP1, at(530_000))).toBe(60_000);
  });

  it('RESET_SEGMENT returns the segment to ARMED at its planned allotment', () => {
    const h = harness();
    h.go({ t: 'LOAD', cursor: 1 }, 0);
    h.go({ t: 'START' }, 0);
    h.go({ t: 'PAUSE' }, 30_000);
    h.go({ t: 'ADJUST', deltaMs: 40_000 }, 30_000); // pushes allotted above plan
    expect(h.state().clocks[SP2]?.allottedMs).toBe(30_000);

    h.go({ t: 'RESET_SEGMENT' }, 30_000);

    expect(h.state().clocks[SP2]).toEqual({ allottedMs: 20_000, consumedMs: 0 });
    expect(transportOf(h.state(), SP2)).toBe('armed');
    expect(h.rem(SP2, 999_000)).toBe(20_000);
    expect(Object.keys(h.state().cuesFired)).toEqual([]);
  });

  it('ADJUST moves remaining by exactly the delta, armed or running', () => {
    const h = harness();
    h.go({ t: 'ADVANCE' }, 0);
    h.go({ t: 'ADJUST', deltaMs: 15_000 }, 0); // ARMED: consumedMs is 0, allotment grows
    expect(h.rem(SP1, 0)).toBe(195_000);

    h.go({ t: 'START' }, 0);
    h.go({ t: 'ADJUST', deltaMs: -15_000 }, 20_000);
    expect(h.rem(SP1, 20_000)).toBe(160_000);
    h.go({ t: 'ADJUST', deltaMs: 15_000 }, 20_000);
    expect(h.rem(SP1, 20_000)).toBe(175_000);
    expect(isRunning(h.state(), SP1)).toBe(true); // an adjust never stops the clock
  });

  it('HOLD freezes every clock and RELEASE re-anchors only what was RUNNING', () => {
    const h = harness();
    h.go({ t: 'ADVANCE' }, 0);
    h.go({ t: 'START' }, 0);
    h.go({ t: 'HOLD' }, 10_000);

    expect(h.state().hold).toBe(true);
    expect(h.state().run).toBeNull();
    expect(h.state().roundRun).toBeNull();
    expect(h.rem(SP1, 600_000)).toBe(170_000);
    expect(roundElapsedMs(h.state(), at(600_000))).toBe(10_000); // held time is not round time

    h.go({ t: 'RELEASE' }, 60_000);
    expect(h.state().hold).toBe(false);
    expect(transportOf(h.state(), SP1)).toBe('running');
    expect(h.rem(SP1, 70_000)).toBe(160_000);
    expect(roundElapsedMs(h.state(), at(70_000))).toBe(20_000);
  });

  it('a hold taken while PAUSED resumes nothing', () => {
    const h = harness();
    h.go({ t: 'ADVANCE' }, 0);
    h.go({ t: 'START' }, 0);
    h.go({ t: 'PAUSE' }, 10_000);
    h.go({ t: 'HOLD' }, 12_000);
    h.go({ t: 'RELEASE' }, 60_000);

    expect(transportOf(h.state(), SP1)).toBe('paused');
    expect(h.state().run).toBeNull();
    expect(h.state().roundRun).not.toBeNull(); // the round clock WAS running, so it resumes
  });

  it('a held round accepts nothing but RELEASE, RECONCILE and HOLD', () => {
    const h = harness();
    h.go({ t: 'ADVANCE' }, 0);
    h.go({ t: 'START' }, 0);
    const held = h.go({ t: 'HOLD' }, 10_000);

    const rejected: Command[] = [
      { t: 'ADVANCE' },
      { t: 'PREV' },
      { t: 'START' },
      { t: 'PAUSE' },
      { t: 'ADJUST', deltaMs: 15_000 },
      { t: 'LOAD', cursor: 2 },
      { t: 'BANK_DRAW', side: 'A' },
      { t: 'RESET_SEGMENT' },
      { t: 'END_ROUND' },
    ];
    for (const cmd of rejected) {
      expect(reduce(held, cmd, { plan: h.plan, now: at(20_000) })).toBe(held);
    }
  });

  it('RECONCILE bills the suspend gap to the clock that was running, or not', () => {
    const gap = { gapMs: 30_000, clockId: SP1 };
    const charged = harness();
    charged.go({ t: 'ADVANCE' }, 0);
    charged.go({ t: 'START' }, 0);
    charged.go({ t: 'HOLD', sleep: gap }, 10_000);
    charged.go({ t: 'RECONCILE', charge: true }, 10_000);
    expect(charged.rem(SP1, 10_000)).toBe(140_000); // 10s run + 30s suspended
    expect(charged.state().sleepPending).toBeNull();

    const uncharged = harness();
    uncharged.go({ t: 'ADVANCE' }, 0);
    uncharged.go({ t: 'START' }, 0);
    uncharged.go({ t: 'HOLD', sleep: gap }, 10_000);
    uncharged.go({ t: 'RECONCILE', charge: false }, 10_000);
    expect(uncharged.rem(SP1, 10_000)).toBe(170_000);
  });

  it('LOAD never resets: a re-entered segment resumes its remembered remaining', () => {
    const h = harness();
    h.go({ t: 'LOAD', cursor: 1 }, 0);
    h.go({ t: 'START' }, 0);
    h.go({ t: 'LOAD', cursor: 3 }, 8_000); // jump away mid-speech
    expect(h.rem(SP2, 60_000)).toBe(12_000);

    h.go({ t: 'LOAD', cursor: 1 }, 60_000);
    expect(h.state().cursor).toBe(1);
    expect(transportOf(h.state(), SP2)).toBe('paused');
    expect(h.rem(SP2, 60_000)).toBe(12_000);
  });

  it('COMPLETE + PREV restores the last segment at its remembered remaining', () => {
    const h = harness();
    h.go({ t: 'LOAD', cursor: 3 }, 0);
    h.go({ t: 'START' }, 0);
    h.go({ t: 'ADVANCE' }, 20_000); // past the last segment
    expect(roundPhase(h.state(), h.plan)).toBe('complete');

    h.go({ t: 'PREV' }, 30_000);
    expect(h.state().cursor).toBe(3);
    expect(transportOf(h.state(), BR1)).toBe('paused');
    expect(h.rem(BR1, 30_000)).toBe(40_000);
  });

  it('COMPLETE is re-enterable by pip; nothing about it is terminal', () => {
    const h = harness();
    h.go({ t: 'END_ROUND' }, 0);
    expect(roundPhase(h.state(), h.plan)).toBe('complete');

    h.go({ t: 'LOAD', cursor: 1 }, 5_000);
    expect(h.state().cursor).toBe(1);
    h.go({ t: 'START' }, 5_000);
    expect(transportOf(h.state(), SP2)).toBe('running');
  });

  it('UNDO restores the previous command state, including cuesFired', () => {
    const h = harness();
    h.go({ t: 'LOAD', cursor: 1 }, 0);
    h.go({ t: 'START' }, 0);
    h.set(markFired(h.state(), evaluateCues(h.state(), h.plan, at(25_000))));
    const firedBefore = Object.keys(h.state().cuesFired).sort();
    expect(firedBefore.length).toBeGreaterThan(0);

    h.go({ t: 'ADJUST', deltaMs: 70_000 }, 25_000); // rewinds above every threshold
    expect(Object.keys(h.state().cuesFired)).toEqual([]);

    h.go({ t: 'UNDO' }, 30_000);
    expect(Object.keys(h.state().cuesFired).sort()).toEqual(firedBefore);
    expect(h.rem(SP2, 30_000)).toBe(-5_000); // the adjust is gone too
    expect(h.state().redo.length).toBe(1);

    h.go({ t: 'REDO' }, 30_000);
    expect(Object.keys(h.state().cuesFired)).toEqual([]);
    expect(h.rem(SP2, 30_000)).toBe(60_000);
  });

  it('UNDO re-anchors at the current instant, never billing the delay to the speaker', () => {
    const h = harness();
    h.go({ t: 'ADVANCE' }, 0);
    h.go({ t: 'START' }, 0);
    h.go({ t: 'ADVANCE' }, 10_000); // the mis-press
    h.go({ t: 'UNDO' }, 13_000); // noticed three seconds later

    expect(h.state().cursor).toBe(0);
    expect(transportOf(h.state(), SP1)).toBe('running');
    expect(h.rem(SP1, 13_000)).toBe(170_000); // not 167_000
  });

  it('a no-op never touches the undo stack', () => {
    const h = harness();
    const before = h.go({ t: 'ADVANCE' }, 0);
    expect(h.go({ t: 'ADJUST', deltaMs: 0 }, 0)).toBe(before);
    expect(h.go({ t: 'PREV' }, 0)).toBe(before);
    expect(before.undo.length).toBe(1);
  });
});

/* ------------------------------------------------------------- arm vs. start */

describe('ADVANCE arms but does not start', () => {
  it('leaves the next segment stopped at its full time by default', () => {
    const h = harness();
    expect(h.plan.advanceStartsClock).toBe(false);

    h.go({ t: 'ADVANCE' }, 0);
    expect(isRunning(h.state(), SP1)).toBe(false);
    expect(h.rem(SP1, 120_000)).toBe(180_000); // two minutes of standing around cost nothing

    h.go({ t: 'ADVANCE' }, 120_000);
    expect(isRunning(h.state(), SP2)).toBe(false);
    expect(h.rem(SP2, 300_000)).toBe(20_000);

    h.go({ t: 'START' }, 300_000);
    expect(isRunning(h.state(), SP2)).toBe(true);
  });

  it('starts the clock when the operator has chosen advanceStartsClock', () => {
    const h = harness(makeConfig({ advanceStartsClock: true }));
    h.go({ t: 'ADVANCE' }, 0);
    expect(isRunning(h.state(), SP1)).toBe(true);
    expect(h.rem(SP1, 5_000)).toBe(175_000);

    h.go({ t: 'ADVANCE' }, 5_000);
    expect(isRunning(h.state(), SP2)).toBe(true);
  });

  it('an explicit start flag overrides the preference in both directions', () => {
    const armed = harness(makeConfig({ advanceStartsClock: true }));
    armed.go({ t: 'ADVANCE', start: false }, 0);
    expect(isRunning(armed.state(), SP1)).toBe(false);

    const started = harness();
    started.go({ t: 'ADVANCE', start: true }, 0);
    expect(isRunning(started.state(), SP1)).toBe(true);
  });
});

/* ------------------------------------------------------------ remembered time */

describe('PREV restores the remembered remaining', () => {
  it('returns a part-used segment at its remaining time, paused', () => {
    const h = harness();
    h.go({ t: 'ADVANCE' }, 0);
    h.go({ t: 'START' }, 0);
    h.go({ t: 'ADVANCE' }, 100_000); // 1:40 spent on segment 0
    h.go({ t: 'START' }, 100_000);
    h.go({ t: 'PREV' }, 105_000);

    expect(h.state().cursor).toBe(0);
    expect(h.rem(SP1, 105_000)).toBe(80_000);
    expect(h.rem(SP1, 900_000)).toBe(80_000); // and it stays put until resumed
    expect(transportOf(h.state(), SP1)).toBe('paused');
    expect(h.rem(SP2, 105_000)).toBe(15_000); // the segment we left keeps its own time
  });

  it('resumes from the remembered remaining rather than the full duration', () => {
    const h = harness();
    h.go({ t: 'ADVANCE' }, 0);
    h.go({ t: 'START' }, 0);
    h.go({ t: 'ADVANCE' }, 100_000);
    h.go({ t: 'PREV' }, 100_000);
    h.go({ t: 'START' }, 100_000);

    expect(h.rem(SP1, 110_000)).toBe(70_000);
  });

  it('rewinds a chess segment side by side, each at its own remaining', () => {
    const h = harness();
    h.go({ t: 'LOAD', cursor: 2 }, 0);
    h.go({ t: 'START' }, 0); // A takes the floor
    h.go({ t: 'SWAP' }, 12_000); // A has spent 12s
    h.go({ t: 'ADVANCE' }, 20_000); // B has spent 8s
    h.go({ t: 'PREV' }, 30_000);

    expect(h.state().cursor).toBe(2);
    expect(h.rem(FD_A, 30_000)).toBe(18_000);
    expect(h.rem(FD_B, 30_000)).toBe(22_000);
    expect(h.state().run).toBeNull();
    expect(h.state().floor).toBeNull();
  });
});

/* ------------------------------------------------------------ end of the round */

describe('ADVANCE at the last segment', () => {
  it('completes the round and stops every clock, round clock included', () => {
    const h = harness();
    h.go({ t: 'LOAD', cursor: 3 }, 0);
    h.go({ t: 'START' }, 0);
    h.go({ t: 'BANK_DRAW', side: 'A' }, 5_000); // a bank left running at the buzzer
    h.go({ t: 'ADVANCE' }, 15_000);

    const s = h.state();
    expect(s.cursor).toBe(4);
    expect(roundPhase(s, h.plan)).toBe('complete');
    expect(s.run).toBeNull();
    expect(s.coRun).toBeNull();
    expect(s.roundRun).toBeNull();
    expect(s.bankDraw).toBeNull();
    expect(s.floor).toBeNull();

    // Every readout is frozen ten minutes later.
    expect(h.rem(BR1, 600_000)).toBe(55_000);
    expect(h.bank('A', 600_000)).toBe(50_000);
    expect(roundElapsedMs(s, at(600_000))).toBe(15_000);
    for (const id of h.plan.clockIds) expect(isRunning(s, id)).toBe(false);
  });

  it('writes the final segment result on the way out', () => {
    const h = harness();
    h.go({ t: 'LOAD', cursor: 3 }, 0);
    h.go({ t: 'START' }, 0);
    h.go({ t: 'ADVANCE' }, 75_000);

    expect(h.state().log).toEqual([
      { segId: BR1, clockId: BR1, allottedMs: 60_000, usedMs: 75_000, overMs: 15_000 },
    ]);
  });

  it('writes one row per side when it leaves a free-debate segment', () => {
    const h = harness();
    h.go({ t: 'LOAD', cursor: 2 }, 0);
    h.go({ t: 'START' }, 0);
    h.go({ t: 'SWAP' }, 10_000);
    h.go({ t: 'ADVANCE' }, 45_000);

    expect(h.state().log).toEqual([
      { segId: FD1, clockId: FD_A, allottedMs: 30_000, usedMs: 10_000, overMs: 0 },
      { segId: FD1, clockId: FD_B, allottedMs: 30_000, usedMs: 35_000, overMs: 5_000 },
    ]);
  });
});

/* ------------------------------------------------------------------ prep bank */

describe('prep bank', () => {
  it('draws from the bank, folds the speech, and hands the floor back on BANK_END', () => {
    const h = harness();
    h.go({ t: 'ADVANCE' }, 0);
    h.go({ t: 'START' }, 0);
    h.go({ t: 'BANK_DRAW', side: 'A' }, 5_000);

    expect(h.state().bankDraw).toEqual({
      side: 'A',
      resumeAfter: true,
      resumeClockId: SP1,
    });
    expect(isRunning(h.state(), BANK_A)).toBe(true);
    expect(isRunning(h.state(), SP1)).toBe(false);
    expect(h.bank('A', 15_000)).toBe(50_000);
    expect(h.rem(SP1, 15_000)).toBe(175_000); // the speech is not billed for prep

    h.go({ t: 'BANK_END' }, 15_000);
    expect(h.state().bankDraw).toBeNull();
    expect(isRunning(h.state(), SP1)).toBe(true);
    expect(h.bank('A', 60_000)).toBe(50_000); // the balance stays where it stopped
    expect(h.rem(SP1, 20_000)).toBe(170_000);
  });

  it('decrements across the round and never resets', () => {
    const h = harness();
    h.go({ t: 'ADVANCE' }, 0);
    h.go({ t: 'BANK_DRAW', side: 'A' }, 0);
    h.go({ t: 'BANK_DRAW', side: 'A' }, 20_000); // the same key ends the draw
    expect(h.state().bankDraw).toBeNull();
    expect(h.bank('A', 20_000)).toBe(40_000);

    h.go({ t: 'ADVANCE' }, 20_000);
    h.go({ t: 'BANK_DRAW', side: 'A' }, 30_000);
    h.go({ t: 'BANK_END' }, 45_000);
    expect(h.bank('A', 45_000)).toBe(25_000);
  });

  it('keeps the two banks independent and drawing one ends the other', () => {
    const h = harness();
    h.go({ t: 'ADVANCE' }, 0);
    h.go({ t: 'BANK_DRAW', side: 'A' }, 0);
    h.go({ t: 'BANK_DRAW', side: 'B' }, 10_000);

    expect(h.state().bankDraw?.side).toBe('B');
    expect(isRunning(h.state(), BANK_A)).toBe(false);
    expect(h.bank('A', 30_000)).toBe(50_000);
    expect(h.bank('B', 30_000)).toBe(40_000);
  });

  it('UNDO restores both the balance and the prior transport', () => {
    const h = harness();
    h.go({ t: 'ADVANCE' }, 0);
    h.go({ t: 'START' }, 0);
    h.go({ t: 'BANK_DRAW', side: 'A' }, 5_000);
    h.go({ t: 'BANK_END' }, 15_000);
    expect(h.bank('A', 15_000)).toBe(50_000);

    h.go({ t: 'UNDO' }, 25_000); // un-end the draw: the bank is running again
    expect(h.state().bankDraw?.side).toBe('A');
    expect(isRunning(h.state(), BANK_A)).toBe(true);
    expect(isRunning(h.state(), SP1)).toBe(false);
    expect(h.bank('A', 30_000)).toBe(45_000);

    h.go({ t: 'UNDO' }, 30_000); // un-draw: balance whole, speech running again
    expect(h.state().bankDraw).toBeNull();
    expect(h.bank('A', 60_000)).toBe(60_000);
    expect(transportOf(h.state(), SP1)).toBe('running');
    expect(h.rem(SP1, 35_000)).toBe(170_000);
  });
});

/* ------------------------------------------------------------------- overtime */

describe('overtime', () => {
  it('counts up past zero and never clamps', () => {
    const h = harness();
    h.go({ t: 'LOAD', cursor: 1 }, 0);
    h.go({ t: 'START' }, 0);

    expect(h.rem(SP2, 20_000)).toBe(0);
    expect(h.rem(SP2, 35_000)).toBe(-15_000);
    expect(h.rem(SP2, 320_000)).toBe(-300_000); // past the overtime cap it still counts
    expect(elapsedMs(h.state(), SP2, at(35_000))).toBe(35_000);
    expect(isRunning(h.state(), SP2)).toBe(true);
  });

  it('leaves every transport control live', () => {
    const h = harness();
    h.go({ t: 'LOAD', cursor: 1 }, 0);
    h.go({ t: 'START' }, 0);
    const over = h.go({ t: 'PAUSE' }, 35_000); // deep in overtime
    expect(transportOf(over, SP2)).toBe('paused');

    const ctx = { plan: h.plan, now: at(35_000) };
    const running = reduce(over, { t: 'RESUME' }, ctx);
    expect(running).not.toBe(over);

    const live: Command[] = [
      { t: 'PAUSE' },
      { t: 'ADJUST', deltaMs: 15_000 },
      { t: 'ADJUST', deltaMs: -15_000 },
      { t: 'ADVANCE' },
      { t: 'PREV' },
      { t: 'RESET_SEGMENT' },
      { t: 'BANK_DRAW', side: 'A' },
      { t: 'HOLD' },
      { t: 'LOAD', cursor: 3 },
      { t: 'END_ROUND' },
    ];
    for (const cmd of live) {
      expect(reduce(running, cmd, ctx)).not.toBe(running);
    }
  });

  it('resumes into overtime and keeps accruing', () => {
    const h = harness();
    h.go({ t: 'LOAD', cursor: 1 }, 0);
    h.go({ t: 'START' }, 0);
    h.go({ t: 'PAUSE' }, 35_000);
    h.go({ t: 'RESUME' }, 100_000);
    expect(h.rem(SP2, 105_000)).toBe(-20_000);

    h.go({ t: 'ADJUST', deltaMs: 15_000 }, 105_000);
    expect(h.rem(SP2, 105_000)).toBe(-5_000);
    expect(isRunning(h.state(), SP2)).toBe(true);
  });

  it('hands the floor over in free debate even when a side is past zero', () => {
    const h = harness();
    h.go({ t: 'LOAD', cursor: 2 }, 0);
    h.go({ t: 'START' }, 0);
    expect(h.rem(FD_A, 45_000)).toBe(-15_000); // A is 15s over

    h.go({ t: 'SWAP' }, 45_000);
    expect(h.state().floor).toBe('B');
    expect(isRunning(h.state(), FD_B)).toBe(true);
    expect(isRunning(h.state(), FD_A)).toBe(false);
    expect(h.rem(FD_A, 60_000)).toBe(-15_000);

    h.go({ t: 'SWAP' }, 60_000); // and back again, into A's overtime
    expect(h.state().floor).toBe('A');
    expect(h.rem(FD_A, 70_000)).toBe(-25_000);
  });
});

/* ------------------------------------------------- free debate exclusivity flag */

describe('free debate', () => {
  it('is mutually exclusive by default', () => {
    const h = harness();
    h.go({ t: 'LOAD', cursor: 2 }, 0);
    h.go({ t: 'START' }, 0);
    h.go({ t: 'GIVE_FLOOR', side: 'B' }, 10_000);

    expect(h.state().coRun).toBeNull();
    expect(isRunning(h.state(), FD_A)).toBe(false);
    expect(isRunning(h.state(), FD_B)).toBe(true);
    expect(h.rem(FD_A, 30_000)).toBe(20_000);
  });

  it('runs both sides at once when the operator turns exclusivity off', () => {
    const h = harness(makeConfig({ freeDebateExclusive: false }));
    h.go({ t: 'LOAD', cursor: 2 }, 0);
    h.go({ t: 'START' }, 0);
    h.go({ t: 'SWAP' }, 10_000);

    expect(h.state().floor).toBe('B');
    expect(isRunning(h.state(), FD_A)).toBe(true);
    expect(isRunning(h.state(), FD_B)).toBe(true);
    expect(h.rem(FD_A, 20_000)).toBe(10_000);
    expect(h.rem(FD_B, 20_000)).toBe(20_000);
  });

  it('waits for a side when firstFloor is the operator', () => {
    const config = makeConfig();
    const chess = config.segments[2];
    if (chess?.kind !== 'chess') throw new Error('fixture drift');
    chess.firstFloor = 'operator';

    const h = harness(config);
    h.go({ t: 'LOAD', cursor: 2 }, 0);
    expect(primaryClockId(h.state(), h.plan)).toBeNull();

    const armed = h.state();
    expect(h.go({ t: 'START' }, 0)).toBe(armed); // START is inert until a side is picked

    h.go({ t: 'GIVE_FLOOR', side: 'B' }, 1_000);
    expect(h.state().floor).toBe('B');
    expect(isRunning(h.state(), FD_B)).toBe(false); // arming only
    h.go({ t: 'START' }, 1_000);
    expect(isRunning(h.state(), FD_B)).toBe(true);
  });
});

/* ----------------------------------------------------------- context-sensitive */

describe('TOGGLE', () => {
  it('arms pre-round, then starts, pauses and resumes', () => {
    const h = harness();
    h.go({ t: 'TOGGLE' }, 0);
    expect(h.state().cursor).toBe(0);
    expect(isRunning(h.state(), SP1)).toBe(false);

    h.go({ t: 'TOGGLE' }, 0);
    expect(isRunning(h.state(), SP1)).toBe(true);
    h.go({ t: 'TOGGLE' }, 10_000);
    expect(transportOf(h.state(), SP1)).toBe('paused');
    h.go({ t: 'TOGGLE' }, 10_000);
    expect(isRunning(h.state(), SP1)).toBe(true);
  });

  it('pauses and resumes the side holding the floor in free debate, and never hands off', () => {
    const h = harness();
    h.go({ t: 'LOAD', cursor: 2 }, 0);
    h.go({ t: 'TOGGLE' }, 0);
    expect(h.state().floor).toBe('A');
    expect(isRunning(h.state(), FD_A)).toBe(true);

    h.go({ t: 'TOGGLE' }, 10_000); // a pause, not a hand-off
    expect(h.state().run).toBeNull();
    expect(h.state().floor).toBe('A');
    expect(h.rem(FD_A, 60_000)).toBe(20_000);
    expect(h.rem(FD_B, 60_000)).toBe(30_000);

    h.go({ t: 'TOGGLE' }, 60_000); // and the same side resumes
    expect(h.state().floor).toBe('A');
    expect(isRunning(h.state(), FD_A)).toBe(true);
    expect(isRunning(h.state(), FD_B)).toBe(false);

    // Handing over is its own command; after it, Space pauses whoever has the floor.
    h.go({ t: 'GIVE_FLOOR', side: 'B' }, 65_000);
    h.go({ t: 'TOGGLE' }, 70_000);
    expect(h.state().run).toBeNull();
    expect(h.state().floor).toBe('B');
    expect(h.rem(FD_B, 99_000)).toBe(25_000);
  });

  it('pauses both free-debate sides when both run, and resumes only the floor', () => {
    const h = harness(makeConfig({ freeDebateExclusive: false }));
    h.go({ t: 'LOAD', cursor: 2 }, 0);
    h.go({ t: 'START' }, 0);
    h.go({ t: 'SWAP' }, 5_000); // A keeps running, B takes the floor

    h.go({ t: 'TOGGLE' }, 10_000);
    expect(isRunning(h.state(), FD_A)).toBe(false);
    expect(isRunning(h.state(), FD_B)).toBe(false);
    expect(h.state().floor).toBe('B');

    h.go({ t: 'TOGGLE' }, 20_000);
    expect(isRunning(h.state(), FD_B)).toBe(true);
    expect(isRunning(h.state(), FD_A)).toBe(false);
  });

  it('starts nothing in free debate until the operator has picked a side', () => {
    const config = makeConfig();
    const chess = config.segments[2];
    if (chess?.kind !== 'chess') throw new Error('fixture drift');
    chess.firstFloor = 'operator';

    const h = harness(config);
    const armed = h.go({ t: 'LOAD', cursor: 2 }, 0);
    expect(h.go({ t: 'TOGGLE' }, 0)).toBe(armed);

    h.go({ t: 'GIVE_FLOOR', side: 'B' }, 1_000);
    h.go({ t: 'TOGGLE' }, 1_000);
    expect(isRunning(h.state(), FD_B)).toBe(true);
  });
});

/* ---------------------------------------------------------------- store form */

describe('reducer(s, cmd, plan)', () => {
  it('reads the clock for you when no instant is injected', () => {
    vi.useFakeTimers();
    try {
      const p = plan(makeConfig());
      let s = initialState(p);
      s = reducer(s, { t: 'ADVANCE' }, p);
      s = reducer(s, { t: 'START' }, p);
      expect(isRunning(s, SP1)).toBe(true);

      vi.advanceTimersByTime(5_000);
      expect(elapsedMs(s, SP1, now())).toBe(5_000);

      s = reducer(s, { t: 'PAUSE' }, p);
      vi.advanceTimersByTime(60_000);
      expect(elapsedMs(s, SP1, now())).toBe(5_000);
    } finally {
      vi.useRealTimers();
    }
  });
});
