/**
 * The hash router. Five screens plus the share route.
 *
 *   #/                       launch
 *   #/console                the operator console (the default working screen)
 *   #/edit                   the setup editor
 *   #/summary                the box score
 *   #/r/<codec>.<payload>    a shared round — `boot.ts` decodes it, loads it and
 *                            replaces the hash with #/console
 *
 * Hash, not path: the host is static, so a deep link must never reach a server.
 *
 * The app rewrites its own hash constantly (the editor mirrors the config into the URL
 * on every edit), so every write goes through `lib/urlState.writeHash`, which remembers
 * the last value it wrote; a `hashchange` matching it is a rewrite echo and is ignored.
 * `pushState`/`replaceState` fire no `hashchange` at all, so navigation notifies
 * subscribers directly, and `popstate` (browser Back) is always honoured — unless a
 * leave guard refuses it.
 *
 * ── Leave guard ────────────────────────────────────────────────────────────────
 * A screen holding work the round does not have yet (the editor's unapplied draft)
 * installs one guard, and every way off that screen runs through it: `navigate()` asks
 * before it writes the hash; a Back/Forward press or a hand-edited address — which the
 * browser has already applied by the time we hear about it — is put back to the guarded
 * screen's URL while the screen asks the operator. `replaceRoute()` is not guarded: it is
 * for redirects nobody chose, which never happen while a screen is being edited.
 */

import { useSyncExternalStore } from 'react';
import { isSelfWritten, parseShareToken, writeHash } from '../lib/urlState';

export type RouteName = 'launch' | 'console' | 'edit' | 'summary' | 'share';

export interface Route {
  name: RouteName;
  /** The normalised hash, e.g. `#/console`. */
  path: string;
  /** `<codec>.<payload>` on the share route, null everywhere else. */
  token: string | null;
}

export const ROUTES: Readonly<Record<Exclude<RouteName, 'share'>, string>> = {
  launch: '#/',
  console: '#/console',
  edit: '#/edit',
  summary: '#/summary',
};

/**
 * Asked before the current screen is left for `to` (a normalised hash). Return `true` to
 * let the navigation happen, `false` to keep the operator where they are — the guard is
 * then responsible for asking them, and for calling `navigate(to, { force: true })` if
 * they choose to go.
 */
export type LeaveGuard = (to: string) => boolean;

export interface NavigateOptions {
  /** Skip the leave guard. Only the guard's own "leave anyway" answer passes this. */
  force?: boolean;
}

const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function screenOf(path: string): Exclude<RouteName, 'share'> {
  switch (path) {
    case '/console':
      return 'console';
    case '/edit':
      return 'edit';
    case '/summary':
      return 'summary';
    default:
      return 'launch';
  }
}

/**
 * An unknown hash resolves to launch rather than a dead screen.
 *
 * `/r/<token>` on its own is the share landing. A `/r/<token>` suffix on a screen —
 * `#/edit/r/1.abc` — is that screen mirroring its config into the address bar (§12.2):
 * copying the URL at any moment shares exactly what is on screen, without the mirror
 * hijacking the route on the next reload.
 */
export function parseRoute(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const trimmed = raw === '' ? '/' : raw.replace(/\/+$/, '') || '/';
  const cut = trimmed.indexOf('/r/');
  if (cut >= 0) {
    const token = trimmed.slice(cut + 3);
    if (parseShareToken(token)) {
      const prefix = trimmed.slice(0, cut);
      if (prefix === '') return { name: 'share', path: `#/r/${token}`, token };
      const name = screenOf(prefix);
      return { name, path: `#${prefix}/r/${token}`, token };
    }
    return { name: 'launch', path: ROUTES.launch, token: null };
  }
  const name = screenOf(trimmed);
  return { name, path: ROUTES[name], token: null };
}

/** The mirrored form of a screen route: `#/edit/r/<codec>.<payload>`. */
export function mirrorPath(name: Exclude<RouteName, 'share'>, token: string): string {
  const base = ROUTES[name];
  return base === ROUTES.launch ? `#/r/${token}` : `${base}/r/${token}`;
}

let current: Route = parseRoute(typeof location === 'undefined' ? '' : location.hash);

/** The last address the router knows for the screen on show — where a refused Back returns. */
let screenHash: string = typeof location === 'undefined' ? '' : location.hash;

let leaveGuard: LeaveGuard | null = null;

function refresh(): void {
  screenHash = location.hash;
  const next = parseRoute(location.hash);
  if (next.name === current.name && next.path === current.path) return;
  current = next;
  emit();
}

/** Moving within the same screen is never guarded; leaving it is. */
function refused(next: Route): boolean {
  if (leaveGuard === null || next.name === current.name) return false;
  return !leaveGuard(next.path);
}

export function currentRoute(): Route {
  return current;
}

/**
 * Install the leave guard for the screen on show. Returns the disposer, which only removes
 * the guard if it is still this one — so it drops straight into a `useEffect` cleanup.
 */
export function setLeaveGuard(fn: LeaveGuard | null): () => void {
  leaveGuard = fn;
  return () => {
    if (leaveGuard === fn) leaveGuard = null;
  };
}

/** Push: browser Back returns to where the operator was. */
export function navigate(path: string, opts: NavigateOptions = {}): void {
  const next = parseRoute(path);
  if (opts.force !== true && refused(next)) return;
  writeHash(next.path, 'push');
  refresh();
}

/** Replace: for redirects the operator never chose (share-link landing, boot). */
export function replaceRoute(path: string): void {
  writeHash(parseRoute(path).path, 'replace');
  refresh();
}

/**
 * A screen writing its own state into the address bar (`#/edit/r/<token>`): same screen,
 * no new history entry, and remembered as the place a refused Back comes back to.
 */
export function mirrorRoute(hash: string): void {
  writeHash(hash, 'replace');
  if (parseRoute(hash).name === current.name) screenHash = location.hash;
}

export function subscribeRoute(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Back, Forward, or a hash typed into the address bar: the URL has already moved. */
function onBrowserMove(): void {
  const next = parseRoute(location.hash);
  if (refused(next)) {
    // Put the guarded screen back as a NEW entry rather than replacing the one the
    // browser landed on: a second Back press then asks again, instead of each refusal
    // quietly eating one more step of the operator's history.
    writeHash(screenHash, 'push');
    return;
  }
  refresh();
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    // Our own rewrite echoing back; the route did not change.
    if (isSelfWritten(location.hash)) return;
    onBrowserMove();
  });
  window.addEventListener('popstate', onBrowserMove);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribeRoute, currentRoute, currentRoute);
}
