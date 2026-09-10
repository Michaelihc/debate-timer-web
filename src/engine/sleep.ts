/**
 * Sleep / suspend reconciliation (§5.4).
 *
 * `performance.now()` includes suspend time on some OS/browser pairs and excludes it on
 * others, so there is no "better clock" to pick. What you CAN do is detect the
 * discontinuity — the skew between wall time and monotonic time changed since the anchor
 * was set — freeze the round, and hand the decision to the human with both candidate
 * values printed. That is the honest answer to the most common real-world failure of a
 * laptop-driven venue timer.
 */

import type { Now } from './chronometer';
import type { Command, RoundState } from './state';
import type { ClockId } from './state';

/** Below this, ordinary scheduler jitter and NTP slew are indistinguishable from a nap. */
export const SLEEP_THRESHOLD_MS = 5000;

export interface SleepGap {
  /** > 0: wall time advanced while monotonic time did not — the clock UNDER-counted. */
  gapMs: number;
  clockId: ClockId;
}

/**
 * Call every frame and on `visibilitychange`, `pageshow` and `focus`. Returns null unless
 * a genuine discontinuity is present and has not already been raised.
 */
export function detectSleep(
  s: RoundState,
  n: Now,
  thresholdMs: number = SLEEP_THRESHOLD_MS,
): SleepGap | null {
  if (s.hold || s.sleepPending) return null;
  const a = s.run ?? s.roundRun;
  if (!a) return null;
  const gapMs = n.epoch - n.mono - a.skewAtStart;
  if (Math.abs(gapMs) <= thresholdMs) return null;
  return { gapMs, clockId: a.clockId };
}

/** The round auto-HOLDs and the console raises the reconcile dialog. */
export function sleepHoldCommand(gap: SleepGap): Command {
  return { t: 'HOLD', sleep: gap };
}

/**
 * `charge: true` bills the suspended interval to the clock that was running (the room
 * really did keep going); `charge: false` leaves it uncharged (the laptop lid was shut
 * between speeches). Both are legitimate — only the operator knows which happened.
 */
export function reconcileCommand(charge: boolean): Command {
  return { t: 'RECONCILE', charge };
}

/** The two numbers the reconcile dialog prints, so the operator chooses between values
 *  rather than between words. */
export function reconcileCandidates(
  gap: SleepGap,
  currentRemainingMs: number,
): { keep: number; charge: number } {
  return { keep: currentRemainingMs, charge: currentRemainingMs - gap.gapMs };
}
