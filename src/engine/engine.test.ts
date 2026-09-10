import { describe, expect, it } from 'vitest';
import type { RoundConfig } from '../domain/config';
import { SCHEMA_VERSION, defaultRules } from '../domain/config';
import { plan } from '../domain/plan';
import type { Now } from './chronometer';
import { nowFrom, remainingMs, roundElapsedMs } from './chronometer';
import { evaluateCues, markFired } from './cues';
import { rebase } from './rebase';
import { reduce } from './reducer';
import { detectSleep } from './sleep';
import { bankRemaining, canSwap, onDeck, primaryClockId } from './selectors';
import type { Command, RoundState } from './state';
import { chessClockId, initialState, transportOf } from './state';

const T0 = 1_700_000_000_000;
const at = (ms: number): Now => nowFrom(ms, T0 + ms);

function cfg(over: Partial<RoundConfig> = {}): RoundConfig {
  return {
    v: SCHEMA_VERSION,
    id: 'cfg00001',
    title: { en: 'T', zh: 'T' },
    sides: [
      { id: 'A', label: { en: 'A', zh: 'A' }, color: '#E69F00', prepBankMs: 60_000 },
      { id: 'B', label: { en: 'B', zh: 'B' }, color: '#0072B2', prepBankMs: 60_000 },
    ],
    speakers: [
      { id: 'spk00001', side: 'A', name: 'A1', defaultMs: 180_000 },
      { id: 'spk00002', side: 'B', name: 'B1', defaultMs: 180_000 },
    ],
    segments: [
      { id: 'seg00001', kind: 'speech', speakerId: 'spk00001', allottedMs: 180_000 },
      { id: 'seg00002', kind: 'chess', label: { en: 'Free', zh: '自由辩论' }, perSideMs: 30_000, firstFloor: 'A' },
      { id: 'seg00003', kind: 'speech', speakerId: 'spk00002', allottedMs: 20_000 },
    ],
    rules: { ...defaultRules(), graceMs: 15_000 },
    ...over,
  };
}

function run(config: RoundConfig) {
  const p = plan(config);
  let s = initialState(p);
  const go = (cmd: Command, ms: number): RoundState => {
    s = reduce(s, cmd, { plan: p, now: at(ms) });
    return s;
  };
  return { p, go, get: (): RoundState => s, set: (n: RoundState) => (s = n) };
}

describe('chronometer + reducer', () => {
  it('derives time from anchors; pause/resume conserves it exactly', () => {
    const r = run(cfg());
    r.go({ t: 'ADVANCE' }, 0);
    expect(transportOf(r.get(), 'seg00001')).toBe('armed');
    expect(remainingMs(r.get(), 'seg00001', at(50_000))).toBe(180_000); // armed burns nothing
    r.go({ t: 'START' }, 1_000);
    expect(remainingMs(r.get(), 'seg00001', at(31_000))).toBe(150_000);
    r.go({ t: 'PAUSE' }, 31_000);
    expect(remainingMs(r.get(), 'seg00001', at(999_000))).toBe(150_000);
    r.go({ t: 'RESUME' }, 999_000);
    expect(remainingMs(r.get(), 'seg00001', at(1_049_000))).toBe(100_000);
  });

  it('keeps counting past zero and every command stays live', () => {
    const r = run(cfg());
    r.go({ t: 'LOAD', cursor: 2 }, 0);
    r.go({ t: 'START' }, 0);
    expect(remainingMs(r.get(), 'seg00003', at(35_000))).toBe(-15_000);
    r.go({ t: 'PAUSE' }, 35_000);
    expect(transportOf(r.get(), 'seg00003')).toBe('paused');
    r.go({ t: 'RESUME' }, 35_000);
    expect(transportOf(r.get(), 'seg00003')).toBe('running');
    r.go({ t: 'ADJUST', deltaMs: 15_000 }, 40_000);
    expect(remainingMs(r.get(), 'seg00003', at(40_000))).toBe(-5_000);
  });

  it('PREV restores the remembered remaining, paused, never full duration', () => {
    const r = run(cfg());
    r.go({ t: 'ADVANCE' }, 0);
    r.go({ t: 'START' }, 0);
    r.go({ t: 'ADVANCE' }, 78_000); // 1:18 used
    expect(r.get().cursor).toBe(1);
    r.go({ t: 'PREV' }, 90_000);
    expect(r.get().cursor).toBe(0);
    expect(transportOf(r.get(), 'seg00001')).toBe('paused');
    expect(remainingMs(r.get(), 'seg00001', at(200_000))).toBe(102_000);
  });

  it('ADVANCE arms by default and auto-starts only when the rule says so', () => {
    const armed = run(cfg());
    armed.go({ t: 'ADVANCE' }, 0);
    expect(armed.get().run).toBeNull();

    const auto = run(cfg({ rules: { ...defaultRules(), advanceStartsClock: true } }));
    auto.go({ t: 'ADVANCE' }, 0);
    expect(auto.get().run?.clockId).toBe('seg00001');
  });

  it('completing the last segment stops every clock and stays re-enterable', () => {
    const r = run(cfg());
    r.go({ t: 'LOAD', cursor: 2 }, 0);
    r.go({ t: 'START' }, 0);
    r.go({ t: 'ADVANCE' }, 10_000);
    expect(r.get().cursor).toBe(3);
    expect(r.get().run).toBeNull();
    expect(r.get().roundRun).toBeNull();
    expect(r.get().log.length).toBeGreaterThan(0);
    r.go({ t: 'PREV' }, 20_000);
    expect(r.get().cursor).toBe(2);
    expect(remainingMs(r.get(), 'seg00003', at(30_000))).toBe(10_000);
  });

  it('round elapsed excludes held time and pre-round time', () => {
    const r = run(cfg());
    expect(roundElapsedMs(r.get(), at(50_000))).toBe(0);
    r.go({ t: 'ADVANCE' }, 50_000);
    r.go({ t: 'START' }, 50_000);
    r.go({ t: 'HOLD' }, 60_000);
    expect(roundElapsedMs(r.get(), at(200_000))).toBe(10_000);
    r.go({ t: 'RELEASE' }, 200_000);
    expect(remainingMs(r.get(), 'seg00001', at(210_000))).toBe(160_000);
    expect(roundElapsedMs(r.get(), at(210_000))).toBe(20_000);
  });

  it('onDeck is a speaker or null, never a sentinel', () => {
    const r = run(cfg());
    expect(onDeck(r.get(), r.p)?.name).toBe('A1');
    r.go({ t: 'LOAD', cursor: 2 }, 0);
    expect(onDeck(r.get(), r.p)).toBeNull();
  });
});

