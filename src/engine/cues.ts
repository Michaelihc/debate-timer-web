/**
 * Cues — latched, never edge-detected (§5.5, ruling R6).
 *
 * A cue is a PREDICATE over derived state (`remaining <= atMs`), latched by
 * `${clockId}@${atMs}` so it fires exactly once per clock per visit. It is not a
 * frame-crossing test, so a GC pause, a 4-second throttle or a hidden tab cannot skip it,
 * and a cue whose threshold is at or above the allotment fires on the first running frame
 * instead of never (Unity bugs #5 and #6: `remaining <= t && remaining + dt > t` is false
 * on frame one and false at exact equality).
 */

import type { CueSpec } from '../domain/config';
import type { Now } from './chronometer';
import { remainingMs, runningClockIds } from './chronometer';
import type { ClockId, ClockPlan, RoundState, RunPlan } from './state';

/** Beyond this much lateness a cue still fires its visual state, but stays silent. */
export const LATE_AUDIO_MS = 5000;

/** The grace cue's latch suffix. Not `@${-graceMs}`, so editing grace never orphans it. */
export const GRACE_SUFFIX = 'grace';

export function cueKey(clockId: ClockId, at: number | typeof GRACE_SUFFIX): string {
  return `${clockId}@${at}`;
}

export function graceCue(graceMs: number): CueSpec {
  return { atMs: -graceMs, tone: 'triple' };
}

export interface CueEvent {
  key: string;
  clockId: ClockId;
  /** null for a prep bank, which belongs to a side rather than a segment. */
  segId: string | null;
  cue: CueSpec;
  /** How long ago this cue should have fired, in clock time. */
  lateMs: number;
  /** False for a cue discovered more than `LATE_AUDIO_MS` late — stale bells are worse
   *  than no bell, but the visual state still lands. */
  audible: boolean;
  grace: boolean;
}

/** Segment clocks only: a prep bank has no ladder and no grace bell. */
function laddered(plan: RunPlan, clockId: ClockId): ClockPlan | null {
  const pc = plan.clocks[clockId];
  if (!pc || pc.kind === 'bank') return null;
  return pc;
}

/**
 * Everything that should fire at this instant. Pure — the caller latches the result with
 * `markFired` and plays the audible ones. Safe to call every frame.
 */
export function evaluateCues(s: RoundState, plan: RunPlan, n: Now): CueEvent[] {
  if (s.hold) return [];
  const out: CueEvent[] = [];

  for (const clockId of runningClockIds(s)) {
    const pc = laddered(plan, clockId);
    if (!pc) continue;
    const { graceMs, overtimeCapMs } = pc;
    const rem = remainingMs(s, clockId, n);
    if (rem < -overtimeCapMs) continue; // past the cap nothing escalates; the number keeps counting
    const allottedMs = s.clocks[clockId]?.allottedMs ?? pc.allottedMs;

    for (const cue of pc.cues) {
      const key = cueKey(clockId, cue.atMs);
      if (s.cuesFired[key] || rem > cue.atMs) continue;
      // Lateness is measured from the first moment this cue COULD have fired, not from
      // its raw threshold — otherwise a 1:00 warning on a 0:30 speech would be reported
      // 30s late and silenced on the very frame it is supposed to ring.
      const lateMs = Math.max(0, Math.min(cue.atMs, allottedMs) - rem);
      out.push({
        key,
        clockId,
        segId: pc.segId,
        cue,
        lateMs,
        audible: lateMs <= LATE_AUDIO_MS,
        grace: false,
      });
    }

    if (graceMs > 0) {
      const key = cueKey(clockId, GRACE_SUFFIX);
      if (!s.cuesFired[key] && rem <= -graceMs) {
        const lateMs = Math.max(0, -graceMs - rem);
        out.push({
          key,
          clockId,
          segId: pc.segId,
          cue: graceCue(graceMs),
          lateMs,
          audible: lateMs <= LATE_AUDIO_MS,
          grace: true,
        });
      }
    }
  }
  return out;
}

export function markFired(s: RoundState, events: readonly CueEvent[]): RoundState {
  if (events.length === 0) return s;
  const cuesFired = { ...s.cuesFired };
  for (const e of events) cuesFired[e.key] = true;
  return { ...s, cuesFired };
}

