import { describe, expect, it } from 'vitest';
import type { Now } from './chronometer';
import { anchor, anchorRound, elapsedMs, nowFrom, remainingMs, roundElapsedMs } from './chronometer';
import type { EpochAnchor, SnapshotState, StageFrame } from './rebase';
import {
  applyStageFrame,
  fromSnapshot,
  rebase,
  rebaseAnchor,
  rebaseState,
  toEpochAnchor,
  toSnapshot,
  toStageFrame,
} from './rebase';
import type { ClockId, ClockRec, RoundState } from './state';
import { transportOf } from './state';

const T0 = 1_700_000_000_000;

/**
 * Two documents that share a wall clock and share nothing else. `performance.timeOrigin`
 * is per-document, so the follower's mono for the same instant is 8_000_000ms off the
 * console's — the whole reason anchors travel as epochs.
 */
const console_ = (mono: number): Now => nowFrom(mono, T0 + mono);
const stage = (mono: number): Now => nowFrom(mono + 8_000_000, T0 + mono);

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
    const r = rebase(a, stage(35_000));

    expect(r.clockId).toBe('a');
    expect(r.startedAtEpoch).toBe(T0 + 5_000); // still travel-ready
    expect(r.startedAtMono).toBe(stage(35_000).mono - 30_000);
    expect(r.skewAtStart).toBe(T0 - 8_000_000);
  });

  it('clamps a backwards wall-clock step to zero instead of a negative age', () => {
    const a: EpochAnchor = { clockId: 'a', startedAtEpoch: T0 + 60_000 };
    // The OS stepped the clock back 60s after the anchor was taken.
    const r = rebase(a, stage(30_000));
    expect(r.startedAtMono).toBe(stage(30_000).mono);
    expect(remainingMs({ ...mkState({ a: 180_000 }), run: r }, 'a', stage(30_000))).toBe(180_000);
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
    expect(rebaseAnchor(null, stage(0))).toBeNull();
    expect(rebaseAnchor(undefined, stage(0))).toBeNull();
    expect(rebaseState(mkState({ a: 1 }), stage(0)).run).toBeNull();
  });
});