describe('chess clock', () => {
  const chess = () => {
    const r = run(cfg());
    r.go({ t: 'LOAD', cursor: 1 }, 0);
    return r;
  };

  it('gives each side the full perSideMs and starts neither', () => {
    const r = chess();
    expect(r.get().floor).toBeNull();
    expect(r.get().run).toBeNull();
    expect(r.get().clocks[chessClockId('seg00002', 'A')]?.allottedMs).toBe(30_000);
    expect(r.get().clocks[chessClockId('seg00002', 'B')]?.allottedMs).toBe(30_000);
    expect(primaryClockId(r.get(), r.p)).toBeNull();
  });

  // SWAP is defined only with exactly one side running — the original's deliberate rule.
  // It stays inert otherwise and `canSwap` tells the UI to hide the control.
  it('SWAP is inert, and hidden, when neither side is running', () => {
    const r = chess();
    expect(canSwap(r.get(), r.p)).toBe(false);
    r.go({ t: 'SWAP' }, 0);
    expect(r.get().floor).toBeNull();
    expect(r.get().run).toBeNull();
  });

  it('SWAP is inert, and hidden, when both sides are running', () => {
    const r = run(cfg({ rules: { ...defaultRules(), freeDebateExclusive: false } }));
    r.go({ t: 'LOAD', cursor: 1 }, 0);
    r.go({ t: 'START' }, 0);
    r.go({ t: 'GIVE_FLOOR', side: 'B' }, 5_000);
    expect(r.get().run).not.toBeNull();
    expect(r.get().coRun).not.toBeNull();
    expect(canSwap(r.get(), r.p)).toBe(false);

    const before = r.get();
    r.go({ t: 'SWAP' }, 10_000);
    expect(r.get().floor).toBe(before.floor);
    expect(r.get().run?.clockId).toBe(before.run?.clockId);
    expect(r.get().coRun?.clockId).toBe(before.coRun?.clockId);
  });

  it('canSwap is true exactly when one side is running', () => {
    const r = chess();
    expect(canSwap(r.get(), r.p)).toBe(false);
    r.go({ t: 'START' }, 0);
    expect(canSwap(r.get(), r.p)).toBe(true);
    r.go({ t: 'PAUSE' }, 5_000);
    expect(canSwap(r.get(), r.p)).toBe(false);
  });

  it('SWAP hands off, resumes rather than resets, and works past zero', () => {
    const r = chess();
    r.go({ t: 'START' }, 0);
    expect(r.get().run?.clockId).toBe(chessClockId('seg00002', 'A'));
    r.go({ t: 'SWAP' }, 10_000);
    expect(r.get().floor).toBe('B');
    expect(r.get().coRun).toBeNull();
    expect(remainingMs(r.get(), chessClockId('seg00002', 'A'), at(60_000))).toBe(20_000);
    // B runs into overtime, then hands back to A which resumes where it froze
    r.go({ t: 'SWAP' }, 50_000);
    expect(remainingMs(r.get(), chessClockId('seg00002', 'B'), at(60_000))).toBe(-10_000);
    expect(r.get().floor).toBe('A');
    expect(remainingMs(r.get(), chessClockId('seg00002', 'A'), at(60_000))).toBe(10_000);
    // and back again, from overtime
    r.go({ t: 'SWAP' }, 60_000);
    expect(r.get().floor).toBe('B');
    expect(r.get().run?.clockId).toBe(chessClockId('seg00002', 'B'));
  });

  it('exclusive by default; both sides may run when the rule says so', () => {
    const r = chess();
    r.go({ t: 'START' }, 0);
    r.go({ t: 'GIVE_FLOOR', side: 'B' }, 5_000);
    expect(r.get().coRun).toBeNull();

    const cfg2 = cfg({ rules: { ...defaultRules(), freeDebateExclusive: false } });
    const r2 = run(cfg2);
    r2.go({ t: 'LOAD', cursor: 1 }, 0);
    r2.go({ t: 'START' }, 0);
    r2.go({ t: 'GIVE_FLOOR', side: 'B' }, 5_000);
    expect(r2.get().run?.clockId).toBe(chessClockId('seg00002', 'B'));
    expect(r2.get().coRun?.clockId).toBe(chessClockId('seg00002', 'A'));
    expect(remainingMs(r2.get(), chessClockId('seg00002', 'A'), at(10_000))).toBe(20_000);
    expect(remainingMs(r2.get(), chessClockId('seg00002', 'B'), at(10_000))).toBe(25_000);
  });

  it('writes one result row per side on the way out', () => {
    const r = chess();
    r.go({ t: 'START' }, 0);
    r.go({ t: 'ADVANCE' }, 12_000);
    const rows = r.get().log.filter((x) => x.segId === 'seg00002');
    expect(rows).toHaveLength(2);
  });
});

