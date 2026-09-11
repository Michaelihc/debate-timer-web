/**
 * First run, resume, and the three pieces of global state that are neither round data nor
 * route: theme, audio arming, and whatever the boot sequence decided.
 *
 * Boot is async because a share link may need `DecompressionStream` (§12.2). It runs
 * exactly once per document — `bootOnce()` memoises its own promise, which is also what
 * makes it safe under StrictMode's double-mount.
 */

import { useSyncExternalStore } from 'react';
import type { L10n, RoundConfig } from '../domain/config';
import type { MigrationProblem } from '../domain/migrate';
import { migrate, parseAndMigrate } from '../domain/migrate';
import { plan as buildPlan } from '../domain/plan';
import type { Now } from '../engine/chronometer';
import { now } from '../engine/chronometer';
import type { LiveSnapshot, Prefs } from '../engine/persist';
import {
  clearLive,
  pushRecent,
  readApplied,
  readFreshLive,
  readPrefs,
  storageAvailable,
  writePrefs,
} from '../engine/persist';
import { fromSnapshot } from '../engine/rebase';
import { clockView, primaryClockId } from '../engine/selectors';
import type { RoundState, RunPlan } from '../engine/state';
import { armAudio, audioState, subscribeAudio } from '../engine/sound';
import type { AudioState } from '../engine/sound';
import { getSession, hydrate, loadRound } from '../engine/store';
import { tokenFromHash, tryDecodeShare } from '../lib/urlState';
import { ROUTES, currentRoute, navigate, replaceRoute } from './router';

/* ----------------------------------------------------------------------- theme */

export type Theme = 'dark' | 'light';

let theme: Theme = 'dark';
const themeListeners = new Set<() => void>();

function applyTheme(next: Theme): void {
  theme = next;
  if (typeof document !== 'undefined') document.documentElement.dataset['theme'] = next;
  for (const fn of themeListeners) fn();
}

export function getTheme(): Theme {
  return theme;
}

export function setTheme(next: Theme): void {
  if (next === theme) return;
  applyTheme(next);
  writePrefs({ theme: next });
}

export function toggleTheme(): void {
  setTheme(theme === 'dark' ? 'light' : 'dark');
}

export function subscribeTheme(fn: () => void): () => void {
  themeListeners.add(fn);
  return () => {
    themeListeners.delete(fn);
  };
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribeTheme, getTheme, getTheme);
}

/* ----------------------------------------------------------------------- audio */

// `audioState()` builds a fresh object on every call, which `useSyncExternalStore`
// treats as a change and loops on. One cached snapshot, replaced only when the sound
// module actually emits.
let audioSnapshot: AudioState = audioState();
const audioListeners = new Set<() => void>();
let audioBridge: (() => void) | null = null;

function ensureAudioBridge(): void {
  audioBridge ??= subscribeAudio((next) => {
    audioSnapshot = next;
    for (const fn of audioListeners) fn();
  });
}

function subscribeAudioStore(fn: () => void): () => void {
  ensureAudioBridge();
  audioListeners.add(fn);
  return () => {
    audioListeners.delete(fn);
  };
}

function getAudioSnapshot(): AudioState {
  return audioSnapshot;
}

/**
 * §13.13 — no autoplaying audio. The AudioContext is unlocked by the operator's first
 * real gesture anywhere in the app, and the result is shown permanently in band 1 rather
 * than buried. A refusal is not an error: the chip simply keeps saying TAP TO ENABLE.
 */
export function useAudio(): AudioState {
  return useSyncExternalStore(subscribeAudioStore, getAudioSnapshot, getAudioSnapshot);
}

export async function armAudioNow(): Promise<boolean> {
  return armAudio();
}

let armInstalled = false;

