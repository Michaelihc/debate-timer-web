// Module-scope store. One session — plan + round state — per document.
//
// R4: ID-keyed clocks are the source of truth for "go back and resume at 1:42".
// The undo stack lives inside `RoundState` (state.ts) and is driven by the `UNDO`
// and `REDO` commands, so an undone round is restored by the same pure reducer
// that produced it; this module only routes commands and persists the result.

import { useSyncExternalStore } from 'react';
import type { Id, RoundConfig } from '../domain/config';
import { SCHEMA_VERSION, defaultRules, defaultSides } from '../domain/config';
import { newId } from '../domain/id';
import { plan as buildPlan } from '../domain/plan';
import type { Now } from './chronometer';
import { now } from './chronometer';
import type { CueEvent } from './cues';
import { markFired } from './cues';
import { writeApplied, writeLive } from './persist';
import type { SnapshotState, StageFrame } from './rebase';
import { applyStageFrame, fromSnapshot } from './rebase';
import { reduce } from './reducer';
import type { Command, RoundState, RunPlan } from './state';
import { initialState } from './state';

export interface Session {
  /** Always `plan.config` — carried separately because most consumers want only it. */
  config: RoundConfig;
  plan: RunPlan;
  state: RoundState;
}

/** Stands in until `loadRound()` runs, so `getSession()` is never null and no
 *  component has to render a "no round yet" branch during boot. */
function emptyPlan(): RunPlan {
  const config: RoundConfig = {
    v: SCHEMA_VERSION,
    id: newId() as Id,
    title: { en: 'Untitled round', zh: '未命名比赛' },
    sides: defaultSides(),
    speakers: [],
    segments: [],
    rules: defaultRules(),
  };
  return buildPlan(config);
}

function sessionOf(plan: RunPlan, state: RoundState): Session {
  return { config: plan.config, plan, state };
}

let session: Session = (() => {
  const plan = emptyPlan();
  return sessionOf(plan, initialState(plan));
})();

let follower = false;
let persistEnabled = true;

const listeners = new Set<() => void>();

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(): void {
  for (const fn of listeners) fn();
}

export function getSession(): Session {
  return session;
}

export function getState(): RoundState {
  return session.state;
}

export function getPlan(): RunPlan {
  return session.plan;
}

export function getConfig(): RoundConfig {
  return session.config;
}

export function isFollower(): boolean {
  return follower;
}

/** A follower window mirrors the leader: it never dispatches, never persists and
 *  never claims leadership (§12.3). */
export function setFollower(on: boolean): void {
  follower = on;
}

export function setPersistEnabled(on: boolean): void {
  persistEnabled = on;
}

function persist(): void {
  if (!persistEnabled || follower) return;
  writeLive(session.config, session.state);
}

function commit(next: Session, options?: { persist?: boolean }): void {
  session = next;
  emit();
  if (options?.persist !== false) persist();
}

// ------------------------------------------------------------------- commands

export function dispatch(cmd: Command, n: Now = now()): void {
  if (follower) return;
  const prev = session.state;
  const next = reduce(prev, cmd, { plan: session.plan, now: n });
  if (next === prev) return;
  commit(sessionOf(session.plan, next));
}

export function undo(): void {
  dispatch({ t: 'UNDO' });
}

export function redo(): void {
  dispatch({ t: 'REDO' });
}

export function canUndo(): boolean {
  return session.state.undo.length > 0;
}

export function canRedo(): boolean {
  return session.state.redo.length > 0;
}

/** The command the next `undo()` would take back, for the undo chip (§7.14). */
export function peekUndo(): Command | null {
  const top = session.state.undo[session.state.undo.length - 1];
  return top ? top.cmd : null;
}

/** Latch fired cues. Not a command: cue firing is an observation of time passing,
 *  not an operator action, and must never land on the undo stack. */
export function applyCueEvents(events: readonly CueEvent[]): void {
  if (events.length === 0) return;
  const next = markFired(session.state, events);
  if (next === session.state) return;
  commit(sessionOf(session.plan, next));
}

// -------------------------------------------------------------------- loading

/** Load a plan and start a fresh round. */
export function loadRound(plan: RunPlan, opts?: { markApplied?: boolean }): void {
  if (opts?.markApplied !== false && !follower) writeApplied(plan.config);
  commit(sessionOf(plan, initialState(plan)));
}

/** Swap the plan under a live round (an editor apply). The caller reconciles the
 *  clocks by stable id first — `reconcileState()` in state.ts does exactly that. */
export function replacePlan(plan: RunPlan, state: RoundState): void {
  if (!follower) writeApplied(plan.config);
  commit(sessionOf(plan, state));
}

/** Restore a persisted snapshot. Every epoch anchor is re-based to this document's
 *  monotonic clock (§5.3), so the segment resumes at its exact remaining time. */
export function hydrate(plan: RunPlan, snapshot: SnapshotState, n: Now = now()): void {
  commit(sessionOf(plan, fromSnapshot(snapshot, n)), { persist: false });
}

// ------------------------------------------------------------------- follower

/** Follower-only: adopt the leader's frame. Bypasses the reducer, the undo stack
 *  and persistence — a mirror has no history of its own. */
export function applyFrame(frame: StageFrame, n: Now = now()): void {
  commit(sessionOf(session.plan, applyStageFrame(session.state, frame, n)), { persist: false });
}

/** Follower-only: adopt the leader's plan after a configHash mismatch. */
export function adoptPlan(plan: RunPlan): void {
  commit(sessionOf(plan, session.state), { persist: false });
}

// ------------------------------------------------------------------ React glue

export function useRound(): Session {
  return useSyncExternalStore(subscribe, getSession, getSession);
}

// Selected values are cached per selector identity, so `getSnapshot` is stable
// across the several calls React makes per render. Pass a module-level function
// (or one returning a primitive); an inline arrow that builds a fresh object on
// every render has a fresh identity too, and defeats the cache.
const selectorCache = new WeakMap<object, { snap: Session; value: unknown }>();

export function useRoundSelector<T>(
  selector: (s: Session) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const read = (): T => readSelector(selector, isEqual);
  return useSyncExternalStore(subscribe, read, read);
}

function readSelector<T>(selector: (s: Session) => T, isEqual: (a: T, b: T) => boolean): T {
  const snap = session;
  const hit = selectorCache.get(selector);
  if (hit && hit.snap === snap) return hit.value as T;
  const next = selector(snap);
  const value = hit && isEqual(hit.value as T, next) ? (hit.value as T) : next;
  selectorCache.set(selector, { snap, value });
  return value;
}