describe('cues', () => {
  it('fires once per clock per visit and re-arms after PREV', () => {
    const r = run(cfg());
    r.go({ t: 'ADVANCE' }, 0);
    r.go({ t: 'START' }, 0);
    // 60s warning on a 180s speech: not yet at t=100s, fired at t=125s
    expect(evaluateCues(r.get(), r.p, at(100_000))).toHaveLength(0);
    const fired = evaluateCues(r.get(), r.p, at(125_000));
    expect(fired.map((e) => e.cue.atMs)).toEqual([60_000]);
    r.set(markFired(r.get(), fired));
    expect(evaluateCues(r.get(), r.p, at(126_000))).toHaveLength(0);
    r.go({ t: 'PREV' }, 130_000); // back to pre-round is a no-op at index 0
    r.go({ t: 'ADJUST', deltaMs: 60_000 }, 130_000);
    expect(r.get().cuesFired['seg00001@60000']).toBeUndefined();
  });

  it('fires on the first running frame when the threshold exceeds the allotment', () => {
    const r = run(cfg()); // seg00003 is 0:20 with a 1:00 and 0:30 ladder
    r.go({ t: 'LOAD', cursor: 2 }, 0);
    r.go({ t: 'START' }, 0);
    const ev = evaluateCues(r.get(), r.p, at(0));
    expect(ev.map((e) => e.cue.atMs).sort((a, b) => b - a)).toEqual([60_000, 30_000]);
    expect(ev.every((e) => e.audible)).toBe(true); // not reported stale on frame one
  });

  it('survives a throttled jump and suppresses only genuinely stale audio', () => {
    const r = run(cfg());
    r.go({ t: 'ADVANCE' }, 0);
    r.go({ t: 'START' }, 0);
    const jump4 = evaluateCues(r.get(), r.p, at(124_000)); // 4s past the 60s cue
    expect(jump4).toHaveLength(1);
    expect(jump4[0]?.audible).toBe(true);
    const jump9 = evaluateCues(r.get(), r.p, at(129_000)); // 9s past
    expect(jump9[0]?.audible).toBe(false);
  });

  it('fires the grace triple once, past expiry', () => {
    const r = run(cfg());
    r.go({ t: 'LOAD', cursor: 2 }, 0);
    r.go({ t: 'START' }, 0);
    const s1 = markFired(r.get(), evaluateCues(r.get(), r.p, at(20_000)));
    const grace = evaluateCues(s1, r.p, at(35_000)).filter((e) => e.grace);
    expect(grace).toHaveLength(1);
    expect(grace[0]?.cue.tone).toBe('triple');
  });
});

