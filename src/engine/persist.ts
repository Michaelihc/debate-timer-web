// §12.1 — every read and write is individually try/caught. The app must run correctly
// with storage throwing (private browsing, blocked site data): URL-only operation is the
// guaranteed path, localStorage is the convenience.

import type { L10n, RoundConfig } from '../domain/config';
import type { SnapshotState } from './rebase';
import { toSnapshot } from './rebase';
import type { RoundState } from './state';

export const KEYS = {
  prefs: 'dt.v3.prefs',
  library: 'dt.v3.library',
  draft: 'dt.v3.draft',
  applied: 'dt.v3.applied',
  recents: 'dt.v3.recents',
  live: 'dt.v3.live',
  link: 'dt.v3.link',
  baseline: 'dt.v3.baseline',
} as const;

export const SNAPSHOT_MAX_AGE_MS = 8 * 60 * 60 * 1000;
export const DRAFT_DEBOUNCE_MS = 400;
const RECENTS_CAP = 8;

/** UI language is NOT here — `i18n/useLang.ts` owns `dt.v3.lang`. */
export interface Prefs {
  theme: 'dark' | 'light';
  muted: boolean;
  volume: number;
  lastRemoteKey: string | null;
}

export interface LibraryEntry {
  config: RoundConfig;
  name: string;
  updatedAt: number;
}

export interface DraftRecord {
  config: RoundConfig;
  updatedAt: number;
}

export interface RecentEntry {
  id: string;
  title: L10n;
  presetRef?: string;
  updatedAt: number;
}

/** `SnapshotState` (epoch anchors, no undo stacks) is defined by `rebase.ts` —
 *  `startedAtMono` is meaningless across a process death and is re-derived on restore. */
export interface LiveSnapshot {
  config: RoundConfig;
  state: SnapshotState;
  updatedAt: number;
}

export type StorageWarning = 'quota' | 'unavailable';

const DEFAULT_PREFS: Prefs = {
  theme: 'dark',
  muted: false,
  volume: 0.8,
  lastRemoteKey: null,
};

// ---------------------------------------------------------------- raw access

const warningListeners = new Set<(kind: StorageWarning) => void>();
let lastWarning: StorageWarning | null = null;

export function onStorageWarning(fn: (kind: StorageWarning) => void): () => void {
  warningListeners.add(fn);
  return () => {
    warningListeners.delete(fn);
  };
}

export function lastStorageWarning(): StorageWarning | null {
  return lastWarning;
}

function warn(kind: StorageWarning): void {
  lastWarning = kind;
  for (const fn of warningListeners) fn(kind);
}

function isQuotaError(err: unknown): boolean {
  if (!(err instanceof DOMException)) return false;
  return (
    err.name === 'QuotaExceededError' ||
    err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    err.code === 22
  );
}

export function storageAvailable(): boolean {
  try {
    const probe = 'dt.v3.__probe';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function removeRaw(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable — nothing to remove */
  }
}

function writeRaw(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    if (isQuotaError(err)) {
      // Quota degradation order: the live snapshot goes first, because it is
      // rewritten on the very next command anyway.
      if (key !== KEYS.live) {
        removeRaw(KEYS.live);
        try {
          localStorage.setItem(key, value);
          return true;
        } catch {
          /* still over quota — fall through to the warning */
        }
      }
      warn('quota');
    } else {
      warn('unavailable');
    }
    return false;
  }
}

function readJson<T>(key: string): T | null {
  const raw = readRaw(key);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed === null ? null : (parsed as T);
  } catch {
    // A corrupt entry must never take the app down and must never be rewritten
    // over the user's other data.
    return null;
  }
}

function writeJson(key: string, value: unknown): boolean {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    return false;
  }
  return writeRaw(key, text);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------- prefs

export function readPrefs(): Prefs {
  const stored = readJson<Partial<Prefs>>(KEYS.prefs);
  if (!isRecord(stored)) return { ...DEFAULT_PREFS };
  const volume = stored.volume;
  return {
    theme: stored.theme === 'light' ? 'light' : 'dark',
    muted: stored.muted === true,
    volume:
      typeof volume === 'number' && Number.isFinite(volume)
        ? Math.min(1, Math.max(0, volume))
        : DEFAULT_PREFS.volume,
    lastRemoteKey: typeof stored.lastRemoteKey === 'string' ? stored.lastRemoteKey : null,
  };
}

export function writePrefs(patch: Partial<Prefs>): Prefs {
  const next: Prefs = { ...readPrefs(), ...patch };
  writeJson(KEYS.prefs, next);
  return next;
}

// -------------------------------------------------------------------- library

export function readLibrary(): Record<string, LibraryEntry> {
  const stored = readJson<Record<string, LibraryEntry>>(KEYS.library);
  return isRecord(stored) ? (stored as Record<string, LibraryEntry>) : {};
}

