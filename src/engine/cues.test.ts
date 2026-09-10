/**
 * Cues are a latched PREDICATE over derived state, not a frame-crossing test (§5.5, R6).
 * Everything below is an instant injected by hand, so a "throttled tab" is exactly a
 * sparse sequence of instants — the same thing the browser hands the rAF loop.
 */

import { describe, expect, it } from 'vitest';
import type { CueSpec, RoundConfig, Rules } from '../domain/config';
import { SCHEMA_VERSION, defaultRules } from '../domain/config';
import type { RunPlan } from '../domain/plan';
import { plan } from '../domain/plan';
import type { Now } from './chronometer';
import { nowFrom, remainingMs } from './chronometer';
import type { CueEvent } from './cues';
import {
  GRACE_SUFFIX,
  LATE_AUDIO_MS,
  cueKey,
  evaluateCues,
  markFired,
  nextCue,
  pendingCues,
} from './cues';
import { reduce } from './reducer';
import type { ClockId, Command, RoundState } from './state';
import { initialState } from './state';

const T0 = 1_700_000_000_000;
const at = (ms: number): Now => nowFrom(ms, T0 + ms);

const C1 = 'c1'; // 0:20 speech, ladder 10s / 5s / 3s / 0
const C2 = 'c2'; // 0:10 speech on the ROUND default ladder — 60s and 30s exceed it
const C3 = 'c3'; // free debate, 0:30 per side, ladder 10s / 0
const C3_A: ClockId = 'c3:A';
const C3_B: ClockId = 'c3:B';
const BANK_A: ClockId = 'bank:A';

const GRACE_MS = 2_000;

const LADDER: CueSpec[] = [
  { atMs: 10_000, tone: 'soft' },
  { atMs: 5_000, tone: 'soft' },
  { atMs: 3_000, tone: 'soft' },
  { atMs: 0, tone: 'double' },
];

function makeConfig(rules: Partial<Rules> = {}): RoundConfig {
  return {
    v: SCHEMA_VERSION,
    id: 'cuetest1',
    title: { en: 'Cues', zh: '提示音' },
    sides: [
      { id: 'A', label: { en: 'Prop', zh: '正方' }, color: '#E69F00', prepBankMs: 60_000 },
      { id: 'B', label: { en: 'Opp', zh: '反方' }, color: '#0072B2', prepBankMs: 0 },
    ],
    speakers: [
      { id: 'spkA1', side: 'A', name: 'A1', defaultMs: 20_000 },
      { id: 'spkB1', side: 'B', name: 'B1', defaultMs: 10_000 },
    ],
    segments: [
      { id: C1, kind: 'speech', speakerId: 'spkA1', allottedMs: 20_000, cues: LADDER },
      { id: C2, kind: 'speech', speakerId: 'spkB1', allottedMs: 10_000 },
      {
        id: C3,
        kind: 'chess',
        label: { en: 'Free debate', zh: '自由辩论' },
        perSideMs: 30_000,
        firstFloor: 'A',
        cues: [
          { atMs: 10_000, tone: 'soft' },
          { atMs: 0, tone: 'double' },
        ],
      },
    ],
    rules: { ...defaultRules(), graceMs: GRACE_MS, ...rules },
  };
}

interface Harness {
  plan: RunPlan;
  state: () => RoundState;
  set: (next: RoundState) => void;
  go: (cmd: Command, ms: number) => RoundState;
  rem: (clockId: ClockId, ms: number) => number;
  /** One frame: evaluate, latch what fired, hand back the events. */
  frame: (ms: number) => CueEvent[];
  keys: (ms: number) => string[];
}

function harness(config: RoundConfig = makeConfig()): Harness {
  const p = plan(config);
  let s = initialState(p);
  const frame = (ms: number): CueEvent[] => {
    const events = evaluateCues(s, p, at(ms));
    s = markFired(s, events);
    return events;
  };
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
    frame,
    keys: (ms) => frame(ms).map((e) => e.key),
  };
}

/** Start `cursor` running at t = 0. */
function open(h: Harness, cursor: number): void {
  h.go({ t: 'LOAD', cursor }, 0);
  h.go({ t: 'START' }, 0);
}

/* --------------------------------------------------------------- latch, once */