/** One-shot: the first pointer or key gesture arms audio, then the listeners retire. */
export function installAudioArm(): () => void {
  if (armInstalled || typeof window === 'undefined') return () => undefined;
  armInstalled = true;
  const arm = (): void => {
    void armAudio().then((ok) => {
      if (ok) remove();
    });
  };
  const remove = (): void => {
    window.removeEventListener('pointerdown', arm, true);
    window.removeEventListener('keydown', arm, true);
    armInstalled = false;
  };
  window.addEventListener('pointerdown', arm, true);
  window.addEventListener('keydown', arm, true);
  return remove;
}

/* ------------------------------------------------------------------ round loading */

export interface OpenOptions {
  /** Default `#/console`. Pass `ROUTES.edit` to open a preset for editing. */
  route?: string;
  /** Default true. */
  markApplied?: boolean;
  /** Default true; false for a preview that should not enter the recents list. */
  recent?: boolean;
  /** `replace` for a redirect the operator did not ask for. Default `push`. */
  history?: 'push' | 'replace';
}

/** Plan a config, make it the live round, and go to the screen that runs it. */
export function openConfig(config: RoundConfig, opts: OpenOptions = {}): RunPlan {
  const plan = buildPlan(config);
  loadRound(plan, { markApplied: opts.markApplied !== false });
  if (opts.recent !== false) {
    pushRecent(
      config.presetRef === undefined
        ? { id: config.id, title: config.title }
        : { id: config.id, title: config.title, presetRef: config.presetRef },
    );
  }
  const route = opts.route ?? ROUTES.console;
  if (opts.history === 'replace') replaceRoute(route);
  else navigate(route);
  return plan;
}

export interface ImportOutcome {
  config: RoundConfig | null;
  problems: MigrationProblem[];
}

/** Text from the paste field or a dropped file: share link, canonical JSON, or Unity save. */
export async function importText(text: string): Promise<ImportOutcome> {
  const trimmed = text.trim();
  if (trimmed === '') return { config: null, problems: [] };
  const hashAt = trimmed.indexOf('#');
  const token = hashAt >= 0 ? tokenFromHash(trimmed.slice(hashAt)) : null;
  if (token) {
    const decoded = await tryDecodeShare(token);
    if (!decoded.ok) {
      return {
        config: null,
        problems: [
          {
            code: 'BAD_JSON',
            severity: 'error',
            message: { en: decoded.error, zh: decoded.error },
          },
        ],
      };
    }
    const result = migrate(decoded.raw);
    return { config: result.config, problems: result.problems };
  }
  const result = parseAndMigrate(trimmed);
  return { config: result.config, problems: result.problems };
}

/** The `#/r/<codec>.<payload>` landing: decode, migrate, load, then replace the hash. */
export async function openShareToken(token: string): Promise<ImportOutcome> {
  const decoded = await tryDecodeShare(token);
  if (!decoded.ok) {
    setShareError(decoded.error);
    replaceRoute(ROUTES.launch);
    return { config: null, problems: [] };
  }
  const result = migrate(decoded.raw);
  if (!result.config) {
    setShareError(result.problems[0]?.message.en ?? 'Unreadable link');
    replaceRoute(ROUTES.launch);
    return { config: null, problems: result.problems };
  }
  openConfig(result.config, { history: 'replace' });
  return { config: result.config, problems: result.problems };
}

/* ------------------------------------------------------------------------ resume */

export interface ResumeOffer {
  config: RoundConfig;
  plan: RunPlan;
  /** The snapshot rebased onto this document's monotonic clock. */
  state: RoundState;
  snapshot: LiveSnapshot;
  title: L10n;
  /** 1-based, for `d.resumeBody`. */
  segmentIndex: number;
  segmentCount: number;
  remainingMs: number;
  /** How long ago the round was last touched. */
  ageMs: number;
}

