import { describe, expect, it } from 'vitest';
import type { Now } from './chronometer';
import { anchor, anchorRound, elapsedMs, nowFrom, remainingMs, roundElapsedMs } from './chronometer';
import type { EpochAnchor, SnapshotState } from './rebase';
import {
  fromSnapshot,
  rebase,
  rebaseAnchor,
  rebaseState,
  toEpochAnchor,
  toSnapshot,
} from './rebase';
import type { ClockId, ClockRec, RoundState } from './state';
import { transportOf } from './state';

const T0 = 1_700_000_000_000;

/**
 * Two documents that share a wall clock and share nothing else. `performance.timeOrigin`
 * is per-document, so another document's mono for the same instant is 8_000_000ms off the
 * console's — the whole reason anchors travel as epochs.
 */
const console_ = (mono: number): Now => nowFrom(mono, T0 + mono);
const elsewhere = (mono: number): Now => nowFrom(mono + 8_000_000, T0 + mono);

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

describe('rebase', () => {
  it('places the anchor so the elapsed wall time is reproduced locally', () => {
    const a: EpochAnchor = { clockId: 'a', startedAtEpoch: T0 + 5_000 };
    const r = rebase(a, elsewhere(35_000));

    expect(r.clockId).toBe('a');
    expect(r.startedAtEpoch).toBe(T0 + 5_000); // still travel-ready
    expect(r.startedAtMono).toBe(elsewhere(35_000).mono - 30_000);
    expect(r.skewAtStart).toBe(T0 - 8_000_000);
  });

  it('clamps a backwards wall-clock step to zero instead of a negative age', () => {
    const a: EpochAnchor = { clockId: 'a', startedAtEpoch: T0 + 60_000 };
    // The OS stepped the clock back 60s after the anchor was taken.
    const r = rebase(a, elsewhere(30_000));
    expect(r.startedAtMono).toBe(elsewhere(30_000).mono);
    expect(remainingMs({ ...mkState({ a: 180_000 }), run: r }, 'a', elsewhere(30_000))).toBe(180_000);
  });

  it('never moves a running clock backwards when the wall clock jumps back', () => {
    let s = anchor(mkState({ a: 180_000 }), 'a', console_(0));
    const before = elapsedMs(s, 'a', console_(30_000));
    expect(before).toBe(30_000);

    // A 60s NTP correction backwards: same document, mono keeps rising, epoch does not.
    const stepped = nowFrom(31_000, T0 + 31_000 - 60_000);
    expect(elapsedMs(s, 'a', stepped)).toBe(31_000);

    // Re-basing on the stepped clock (a frame or a snapshot arriving mid-correction)
    // keeps the local mapping: the same run may not restart at zero.
    s = rebaseState(s, stepped);
    expect(elapsedMs(s, 'a', stepped)).toBe(31_000);
    expect(elapsedMs(s, 'a', nowFrom(41_000, T0 + 41_000 - 60_000))).toBe(41_000);
    expect(remainingMs(s, 'a', stepped)).toBe(149_000);
  });

  it('is idempotent on a state that is already local', () => {
    const s = anchorRound(anchor(mkState({ a: 180_000 }), 'a', console_(1_000)), console_(1_000));
    const again = rebaseState(s, console_(31_000));

    expect(again.run?.startedAtMono).toBe(1_000);
    expect(again.roundRun?.startedAtMono).toBe(1_000);
    expect(elapsedMs(again, 'a', console_(31_000))).toBe(30_000);
    expect(roundElapsedMs(again, console_(31_000))).toBe(30_000);
  });

  it('charges a suspend gap, because the anchor is wall-clock truth', () => {
    // The machine slept 10 minutes: mono advanced 1s, the epoch advanced 601s.
    const s = anchor(mkState({ a: 180_000 }), 'a', console_(0));
    const wake = nowFrom(1_000, T0 + 601_000);
    const woken = rebaseState(s, wake);
    expect(elapsedMs(woken, 'a', wake)).toBe(601_000);
    expect(remainingMs(woken, 'a', wake)).toBe(-421_000);
  });

  it('maps null anchors to null in both directions', () => {
    expect(toEpochAnchor(null)).toBeNull();
    expect(rebaseAnchor(null, elsewhere(0))).toBeNull();
    expect(rebaseAnchor(undefined, elsewhere(0))).toBeNull();
    expect(rebaseState(mkState({ a: 1 }), elsewhere(0)).run).toBeNull();
  });
});

describe('snapshot round trip', () => {
  it('reproduces the same remaining in a document with a foreign time origin', () => {
    let s = anchorRound(mkState({ a: 180_000 }), console_(0));
    s = anchor(s, 'a', console_(5_000));
    const snap = toSnapshot(s);

    // Serialized to dt.v3.live, read back 30s of wall time later in a fresh document.
    const revived: SnapshotState = JSON.parse(JSON.stringify(snap)) as SnapshotState;
    const restored = fromSnapshot(revived, elsewhere(35_000));

    expect(remainingMs(restored, 'a', elsewhere(35_000))).toBe(150_000);
    expect(remainingMs(restored, 'a', elsewhere(45_000))).toBe(140_000);
    expect(roundElapsedMs(restored, elsewhere(35_000))).toBe(35_000);
    expect(transportOf(restored, 'a')).toBe('running');

    // …and it agrees with the document that took the snapshot, to the millisecond.
    expect(remainingMs(restored, 'a', elsewhere(35_000))).toBe(
      remainingMs(s, 'a', console_(35_000)),
    );
  });

  it('carries no monotonic value and no undo stack', () => {
    let s = anchor(mkState({ a: 180_000 }), 'a', console_(5_000));
    s = {
      ...s,
      undo: [{ cmd: { t: 'START' }, prev: toSnapshotless(s), running: ['a'], roundRunning: false }],
      redo: [],
    };
    const snap = toSnapshot(s);
    const json = JSON.stringify(snap);

    expect(json).not.toContain('startedAtMono');
    expect(json).not.toContain('skewAtStart');
    expect('undo' in snap).toBe(false);
    expect('redo' in snap).toBe(false);
    expect(snap.run).toEqual({ clockId: 'a', startedAtEpoch: T0 + 5_000 });
    expect(fromSnapshot(snap, elsewhere(0)).undo).toEqual([]);
  });

  it('preserves the non-anchor state verbatim', () => {
    const s = mkState(
      { a: 180_000, 'bank:A': 60_000 },
      {
        cursor: 4,
        floor: 'B',
        hold: true,
        roundConsumedMs: 123_456,
        cuesFired: { 'a@30000': true },
        log: [{ segId: 'seg1', clockId: 'a', allottedMs: 180_000, usedMs: 190_000, overMs: 10_000 }],
      },
    );
    const back = fromSnapshot(toSnapshot(s), elsewhere(0));
    expect(back).toEqual({ ...s, undo: [], redo: [] });
  });

  it('keeps a paused clock paused across the trip', () => {
    const s = mkState({ a: 180_000 }, { clocks: { a: { allottedMs: 180_000, consumedMs: 42_000 } } });
    const back = fromSnapshot(toSnapshot(s), elsewhere(600_000));
    expect(remainingMs(back, 'a', elsewhere(600_000))).toBe(138_000);
    expect(transportOf(back, 'a')).toBe('paused');
  });
});

/** An `UndoState` for the fixture above: the state minus its own stacks. */
function toSnapshotless(s: RoundState): Omit<RoundState, 'undo' | 'redo'> {
  const { undo: _u, redo: _r, ...rest } = s;
  return rest;
}