describe('a cue fires exactly once per clock per visit', () => {
  it('latches on the frame it becomes true and never repeats', () => {
    const h = harness();
    open(h, 0);

    expect(h.keys(8_000)).toEqual([]); // remaining 12s, nothing due
    expect(h.keys(12_000)).toEqual([cueKey(C1, 10_000)]); // remaining 8s
    expect(h.keys(12_016)).toEqual([]);
    expect(h.keys(13_000)).toEqual([]);
    expect(h.keys(14_000)).toEqual([]);
    expect(h.state().cuesFired[cueKey(C1, 10_000)]).toBe(true);
  });

  it('is pure: evaluating twice without latching yields the same event twice', () => {
    const h = harness();
    open(h, 0);
    const first = evaluateCues(h.state(), h.plan, at(12_000));
    const second = evaluateCues(h.state(), h.plan, at(12_000));
    expect(first).toEqual(second);
    expect(first.length).toBe(1);
  });

  it('keeps the two free-debate sides on independent latches', () => {
    const h = harness();
    open(h, 2); // side A takes the floor
    expect(h.keys(21_000)).toEqual([cueKey(C3_A, 10_000)]); // A has 9s left

    h.go({ t: 'SWAP' }, 21_000);
    expect(h.keys(21_000)).toEqual([]); // B is untouched, 30s left
    expect(h.keys(42_000)).toEqual([cueKey(C3_B, 10_000)]); // B has 9s left
    expect(h.keys(43_000)).toEqual([]);
  });

  it('never rings for a paused clock, a prep bank, or a held round', () => {
    const h = harness();
    open(h, 0);
    h.go({ t: 'PAUSE' }, 12_000);
    expect(h.keys(600_000)).toEqual([]); // paused at 8s remaining, forever

    h.go({ t: 'BANK_DRAW', side: 'A' }, 600_000);
    expect(h.keys(660_000)).toEqual([]); // a bank has no ladder and no grace bell
    expect(nextCue(h.state(), h.plan, BANK_A, at(660_000))).toBeNull();

    h.go({ t: 'BANK_END' }, 660_000);
    h.go({ t: 'RESUME' }, 660_000);
    h.go({ t: 'HOLD' }, 660_000);
    expect(evaluateCues(h.state(), h.plan, at(700_000))).toEqual([]);
  });
});

/* ------------------------------------------- threshold at or above the allotment */

describe('a threshold at or above the allotment', () => {
  it('fires on the first running frame instead of never (bugs #5 and #6)', () => {
    const h = harness();
    open(h, 1); // 0:10 speech, round ladder 60s / 30s / 0

    const events = h.frame(0);
    expect(events.map((e) => e.key)).toEqual([cueKey(C2, 60_000), cueKey(C2, 30_000)]);
    // Lateness is measured from the first instant the cue COULD fire, so a warning
    // above the allotment is on time, not 50 seconds stale.
    expect(events.map((e) => e.lateMs)).toEqual([0, 0]);
    expect(events.every((e) => e.audible)).toBe(true);

    expect(h.keys(1_000)).toEqual([]);
    expect(h.keys(10_000)).toEqual([cueKey(C2, 0)]);
  });

  it('fires at exact equality, not one frame past it', () => {
    const h = harness();
    open(h, 0);
    expect(h.rem(C1, 10_000)).toBe(10_000);
    const events = h.frame(10_000); // remaining === atMs exactly
    expect(events.map((e) => e.key)).toEqual([cueKey(C1, 10_000)]);
    expect(events[0]?.lateMs).toBe(0);
  });
});

/* ------------------------------------------------------------------ throttling */

describe('a throttled tab', () => {
  it('fires every crossed cue across 4-second frames, each exactly once', () => {
    const h = harness();
    open(h, 0);

    const seen: Array<[number, string[]]> = [];
    for (let ms = 0; ms <= 28_000; ms += 4_000) seen.push([ms, h.keys(ms)]);

    expect(seen).toEqual([
      [0, []], // 20s remaining
      [4_000, []],
      [8_000, []],
      [12_000, [cueKey(C1, 10_000)]], // 8s
      [16_000, [cueKey(C1, 5_000)]], // 4s
      [20_000, [cueKey(C1, 3_000), cueKey(C1, 0)]], // 0s — two in one frame, none skipped
      [24_000, [cueKey(C1, GRACE_SUFFIX)]], // −4s, past the 2s grace
      [28_000, []],
    ]);
  });

  it('fires every cue crossed during one long hidden-tab jump', () => {
    const h = harness();
    open(h, 0);

    // Nineteen seconds with no frame at all: three thresholds went by.
    const events = h.frame(19_000);
    expect(events.map((e) => e.key)).toEqual([
      cueKey(C1, 10_000),
      cueKey(C1, 5_000),
      cueKey(C1, 3_000),
    ]);
    expect(events.map((e) => e.lateMs)).toEqual([9_000, 4_000, 2_000]);
    // A bell more than 5s stale keeps its visual state and loses its audio.
    expect(events.map((e) => e.audible)).toEqual([false, true, true]);
    expect(LATE_AUDIO_MS).toBe(5_000);

    expect(h.keys(20_000)).toEqual([cueKey(C1, 0)]);
    expect(h.keys(24_000)).toEqual([cueKey(C1, GRACE_SUFFIX)]);
  });

  it('stops escalating past the overtime cap while the number keeps counting', () => {
    const h = harness(makeConfig({ overtimeCapMs: 5_000 }));
    open(h, 0);

    expect(h.keys(26_000)).toEqual([]); // −6s: past the cap, nothing fires at all
    expect(h.rem(C1, 26_000)).toBe(-6_000); // but the clock is still counting up
    expect(h.state().cuesFired).toEqual({});
  });
});