function offerFrom(snapshot: LiveSnapshot, n: Now): ResumeOffer | null {
  let plan: RunPlan;
  let state: RoundState;
  try {
    plan = buildPlan(snapshot.config);
    state = fromSnapshot(snapshot.state, n);
  } catch {
    return null; // a snapshot from an incompatible build is ignored, never fatal
  }
  const id = primaryClockId(state, plan);
  const view = id ? clockView(state, plan, id, n) : null;
  return {
    config: snapshot.config,
    plan,
    state,
    snapshot,
    title: snapshot.config.title,
    segmentIndex: Math.min(plan.segments.length, Math.max(1, state.cursor + 1)),
    segmentCount: plan.segments.length,
    remainingMs: view?.remainingMs ?? 0,
    ageMs: Math.max(0, Date.now() - snapshot.updatedAt),
  };
}

/** Take the interrupted round: the anchors are rebased, so it resumes at its real time. */
export function acceptResume(offer: ResumeOffer): void {
  hydrate(offer.plan, offer.snapshot.state);
  dismissResume();
  navigate(ROUTES.console);
}

/** Decline it. The snapshot is dropped so the prompt does not return on the next load. */
export function discardResume(): void {
  clearLive();
  dismissResume();
}

/* -------------------------------------------------------------------- boot state */

export interface BootState {
  ready: boolean;
  /** An interrupted round younger than 8h, or null. */
  resume: ResumeOffer | null;
  /** Set when a `#/r/…` link could not be decoded; the app lands on Launch and says so. */
  shareError: string | null;
  /** False in private browsing or with site data blocked: the URL is the only store. */
  storage: boolean;
  prefs: Prefs;
}

let bootState: BootState = {
  ready: false,
  resume: null,
  shareError: null,
  storage: true,
  prefs: readPrefsSafe(),
};

function readPrefsSafe(): Prefs {
  try {
    return readPrefs();
  } catch {
    return {
      theme: 'dark',
      muted: false,
      volume: 0.8,
      lastRemoteKey: null,
    };
  }
}

const bootListeners = new Set<() => void>();

function setBoot(patch: Partial<BootState>): void {
  bootState = { ...bootState, ...patch };
  for (const fn of bootListeners) fn();
}

function setShareError(message: string): void {
  setBoot({ shareError: message });
}

export function clearShareError(): void {
  if (bootState.shareError !== null) setBoot({ shareError: null });
}

export function dismissResume(): void {
  if (bootState.resume !== null) setBoot({ resume: null });
}

export function getBootState(): BootState {
  return bootState;
}

export function subscribeBoot(fn: () => void): () => void {
  bootListeners.add(fn);
  return () => {
    bootListeners.delete(fn);
  };
}

export function useBootState(): BootState {
  return useSyncExternalStore(subscribeBoot, getBootState, getBootState);
}

let bootPromise: Promise<BootState> | null = null;

export function bootOnce(): Promise<BootState> {
  bootPromise ??= run();
  return bootPromise;
}

async function run(): Promise<BootState> {
  const prefs = readPrefsSafe();
  applyTheme(prefs.theme === 'light' ? 'light' : 'dark');
  setBoot({ prefs, storage: storageAvailable() });

  const route = currentRoute();

  // A shared link wins: the operator followed it on purpose, and it must never be
  // silently replaced by whatever this browser happened to have open last.
  if (route.name === 'share' && route.token) {
    await openShareToken(route.token);
    setBoot({ ready: true });
    return bootState;
  }

  const applied = readApplied();
  if (applied) {
    try {
      loadRound(buildPlan(applied), { markApplied: false });
    } catch {
      // A stored config this build cannot plan is ignored; the empty session stands.
    }
  }

  const snapshot = readFreshLive();
  const offer = snapshot ? offerFrom(snapshot, now()) : null;
  // An interrupted round is offered, never taken: resuming a round the operator has
  // moved on from is the more expensive mistake.
  setBoot({ resume: offer, ready: true });

  // Nothing to run and nothing to resume: start where a round gets chosen.
  if (!applied && !offer && route.name === 'console') replaceRoute(ROUTES.launch);

  return bootState;
}

/** True when the live round is still the empty placeholder session. */
export function hasRound(): boolean {
  return getSession().plan.segments.length > 0;
}