export function saveToLibrary(id: string, config: RoundConfig, name: string): void {
  const lib = readLibrary();
  lib[id] = { config, name, updatedAt: Date.now() };
  writeJson(KEYS.library, lib);
}

export function deleteFromLibrary(id: string): void {
  const lib = readLibrary();
  if (!(id in lib)) return;
  delete lib[id];
  writeJson(KEYS.library, lib);
}

// ------------------------------------------------------------ applied + draft

export function readApplied(): RoundConfig | null {
  return readJson<RoundConfig>(KEYS.applied);
}

export function writeApplied(config: RoundConfig): void {
  writeJson(KEYS.applied, config);
}

export function clearApplied(): void {
  removeRaw(KEYS.applied);
}

// ------------------------------------------------------------------- baseline

/**
 * The loaded round as it was when it was opened: its id and config hash. A round whose
 * hash has moved away from this has been edited, and is kept before anything replaces it.
 */
export interface Baseline {
  id: string;
  hash: string;
}

export function readBaseline(): Baseline | null {
  const stored = readJson<Baseline>(KEYS.baseline);
  if (!isRecord(stored)) return null;
  return typeof stored.id === 'string' && typeof stored.hash === 'string'
    ? { id: stored.id, hash: stored.hash }
    : null;
}

export function writeBaseline(baseline: Baseline): void {
  writeJson(KEYS.baseline, baseline);
}

export function readDraft(): DraftRecord | null {
  const rec = readJson<DraftRecord>(KEYS.draft);
  if (!rec || !isRecord(rec.config as unknown)) return null;
  return rec;
}

let draftTimer: ReturnType<typeof setTimeout> | null = null;
let draftPending: RoundConfig | null = null;

/** Debounced 400ms (§12.1). Call `flushDraft()` before navigating away. */
export function writeDraft(config: RoundConfig): void {
  draftPending = config;
  if (draftTimer !== null) clearTimeout(draftTimer);
  draftTimer = setTimeout(flushDraft, DRAFT_DEBOUNCE_MS);
}

export function flushDraft(): void {
  if (draftTimer !== null) {
    clearTimeout(draftTimer);
    draftTimer = null;
  }
  if (draftPending === null) return;
  const record: DraftRecord = { config: draftPending, updatedAt: Date.now() };
  draftPending = null;
  writeJson(KEYS.draft, record);
}

export function clearDraft(): void {
  if (draftTimer !== null) {
    clearTimeout(draftTimer);
    draftTimer = null;
  }
  draftPending = null;
  removeRaw(KEYS.draft);
}

/**
 * Drop one round's draft: any write still pending, and the stored draft if it is that
 * round's. A draft of some other round is left alone, since nothing else holds its edits.
 */
export function clearDraftFor(id: string): void {
  if (draftTimer !== null) {
    clearTimeout(draftTimer);
    draftTimer = null;
  }
  draftPending = null;
  if (readDraft()?.config.id === id) removeRaw(KEYS.draft);
}

// -------------------------------------------------------------------- recents

export function readRecents(): RecentEntry[] {
  const list = readJson<RecentEntry[]>(KEYS.recents);
  if (!Array.isArray(list)) return [];
  return list.filter((e): e is RecentEntry => isRecord(e) && typeof e.id === 'string');
}

export function pushRecent(entry: Omit<RecentEntry, 'updatedAt'>): void {
  const next: RecentEntry[] = [
    { ...entry, updatedAt: Date.now() },
    ...readRecents().filter((e) => e.id !== entry.id),
  ].slice(0, RECENTS_CAP);
  writeJson(KEYS.recents, next);
}

export function clearRecents(): void {
  removeRaw(KEYS.recents);
}

// -------------------------------------------------------------- live snapshot

export function writeLive(config: RoundConfig, state: RoundState): void {
  const snapshot: LiveSnapshot = { config, state: toSnapshot(state), updatedAt: Date.now() };
  writeJson(KEYS.live, snapshot);
}

export function readLive(): LiveSnapshot | null {
  const snap = readJson<LiveSnapshot>(KEYS.live);
  if (!snap || typeof snap.updatedAt !== 'number') return null;
  if (!isRecord(snap.config as unknown) || !isRecord(snap.state as unknown)) return null;
  return snap;
}

/** Older snapshots are ignored but never deleted (§12.1). */
export function readFreshLive(maxAgeMs: number = SNAPSHOT_MAX_AGE_MS): LiveSnapshot | null {
  const snap = readLive();
  if (!snap) return null;
  return Date.now() - snap.updatedAt <= maxAgeMs ? snap : null;
}

export function clearLive(): void {
  removeRaw(KEYS.live);
}

// ------------------------------------------------- cross-window link fallback

export function writeLinkFrame(payload: string): void {
  writeRaw(KEYS.link, payload);
}

export function readLinkFrame(): string | null {
  return readRaw(KEYS.link);
}