/* ---------------------------------------------------------------------- grace */

describe('the grace bell', () => {
  it('fires once at grace past expiry and not before', () => {
    const h = harness();
    open(h, 0);
    h.frame(20_000); // clears the ladder down to 0

    expect(h.keys(21_000)).toEqual([]); // −1s, grace is 2s
    const events = h.frame(22_000);
    expect(events.map((e) => e.key)).toEqual([cueKey(C1, GRACE_SUFFIX)]);
    expect(events[0]?.grace).toBe(true);
    expect(events[0]?.cue).toEqual({ atMs: -GRACE_MS, tone: 'triple' });
    expect(h.keys(23_000)).toEqual([]);
  });
});

/* -------------------------------------------------------------------- re-arm */

describe('a rewind re-arms the bells', () => {
  it('ADJUST un-latches exactly the thresholds now above remaining', () => {
    const h = harness();
    open(h, 0);
    h.frame(25_000); // −5s: the whole ladder and the grace bell have rung
    expect(Object.keys(h.state().cuesFired).sort()).toEqual([
      cueKey(C1, 0),
      cueKey(C1, 10_000),
      cueKey(C1, 3_000),
      cueKey(C1, 5_000),
      cueKey(C1, GRACE_SUFFIX),
    ]);

    h.go({ t: 'ADJUST', deltaMs: 9_000 }, 25_000); // remaining 4s
    expect(h.rem(C1, 25_000)).toBe(4_000);
    expect(Object.keys(h.state().cuesFired).sort()).toEqual([
      cueKey(C1, 10_000), // 4s is still below 10s and 5s: those stay rung
      cueKey(C1, 5_000),
    ]);

    // …and the re-armed bells ring a second time on the way back down.
    expect(h.keys(26_000)).toEqual([cueKey(C1, 3_000)]);
    expect(h.keys(29_000)).toEqual([cueKey(C1, 0)]);
    expect(h.keys(31_000)).toEqual([cueKey(C1, GRACE_SUFFIX)]);
  });

  it('ADJUST down does not silence a bell that has not been reached again', () => {
    const h = harness();
    open(h, 0);
    h.frame(12_000); // 8s remaining, the 10s bell has rung
    h.go({ t: 'ADJUST', deltaMs: -3_000 }, 12_000); // 5s remaining
    expect(h.state().cuesFired[cueKey(C1, 10_000)]).toBe(true);
    expect(h.keys(12_000)).toEqual([cueKey(C1, 5_000)]);
  });

  it('RESET_SEGMENT drops every latch on that segment and nothing else', () => {
    const h = harness();
    open(h, 0);
    h.frame(25_000);
    h.go({ t: 'LOAD', cursor: 1 }, 25_000);
    h.go({ t: 'START' }, 25_000);
    h.frame(25_000); // rings c2's two over-allotment warnings
    h.go({ t: 'LOAD', cursor: 0 }, 25_000);

    h.go({ t: 'RESET_SEGMENT' }, 25_000);

    expect(Object.keys(h.state().cuesFired).sort()).toEqual([
      cueKey(C2, 30_000),
      cueKey(C2, 60_000),
    ]);
    expect(h.rem(C1, 25_000)).toBe(20_000);

    // The whole ladder rings again from a standing start.
    h.go({ t: 'START' }, 25_000);
    expect(h.keys(25_000)).toEqual([]);
    expect(h.keys(35_000)).toEqual([cueKey(C1, 10_000)]);
    expect(h.keys(40_000)).toEqual([cueKey(C1, 5_000)]);
    expect(h.keys(45_000)).toEqual([cueKey(C1, 3_000), cueKey(C1, 0)]);
  });

  it('PREV keeps the bells a segment has already passed', () => {
    const h = harness();
    h.go({ t: 'ADVANCE' }, 0); // arm c1
    h.go({ t: 'START' }, 0);
    h.frame(16_000); // 4s remaining: the 10s and 5s bells have rung
    h.go({ t: 'ADVANCE' }, 16_000);
    h.go({ t: 'PREV' }, 30_000);

    expect(h.state().cursor).toBe(0);
    expect(h.rem(C1, 30_000)).toBe(4_000); // the remembered remaining, not 20s
    expect(h.state().cuesFired[cueKey(C1, 10_000)]).toBe(true);

    h.go({ t: 'START' }, 30_000);
    expect(h.keys(30_000)).toEqual([]); // no double ring on re-entry
    expect(h.keys(31_000)).toEqual([cueKey(C1, 3_000)]);
  });

  it('PREV re-arms a latch that no longer matches the restored remaining', () => {
    const h = harness();
    h.go({ t: 'ADVANCE' }, 0); // c1 armed, untouched, 20s remaining
    h.go({ t: 'ADVANCE' }, 0); // move to c2

    // A stale latch — the shape left behind by a restored snapshot or an undo.
    const stale: CueEvent = {
      key: cueKey(C1, 10_000),
      clockId: C1,
      segId: C1,
      cue: { atMs: 10_000, tone: 'soft' },
      lateMs: 0,
      audible: true,
      grace: false,
    };
    h.set(markFired(h.state(), [stale]));

    h.go({ t: 'PREV' }, 1_000);
    expect(h.state().cuesFired[cueKey(C1, 10_000)]).toBeUndefined();

    h.go({ t: 'START' }, 1_000);
    expect(h.keys(11_000)).toEqual([cueKey(C1, 10_000)]);
  });
});