/**
 * Re-arm a clock's ladder after a rewind (`PREV`, `ADJUST`, `RESET_SEGMENT`, undo): any
 * threshold the clock has not reached again is un-latched, so the bells ring a second time
 * on the way back down. Thresholds already behind the new remaining stay latched.
 */
export function reArm(s: RoundState, plan: RunPlan, clockId: ClockId, n: Now): RoundState {
  const pc = laddered(plan, clockId);
  if (!pc) return s;
  const rem = remainingMs(s, clockId, n);
  const { graceMs } = pc;

  let fired = s.cuesFired;
  let changed = false;
  const clear = (key: string): void => {
    if (!fired[key]) return;
    if (!changed) {
      fired = { ...fired };
      changed = true;
    }
    delete fired[key];
  };

  for (const cue of pc.cues) if (rem > cue.atMs) clear(cueKey(clockId, cue.atMs));
  if (rem > -graceMs) clear(cueKey(clockId, GRACE_SUFFIX));

  return changed ? { ...s, cuesFired: fired } : s;
}

/** Drop every latch on a clock. `RESET_SEGMENT` restores a segment to virgin state. */
export function clearClockCues(s: RoundState, clockIds: readonly ClockId[]): RoundState {
  if (clockIds.length === 0) return s;
  const prefixes = clockIds.map((id) => `${id}@`);
  const keys = Object.keys(s.cuesFired).filter((k) => prefixes.some((p) => k.startsWith(p)));
  if (keys.length === 0) return s;
  const cuesFired = { ...s.cuesFired };
  for (const k of keys) delete cuesFired[k];
  return { ...s, cuesFired };
}

export interface PendingCue {
  key: string;
  cue: CueSpec;
  /** Clock-time until it fires. Feed straight to `AudioContext` pre-scheduling (§5.6). */
  inMs: number;
}

/** Every un-fired cue on one clock that has not yet come due, soonest first. */
function pendingOn(
  s: RoundState,
  plan: RunPlan,
  clockId: ClockId,
  n: Now,
): PendingCue[] {
  const pc = laddered(plan, clockId);
  if (!pc) return [];
  const rem = remainingMs(s, clockId, n);
  const { graceMs, overtimeCapMs } = pc;

  const candidates: Array<[CueSpec, string]> = pc.cues.map((cue) => [
    cue,
    cueKey(clockId, cue.atMs),
  ]);
  if (graceMs > 0) candidates.push([graceCue(graceMs), cueKey(clockId, GRACE_SUFFIX)]);

  const out: PendingCue[] = [];
  for (const [cue, key] of candidates) {
    if (s.cuesFired[key] || cue.atMs > rem || cue.atMs < -overtimeCapMs) continue;
    out.push({ key, cue, inMs: rem - cue.atMs });
  }
  return out.sort((a, b) => a.inMs - b.inMs);
}

/**
 * The next un-fired cue on a clock. `sound.ts` pre-schedules any cue within 30s on the
 * audio thread, which is the only way a bell survives a background tab.
 */
export function nextCue(
  s: RoundState,
  plan: RunPlan,
  clockId: ClockId,
  n: Now,
): PendingCue | null {
  return pendingOn(s, plan, clockId, n)[0] ?? null;
}

/**
 * EVERY pending cue on every running clock, soonest first — what the audio scheduler
 * re-arms after any `PAUSE`, `ADJUST`, `SWAP`, `HOLD`, `ADVANCE` or `PREV`.
 *
 * All of them, not just the nearest: a fully hidden tab gets no rAF at all, so the only
 * bells that ring are the ones already on the audio timeline when it went away. Handing
 * back one cue per clock would ring the 1:00 warning and then silently drop the bell at
 * time. The caller applies its own 30s horizon.
 */
export function pendingCues(
  s: RoundState,
  plan: RunPlan,
  n: Now,
): Array<PendingCue & { clockId: ClockId }> {
  if (s.hold) return [];
  const out: Array<PendingCue & { clockId: ClockId }> = [];
  for (const clockId of runningClockIds(s)) {
    for (const p of pendingOn(s, plan, clockId, n)) out.push({ ...p, clockId });
  }
  return out.sort((a, b) => a.inMs - b.inMs);
}