describe('snapshot round trip', () => {
  it('reproduces the same remaining in a document with a foreign time origin', () => {
    let s = anchorRound(mkState({ a: 180_000 }), console_(0));
    s = anchor(s, 'a', console_(5_000));
    const snap = toSnapshot(s);

    // Serialized to dt.v3.live, read back 30s of wall time later in a fresh document.
    const revived: SnapshotState = JSON.parse(JSON.stringify(snap)) as SnapshotState;
    const restored = fromSnapshot(revived, stage(35_000));

    expect(remainingMs(restored, 'a', stage(35_000))).toBe(150_000);
    expect(remainingMs(restored, 'a', stage(45_000))).toBe(140_000);
    expect(roundElapsedMs(restored, stage(35_000))).toBe(35_000);
    expect(transportOf(restored, 'a')).toBe('running');

    // …and it agrees with the document that took the snapshot, to the millisecond.
    expect(remainingMs(restored, 'a', stage(35_000))).toBe(
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
    expect(fromSnapshot(snap, stage(0)).undo).toEqual([]);
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
    const back = fromSnapshot(toSnapshot(s), stage(0));
    expect(back).toEqual({ ...s, undo: [], redo: [] });
  });

  it('keeps a paused clock paused across the trip', () => {
    const s = mkState({ a: 180_000 }, { clocks: { a: { allottedMs: 180_000, consumedMs: 42_000 } } });
    const back = fromSnapshot(toSnapshot(s), stage(600_000));
    expect(remainingMs(back, 'a', stage(600_000))).toBe(138_000);
    expect(transportOf(back, 'a')).toBe('paused');
  });
});

/** An `UndoState` for the fixture above: the state minus its own stacks. */
function toSnapshotless(s: RoundState): Omit<RoundState, 'undo' | 'redo'> {
  const { undo: _u, redo: _r, ...rest } = s;
  return rest;
}

describe('stage frames', () => {
  it('lands on the follower showing exactly what the console shows', () => {
    let leader = anchorRound(mkState({ a: 180_000, 'bank:A': 60_000 }), console_(0));
    leader = anchor(leader, 'a', console_(5_000));
    leader = { ...leader, cursor: 2, floor: 'A' };

    const frame = toStageFrame(leader, 7);
    expect(frame.seq).toBe(7);
    expect(frame.configHash).toBe('hash0000');
    expect(frame.run).toEqual({ clockId: 'a', startedAtEpoch: T0 + 5_000 });
    expect(JSON.stringify(frame)).not.toContain('startedAtMono');

    const follower = applyStageFrame(mkState({ a: 180_000 }), frame, stage(35_000));
    expect(follower.cursor).toBe(2);
    expect(follower.floor).toBe('A');
    expect(remainingMs(follower, 'a', stage(35_000))).toBe(150_000);
    expect(remainingMs(follower, 'a', stage(35_000))).toBe(
      remainingMs(leader, 'a', console_(35_000)),
    );
    expect(roundElapsedMs(follower, stage(35_000))).toBe(roundElapsedMs(leader, console_(35_000)));
  });

  it('mirrors a paused, held, mid-bank console', () => {
    const leader = mkState(
      { a: 180_000, 'bank:A': 60_000 },
      {
        clocks: {
          a: { allottedMs: 180_000, consumedMs: 70_000 },
          'bank:A': { allottedMs: 60_000, consumedMs: 0 },
        },
        hold: true,
        bankDraw: { side: 'B', resumeAfter: true, resumeClockId: 'a' },
        log: [{ segId: 'seg1', clockId: 'a', allottedMs: 180_000, usedMs: 70_000, overMs: 0 }],
      },
    );
    const follower = applyStageFrame(mkState({ a: 180_000 }), toStageFrame(leader, 1), stage(0));

    expect(follower.hold).toBe(true);
    expect(follower.bankDraw).toEqual({ side: 'B', resumeAfter: false, resumeClockId: null });
    expect(follower.run).toBeNull();
    expect(remainingMs(follower, 'a', stage(600_000))).toBe(110_000);
    expect(follower.log).toEqual(leader.log);
  });

  it('carries the concurrent free-debate anchor too', () => {
    let leader = anchor(mkState({ 's7:A': 240_000, 's7:B': 240_000 }), 's7:A', console_(0));
    leader = anchor(leader, 's7:B', console_(10_000), { concurrent: true });

    const follower = applyStageFrame(
      mkState({ 's7:A': 240_000, 's7:B': 240_000 }),
      toStageFrame(leader, 2),
      stage(40_000),
    );
    expect(follower.run?.clockId).toBe('s7:B');
    expect(follower.coRun?.clockId).toBe('s7:A');
    expect(remainingMs(follower, 's7:A', stage(40_000))).toBe(200_000);
    expect(remainingMs(follower, 's7:B', stage(40_000))).toBe(210_000);
  });

  it('does not rewind the stage when the follower wall clock steps backwards', () => {
    const leader = anchor(mkState({ a: 180_000 }), 'a', console_(5_000));
    const first = applyStageFrame(mkState({ a: 180_000 }), toStageFrame(leader, 1), stage(35_000));
    expect(remainingMs(first, 'a', stage(35_000))).toBe(150_000);

    // The follower machine's clock is corrected 60s backwards; the heartbeat frame that
    // arrives next carries the same anchor and must not restart it.
    const stepped = nowFrom(stage(45_000).mono, T0 + 45_000 - 60_000);
    const second = applyStageFrame(first, toStageFrame(leader, 2), stepped);
    expect(second.run?.startedAtMono).toBe(first.run?.startedAtMono);
    expect(remainingMs(second, 'a', stepped)).toBe(140_000);

    // A frame that says MORE time has passed still pulls a lagging stage forward — the
    // stage tab was throttled or the machine napped, and the console is the truth.
    const late = nowFrom(stage(50_000).mono, T0 + 110_000);
    const caught = applyStageFrame(second, toStageFrame(leader, 3), late);
    expect(remainingMs(caught, 'a', late)).toBe(75_000);
  });

  it('adopts a genuinely new anchor even when it shows less elapsed', () => {
    const first = applyStageFrame(
      mkState({ a: 180_000 }),
      toStageFrame(anchor(mkState({ a: 180_000 }), 'a', console_(0)), 1),
      stage(60_000),
    );
    expect(remainingMs(first, 'a', stage(60_000))).toBe(120_000);

    // The operator hit RESET_SEGMENT: a new start instant, so the guard does not apply.
    const restarted = anchor(mkState({ a: 180_000 }), 'a', console_(60_000));
    const next = applyStageFrame(first, toStageFrame(restarted, 2), stage(61_000));
    expect(remainingMs(next, 'a', stage(61_000))).toBe(179_000);
  });

  it('leaves the follower-local fields the frame does not carry', () => {
    const prev = mkState({ a: 180_000 }, { cuesFired: { 'a@0': true }, sleepPending: null });
    const frame: StageFrame = toStageFrame(mkState({ a: 180_000 }, { cursor: 3 }), 1);
    const next = applyStageFrame(prev, frame, stage(0));

    expect(next.cursor).toBe(3);
    expect(next.cuesFired).toEqual({ 'a@0': true });
    expect(next.undo).toEqual([]);
  });
});
