/**
 * Fullscreen, for the projector. The console is what goes on the wall, so going fullscreen
 * is a button in its top bar as well as the `F` key, and both call the one toggle here.
 *
 * The state a control shows is read back from the document on `fullscreenchange`, never
 * remembered: leaving with Esc or with the browser's own control is reflected at once.
 */

import { useSyncExternalStore } from 'react';

/** False where the page cannot go fullscreen at all (an iPhone), so no control offers to. */
export function fullscreenSupported(): boolean {
  return typeof document !== 'undefined' && document.fullscreenEnabled === true;
}

function isFullscreen(): boolean {
  return typeof document !== 'undefined' && Boolean(document.fullscreenElement);
}

export function toggleFullscreen(): void {
  if (!fullscreenSupported()) return;
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  else void document.documentElement.requestFullscreen().catch(() => undefined);
}

function subscribe(fn: () => void): () => void {
  document.addEventListener('fullscreenchange', fn);
  return () => {
    document.removeEventListener('fullscreenchange', fn);
  };
}

/** Whether the document is fullscreen right now. */
export function useFullscreen(): boolean {
  return useSyncExternalStore(subscribe, isFullscreen, () => false);
}
