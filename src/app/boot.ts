/**
 * First run, resume, and the three pieces of global state that are neither round data nor
 * route: theme, audio arming, and whatever the boot sequence decided.
 *
 * Boot is async because a share link may need `DecompressionStream` (§12.2). It runs
 * exactly once per document — `bootOnce()` memoises its own promise, which is also what
 * makes it safe under StrictMode's double-mount.
 */

import { useSyncExternalStore } from 'react';
import type { RoundConfig } from '../domain/config';
import type { MigrationProblem } from '../domain/migrate';
import { migrate, parseAndMigrate } from '../domain/migrate';
import { plan as buildPlan } from '../domain/plan';
import type { Now } from '../engine/chronometer';
import { now } from '../engine/chronometer';
import type { Prefs, RecentEntry } from '../engine/persist';
import {
  pushRecent,
  readApplied,
  readBaseline,
  readFreshLive,
  readLibrary,
  readPrefs,
  readRecents,
  saveToLibrary,
  storageAvailable,
  writeBaseline,
  writePrefs,
} from '../engine/persist';
import { fromSnapshot } from '../engine/rebase';
import { roundPhase } from '../engine/selectors';
import type { RoundState, RunPlan } from '../engine/state';
import { reconcileState } from '../engine/state';
import { armAudio, audioState, subscribeAudio } from '../engine/sound';
import type { AudioState } from '../engine/sound';
import { getSession, loadRound, restoreRound } from '../engine/store';
import { getLang, resolveL10n, translate } from '../i18n/useLang';
import { configHash } from '../lib/hash';
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

/* ---------------------------------------------------------------------- legend */

// The keyboard legend outlives a route change, so whether it is open lives here rather
// than in one screen: the shell renders it, `?` toggles it, and any screen can open it
// from a button.
let legendOpen = false;
const legendListeners = new Set<() => void>();

function setLegend(next: boolean): void {
  if (next === legendOpen) return;
  legendOpen = next;
  for (const fn of legendListeners) fn();
}

export function openLegend(): void {
  setLegend(true);
}

export function closeLegend(): void {
  setLegend(false);
}

export function toggleLegend(): void {
  setLegend(!legendOpen);
}

function subscribeLegend(fn: () => void): () => void {
  legendListeners.add(fn);
  return () => {
    legendListeners.delete(fn);
  };
}

function getLegendOpen(): boolean {
  return legendOpen;
}