describe('prep banks', () => {
  it('decrements across the round, restores the prior transport, and undoes cleanly', () => {
    const r = run(cfg());
    r.go({ t: 'ADVANCE' }, 0);
    r.go({ t: 'START' }, 0);
    r.go({ t: 'BANK_DRAW', side: 'A' }, 10_000);
    expect(r.get().run?.clockId).toBe('bank:A');
    expect(remainingMs(r.get(), 'seg00001', at(30_000))).toBe(170_000); // speech frozen
    r.go({ t: 'BANK_END' }, 30_000);
    expect(bankRemaining(r.get(), r.p, 'A', at(30_000))).toBe(40_000);
    expect(r.get().run?.clockId).toBe('seg00001'); // resumed because it was running
    // second draw eats into the same balance
    r.go({ t: 'BANK_DRAW', side: 'A' }, 40_000);
    r.go({ t: 'BANK_END' }, 60_000);
    expect(bankRemaining(r.get(), r.p, 'A', at(60_000))).toBe(20_000);
    r.go({ t: 'UNDO' }, 70_000);
    expect(r.get().bankDraw?.side).toBe('A');
    r.go({ t: 'UNDO' }, 70_000);
    expect(bankRemaining(r.get(), r.p, 'A', at(70_000))).toBe(40_000);
    expect(r.get().run?.clockId).toBe('seg00001');
  });
});

describe('undo', () => {
  it('does not bill the delay between the mistake and the undo', () => {
    const r = run(cfg());
    r.go({ t: 'ADVANCE' }, 0);
    r.go({ t: 'START' }, 0);
    r.go({ t: 'ADVANCE' }, 60_000); // mis-advance at 1:00
    r.go({ t: 'UNDO' }, 63_000); // caught three seconds later
    expect(r.get().cursor).toBe(0);
    expect(r.get().run?.clockId).toBe('seg00001');
    expect(remainingMs(r.get(), 'seg00001', at(63_000))).toBe(120_000);
    r.go({ t: 'REDO' }, 64_000);
    expect(r.get().cursor).toBe(1);
  });
});

describe('rebase + sleep', () => {
  it('reproduces the same remaining across a foreign time origin', () => {
    const r = run(cfg());
    r.go({ t: 'ADVANCE' }, 0);
    r.go({ t: 'START' }, 1_000);
    const local = at(21_000);
    expect(remainingMs(r.get(), 'seg00001', local)).toBe(160_000);
    // another document: same wall clock, wildly different performance.timeOrigin
    const foreign = nowFrom(9_000_000, T0 + 21_000);
    const anchor = rebase({ clockId: 'seg00001', startedAtEpoch: T0 + 1_000 }, foreign);
    const mirrored = { ...r.get(), run: anchor };
    expect(remainingMs(mirrored, 'seg00001', foreign)).toBe(160_000);
  });

  it('never moves a clock backwards when the wall clock steps back', () => {
    const back = nowFrom(1_000, T0 - 60_000);
    const anchor = rebase({ clockId: 'seg00001', startedAtEpoch: T0 }, back);
    expect(anchor.startedAtMono).toBe(1_000); // clamped forward-only
  });

  it('detects a suspend, holds, and reconciles either way', () => {
    const r = run(cfg());
    r.go({ t: 'ADVANCE' }, 0);
    r.go({ t: 'START' }, 0);
    const woke = nowFrom(10_000, T0 + 130_000); // mono froze, wall time ran on
    const gap = detectSleep(r.get(), woke);
    expect(gap?.gapMs).toBe(120_000);
    if (!gap) throw new Error('no gap');
    r.go({ t: 'HOLD', sleep: gap }, 10_000);
    expect(r.get().hold).toBe(true);
    expect(r.get().sleepPending?.gapMs).toBe(120_000);
    const kept = { ...r.get() };
    r.go({ t: 'RECONCILE', charge: false }, 10_000);
    expect(remainingMs(r.get(), 'seg00001', at(10_000))).toBe(170_000);
    r.set(kept);
    r.go({ t: 'RECONCILE', charge: true }, 10_000);
    expect(remainingMs(r.get(), 'seg00001', at(10_000))).toBe(50_000);
  });
});
