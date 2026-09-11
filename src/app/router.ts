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
 * subscribers directly, and `popstate` (browser Back) is always honoured.
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

function refresh(): void {
  const next = parseRoute(location.hash);
  if (next.name === current.name && next.path === current.path) return;
  current = next;
  emit();
}

export function currentRoute(): Route {
  return current;
}

/** Push: browser Back returns to where the operator was. */
export function navigate(path: string): void {
  writeHash(parseRoute(path).path, 'push');
  refresh();
}

/** Replace: for redirects the operator never chose (share-link landing, boot). */
export function replaceRoute(path: string): void {
  writeHash(parseRoute(path).path, 'replace');
  refresh();
}

export function subscribeRoute(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    // Our own rewrite echoing back; the route did not change.
    if (isSelfWritten(location.hash)) return;
    refresh();
  });
  window.addEventListener('popstate', refresh);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribeRoute, currentRoute, currentRoute);
}
