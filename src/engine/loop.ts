// §5.2 — THE single requestAnimationFrame loop for this document.
//
// The loop writes ticking digits straight to DOM nodes through registered writers.
// React state changes only when something discrete happens (a cue latches, a phase
// band steps, a segment loads), which is what keeps a 60fps clock at roughly zero
// renders per second.

import type { Now } from './chronometer';
import { now } from './chronometer';
import type { CueEvent } from './cues';
import { evaluateCues, pendingCues } from './cues';
import { writeLive } from './persist';
import { detectSleep, sleepHoldCommand } from './sleep';
import {
  PRESCHEDULE_HORIZON_MS,
  cancelScheduled,
  forgetCue,
  playCue,
  scheduleCue,
  subscribeAudio,
} from './sound';
import type { Session } from './store';
import { applyCueEvents, dispatch, getSession, isFollower, subscribe } from './store';

export type TickWriter = (n: Now) => void;
export type CueListener = (event: CueEvent) => void;

const SNAPSHOT_INTERVAL_MS = 1000;

const writers = new Set<TickWriter>();
const cueListeners = new Set<CueListener>();

let rafId = 0;
let onceId = 0;
let lastSnapshotMono = 0;
let stopStore: (() => void) | null = null;
let stopAudio: (() => void) | null = null;
let started = false;

/** Register a per-frame DOM writer. Writers paint and nothing else — they must not
 *  dispatch, because a command inside a frame would re-enter this loop's own state. */
export function registerTick(fn: TickWriter): () => void {
  writers.add(fn);
  paintSoon();
  return () => {
    writers.delete(fn);
  };
}

/** Discrete cue notifications for the surfaces that flash, swell or announce. */
export function onCue(fn: CueListener): () => void {
  cueListeners.add(fn);
  return () => {
    cueListeners.delete(fn);
  };
}

export function isLooping(): boolean {
  return rafId !== 0;
}

function paint(n: Now): void {
  for (const w of writers) w(n);
}

function fireCues(events: readonly CueEvent[]): void {
  for (const e of events) {
    // A cue within 30s was already put on the audio timeline; `playCue` recognises
    // the key and stays quiet rather than ringing it twice. A cue found more than
    // 5s late keeps its visual state but loses its bell — a stale bell is a lie.
    if (e.audible) playCue(e.cue.tone, e.key);
    else cancelScheduled(e.key);
    for (const fn of cueListeners) fn(e);
  }
  applyCueEvents(events);
}

function frame(): void {
  const n = now();
  const s = getSession();

  const gap = detectSleep(s.state, n);
  if (gap && !isFollower()) dispatch(sleepHoldCommand(gap));

  const events = evaluateCues(s.state, s.plan, n);
  if (events.length > 0) fireCues(events);

  paint(n);

  // Re-read: latching a cue above replaced the session, and the snapshot should
  // carry the cues that have already fired.
  const after = getSession();
  if (after.state.run && !isFollower() && n.mono - lastSnapshotMono >= SNAPSHOT_INTERVAL_MS) {
    lastSnapshotMono = n.mono;
    writeLive(after.config, after.state);
  }

  rafId = requestAnimationFrame(frame);
}

function shouldLoop(s: Session): boolean {
  if (s.state.hold) return false;
  return s.state.run !== null || s.state.coRun !== null || s.state.roundRun !== null;
}

function startLoop(): void {
  if (rafId !== 0) return;
  lastSnapshotMono = now().mono;
  rafId = requestAnimationFrame(frame);
}

function stopLoop(): void {
  if (rafId === 0) return;
  cancelAnimationFrame(rafId);
  rafId = 0;
}

/** One-shot repaint, for the moments where nothing is running but the readout
 *  changed anyway — a segment armed, an adjust while paused, a rewind. */
export function paintSoon(): void {
  if (rafId !== 0 || onceId !== 0) return;
  onceId = requestAnimationFrame(() => {
    onceId = 0;
    paint(now());
  });
}

// ------------------------------------------------------- audio pre-scheduling

/** R15: every cue due within 30s goes onto the AudioContext timeline now, because
 *  a background tab throttles rAF and timers but never the audio thread. Any
 *  command can move the due time, so this runs after every one of them. */
function rescheduleAudio(s: Session): void {
  cancelScheduled();
  if (s.state.hold) return;
  for (const p of pendingCues(s.state, s.plan, now())) {
    forgetCue(p.key); // a rewind un-fires the latch; let the bell arm again
    if (p.inMs > 0 && p.inMs <= PRESCHEDULE_HORIZON_MS) scheduleCue(p.cue.tone, p.inMs, p.key);
  }
}

// ------------------------------------------------------------------ lifecycle

function onStoreChange(): void {
  const s = getSession();
  rescheduleAudio(s);
  if (shouldLoop(s)) startLoop();
  else {
    stopLoop();
    paintSoon();
  }
}

// A suspend is only observable once the document is alive again, and on some
// OS/browser pairs no frame runs in between — so check on the wake events too.
function onWake(): void {
  const s = getSession();
  const gap = detectSleep(s.state, now());
  if (gap && !isFollower()) dispatch(sleepHoldCommand(gap));
  paintSoon();
}

export function startEngine(): () => void {
  if (started) return stopEngine;
  started = true;
  stopStore = subscribe(onStoreChange);
  // Arming or unmuting mid-round must put the pending bells back on the audio
  // timeline immediately — waiting for the next command could cost the operator
  // the very cue they just enabled sound for.
  stopAudio = subscribeAudio(() => {
    rescheduleAudio(getSession());
  });
  document.addEventListener('visibilitychange', onWake);
  window.addEventListener('pageshow', onWake);
  window.addEventListener('focus', onWake);
  onStoreChange();
  return stopEngine;
}

export function stopEngine(): void {
  if (!started) return;
  started = false;
  stopLoop();
  if (onceId !== 0) {
    cancelAnimationFrame(onceId);
    onceId = 0;
  }
  cancelScheduled();
  stopStore?.();
  stopStore = null;
  stopAudio?.();
  stopAudio = null;
  document.removeEventListener('visibilitychange', onWake);
  window.removeEventListener('pageshow', onWake);
  window.removeEventListener('focus', onWake);
}