export function useLegendOpen(): boolean {
  return useSyncExternalStore(subscribeLegend, getLegendOpen, getLegendOpen);
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

/** A recents row for a config: its id, its title, and the format it came from. */
function recentOf(config: RoundConfig): Omit<RecentEntry, 'updatedAt'> {
  return config.presetRef === undefined
    ? { id: config.id, title: config.title }
    : { id: config.id, title: config.title, presetRef: config.presetRef };
}

/** Plan a config, make it the live round, and go to the screen that runs it. */
export function openConfig(config: RoundConfig, opts: OpenOptions = {}): RunPlan {
  const plan = buildPlan(config);
  loadRound(plan, { markApplied: opts.markApplied !== false });
  // The round as it was opened. An editor apply moves the hash away from this, which is
  // how a later replace knows there are edits worth keeping.
  writeBaseline({ id: config.id, hash: plan.hash });
  if (opts.recent !== false) pushRecent(recentOf(config));
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

/* ------------------------------------------------------------- replacing a round */

/** What is at stake when the loaded round is about to be replaced by another one. */
export interface Outgoing {
  config: RoundConfig;
  /** Under way: a segment is loaded and the round has not ended. */
  progress: boolean;
  /** Changed since it was opened (or since the copy saved in the library). */
  edited: boolean;
  /** Belongs in Recent rounds: under way, edited, finished, or already listed. */
  keep: boolean;
}

function isEdited(config: RoundConfig, plan: RunPlan): boolean {
  const baseline = readBaseline();
  if (baseline !== null && baseline.id === config.id) return baseline.hash !== plan.hash;
  const saved = readLibrary()[config.id]?.config;
  return saved === undefined ? false : configHash(saved) !== plan.hash;
}

function outgoingOf(plan: RunPlan, state: RoundState): Outgoing | null {
  const config = plan.config;
  const edited = isEdited(config, plan);
  // The empty placeholder, or a blank round nobody has touched: nothing to lose.
  if (plan.segments.length === 0 && !edited) return null;
  const phase = roundPhase(state, plan);
  const progress = phase === 'in';
  const listed = readRecents().some((entry) => entry.id === config.id);
  return { config, progress, edited, keep: progress || edited || listed || phase === 'complete' };
}

/** The loaded round, described as something about to be replaced; null when there is
 *  nothing real loaded. */
export function outgoingRound(): Outgoing | null {
  const s = getSession();
  return outgoingOf(s.plan, s.state);
}

/** Save a round to the library and put it in Recent rounds, edits and all. */
export function keepRound(config: RoundConfig): void {
  const lang = getLang();
  const name = resolveL10n(config.title, lang) || translate(lang, 'lc.untitled');
  saveToLibrary(config.id, config, name);
  pushRecent(recentOf(config));
}

/* ------------------------------------------------------------------------ resume */

/** Boot put back a round that was under way while the operator was on the launch screen. */
export interface ResumeOffer {
  /** When its snapshot was last written: its last command, or its last second running. */
  updatedAt: number;
}

export interface Restored {
  plan: RunPlan;
  state: RoundState;
  /** The snapshot's write time, or null when the applied round was loaded fresh. */
  updatedAt: number | null;
}

/**
 * Put back the round this browser was running, exactly where it was.
 *
 * The live snapshot is the truth about the clocks and the applied config is the truth
 * about the round's shape. When they are the same round, the snapshot's anchors are
 * re-based onto this document's clock, so a running clock is charged the wall time that
 * passed while the page was gone, and a config that moved on since is reconciled by
 * stable id. Only when there is no usable snapshot is the applied round loaded fresh.
 *
 * Nothing here writes to storage. Boot used to load the applied round with a normal commit,
 * which persisted a pre-round state over the snapshot a moment before reading it back: that
 * is how a reload lost the operator's place.
 */
export function restoreSession(n: Now = now()): Restored | null {
  const applied = readApplied();
  const snapshot = readFreshLive();
  if (snapshot !== null && (applied === null || applied.id === snapshot.config.id)) {
    try {
      const plan = buildPlan(applied ?? snapshot.config);
      let state = fromSnapshot(snapshot.state, n);
      if (state.configHash !== plan.hash) state = reconcileState(state, plan).state;
      restoreRound(plan, state);
      return { plan, state, updatedAt: snapshot.updatedAt };
    } catch {
      // A snapshot from an incompatible build is ignored, never fatal.
    }
  }
  if (applied !== null) {
    try {
      const plan = buildPlan(applied);
      loadRound(plan, { markApplied: false, persist: false });
      return { plan, state: getSession().state, updatedAt: null };
    } catch {
      // A stored config this build cannot plan is ignored; the empty session stands.
    }
  }
  return null;
}

/** Carry on with the loaded round, on the console. */
export function resumeRound(): void {
  dismissResume();
  navigate(ROUTES.console);
}

/** Start the loaded round over from before its first segment, on disk too. */
export function restartRound(): void {
  loadRound(getSession().plan, { markApplied: false });
  dismissResume();
}

/* -------------------------------------------------------------------- boot state */

export interface BootState {
  ready: boolean;
  /** Boot put back a round under way (snapshot younger than 8h) and landed on launch. */
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
  // silently replaced by whatever this browser happened to have open last. The round it
  // replaces is still the operator's, though: it goes into Recent rounds, edits and all,
  // and stays loaded if the link turns out to be unreadable.
  if (route.name === 'share' && route.token) {
    const previous = restoreSession();
    const outgoing = previous === null ? null : outgoingOf(previous.plan, previous.state);
    if (outgoing?.keep === true) keepRound(outgoing.config);
    await openShareToken(route.token);
    setBoot({ ready: true });
    return bootState;
  }

  // A reload, a crash or a sleep costs seconds, not the round: whatever was running is put
  // back where it was. On the console it simply carries on. On the launch screen the banner
  // says where it stands and when it was last touched.
  const restored = restoreSession();
  const offer: ResumeOffer | null =
    restored !== null &&
    restored.updatedAt !== null &&
    route.name === 'launch' &&
    roundPhase(restored.state, restored.plan) === 'in'
      ? { updatedAt: restored.updatedAt }
      : null;
  setBoot({ resume: offer, ready: true });

  // Nothing to run: start where a round gets chosen.
  if (restored === null && route.name === 'console') replaceRoute(ROUTES.launch);

  return bootState;
}

/** True when the live round is still the empty placeholder session. */
export function hasRound(): boolean {
  return getSession().plan.segments.length > 0;
}