/* -------------------------------------------------------- audio pre-scheduling */

describe('pendingCues', () => {
  it('hands back every un-fired cue on a running clock, soonest first', () => {
    const h = harness();
    open(h, 0);

    // All of them, not just the nearest: a fully hidden tab gets no further frames,
    // so anything not on the audio timeline now will never ring.
    expect(pendingCues(h.state(), h.plan, at(0))).toEqual([
      { clockId: C1, key: cueKey(C1, 10_000), cue: LADDER[0], inMs: 10_000 },
      { clockId: C1, key: cueKey(C1, 5_000), cue: LADDER[1], inMs: 15_000 },
      { clockId: C1, key: cueKey(C1, 3_000), cue: LADDER[2], inMs: 17_000 },
      { clockId: C1, key: cueKey(C1, 0), cue: LADDER[3], inMs: 20_000 },
      {
        clockId: C1,
        key: cueKey(C1, GRACE_SUFFIX),
        cue: { atMs: -GRACE_MS, tone: 'triple' },
        inMs: 22_000,
      },
    ]);
    expect(nextCue(h.state(), h.plan, C1, at(0))?.key).toBe(cueKey(C1, 10_000));
  });

  it('drops a cue once it has fired and re-times the rest', () => {
    const h = harness();
    open(h, 0);
    h.frame(12_000); // the 10s bell rings

    expect(pendingCues(h.state(), h.plan, at(12_000)).map((p) => [p.key, p.inMs])).toEqual([
      [cueKey(C1, 5_000), 3_000],
      [cueKey(C1, 3_000), 5_000],
      [cueKey(C1, 0), 8_000],
      [cueKey(C1, GRACE_SUFFIX), 10_000],
    ]);
  });

  it('covers both sides while both free-debate clocks run, and nothing while held', () => {
    const h = harness(makeConfig({ freeDebateExclusive: false }));
    open(h, 2);
    h.go({ t: 'SWAP' }, 5_000);

    const pending = pendingCues(h.state(), h.plan, at(5_000));
    expect(pending.map((p) => [p.clockId, p.inMs])).toEqual([
      [C3_A, 15_000], // A has 25s left, so 15s to its 10s bell
      [C3_B, 20_000], // B has the full 30s
      [C3_A, 25_000], // A at time
      [C3_A, 27_000], // A at grace
      [C3_B, 30_000],
      [C3_B, 32_000],
    ]);

    h.go({ t: 'HOLD' }, 5_000);
    expect(pendingCues(h.state(), h.plan, at(5_000))).toEqual([]);
  });
});
