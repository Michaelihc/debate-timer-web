/**
 * §8 — the keyboard map, declared once and scoped by context.
 *
 * Three rules the whole design hangs on:
 *
 * 1. **Nothing fires while the operator is typing.** Focus inside an
 *    `input` / `textarea` / `[contenteditable]` suppresses every binding.
 * 2. **Nothing fires during IME composition.** A Chinese operator typing 赵一鸣 sends
 *    `n`, `p`, `b` and `r` as composition input; firing ADVANCE or RESET off those
 *    keystrokes would be catastrophic. `compositionstart`/`compositionend`,
 *    `event.isComposing` and the legacy `keyCode === 229` are all honoured.
 * 3. **An action with no handler is inert** — no default is prevented, nothing happens.
 *    That is how SWAP is made honest: the console simply omits `swap` from its handler
 *    map whenever `canSwap(state, plan)` is false, and the binding goes dead in exactly
 *    the same breath as the control disappears.
 *
 * Keycaps are declared once, in Apple's glyphs, and printed the way the keyboard in front
 * of the operator labels its keys: `⌘ ⇧ ⌥ ⏎` on a Mac, `Ctrl Shift Alt Enter` everywhere
 * else. `capsOf`, `displayCaps` and `shortcutText` do that translation, so neither a button
 * nor the legend ever tells a Windows operator to press ⌘.
 *
 * Several components may register for the same context at once (the shell owns the chrome
 * bindings, the console owns transport). Registrations are searched newest-first, so a
 * screen can shadow a shell binding while it is mounted.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { StringKey } from '../i18n/strings';

/** The press-and-hold threshold for the on-screen buttons that still ask for one. */
export const HOLD_MS = 600;

export type HotkeyContext = 'launch' | 'console' | 'editor' | 'summary';

export type HotkeyAction =
  // transport
  | 'toggle'
  | 'advance'
  | 'advanceStart'
  | 'prev'
  | 'go'
  | 'goBack'
  | 'hold'
  | 'reset'
  | 'swap'
  | 'plus15'
  | 'minus15'
  | 'plus60'
  | 'minus60'
  | 'plus5'
  | 'minus5'
  | 'floorA'
  | 'floorB'
  | 'undo'
  | 'redo'
  // navigation & chrome
  | 'loadCursored'
  | 'fullscreen'
  | 'langToggle'
  | 'mute'
  | 'editor'
  | 'palette'
  | 'legend'
  | 'escape'
  | 'share';

export type HotkeyHandler = (event: KeyboardEvent) => void;
export type HotkeyHandlers = Partial<Record<HotkeyAction, HotkeyHandler | undefined>>;

export type HotkeyGroup = 'transport' | 'navigation';

/** One physical chord. `mod` matches ⌘ on Apple hardware and Ctrl everywhere else. */
export interface Chord {
  /** `KeyboardEvent.key`, lower-cased for letters. `' '` for Space. */
  key: string;
  /** Undefined means the modifier must be OFF. */
  shift?: boolean;
  alt?: boolean;
  mod?: boolean;
  /** For glyphs that only exist with Shift held, `?` above all. */
  anyShift?: boolean;
}

export interface KeyBinding {
  action: HotkeyAction;
  group: HotkeyGroup;
  chords: Chord[];
  /** Keycaps in Apple glyphs. Print them through `displayCaps`, never raw. */
  caps: string[];
  /** The description, in `strings.ts`, rendered in both languages by the legend. */
  label: StringKey;
  contexts: HotkeyContext[];
  /** Only meaningful inside a free-debate segment; the legend marks it. */
  chessOnly?: boolean;
}

const C = (key: string, mods: Omit<Chord, 'key'> = {}): Chord => ({ key, ...mods });

const CONSOLE_ONLY: HotkeyContext[] = ['console'];
const EVERYWHERE: HotkeyContext[] = ['launch', 'console', 'editor', 'summary'];

/**
 * The single source of truth for both the listener and the legend. Order is the order the
 * legend prints.
 */
export const KEYMAP: readonly KeyBinding[] = [
  {
    action: 'toggle',
    group: 'transport',
    chords: [C(' ')],
    caps: ['Space'],
    label: 'kb.spaceContext',
    contexts: CONSOLE_ONLY,
  },
  {
    action: 'swap',
    group: 'transport',
    chords: [C('s')],
    caps: ['S'],
    label: 'kb.swap',
    contexts: CONSOLE_ONLY,
    chessOnly: true,
  },
  {
    action: 'advance',
    group: 'transport',
    chords: [C('n')],
    caps: ['N'],
    label: 'kb.advance',
    contexts: CONSOLE_ONLY,
  },
  {
    action: 'advanceStart',
    group: 'transport',
    chords: [C('n', { shift: true })],
    caps: ['⇧', 'N'],
    label: 'kb.advanceStart',
    contexts: CONSOLE_ONLY,
  },
  {
    action: 'prev',
    group: 'transport',
    chords: [C('p')],
    caps: ['P'],
    label: 'kb.prev',
    contexts: CONSOLE_ONLY,
  },
  {
    action: 'go',
    group: 'transport',
    chords: [C('PageDown')],
    caps: ['PgDn'],
    label: 'kb.go',
    contexts: CONSOLE_ONLY,
  },
  {
    action: 'goBack',
    group: 'transport',
    chords: [C('PageUp')],
    caps: ['PgUp'],
    label: 'kb.prev',
    contexts: CONSOLE_ONLY,
  },
  {
    action: 'hold',
    group: 'transport',
    chords: [C('b'), C('.')],
    caps: ['B', '.'],
    label: 'kb.hold',
    contexts: CONSOLE_ONLY,
  },
  {
    // One press, like the original's Reset button. No hold, no confirm.
    action: 'reset',
    group: 'transport',
    chords: [C('r')],
    caps: ['R'],
    label: 'kb.reset',
    contexts: CONSOLE_ONLY,
  },
  {
    action: 'plus15',
    group: 'transport',
    chords: [C('ArrowUp')],
    caps: ['↑'],
    label: 'kb.adjust15',
    contexts: CONSOLE_ONLY,
  },
  {
    action: 'minus15',
    group: 'transport',
    chords: [C('ArrowDown')],
    caps: ['↓'],
    label: 'kb.adjust15',
    contexts: CONSOLE_ONLY,
  },
  {
    action: 'plus60',
    group: 'transport',
    chords: [C('ArrowUp', { shift: true })],
    caps: ['⇧', '↑'],
    label: 'kb.adjust60',
    contexts: CONSOLE_ONLY,
  },
  {
    action: 'minus60',
    group: 'transport',
    chords: [C('ArrowDown', { shift: true })],
    caps: ['⇧', '↓'],
    label: 'kb.adjust60',
    contexts: CONSOLE_ONLY,
  },
  {
    action: 'plus5',
    group: 'transport',
    chords: [C('ArrowUp', { alt: true })],
    caps: ['⌥', '↑'],
    label: 'kb.adjust5',
    contexts: CONSOLE_ONLY,
  },
  {
    action: 'minus5',
    group: 'transport',
    chords: [C('ArrowDown', { alt: true })],
    caps: ['⌥', '↓'],
    label: 'kb.adjust5',
    contexts: CONSOLE_ONLY,
  },
  {
    action: 'floorA',
    group: 'transport',
    chords: [C('ArrowLeft')],
    caps: ['←'],
    label: 'kb.floorPick',
    contexts: CONSOLE_ONLY,
    chessOnly: true,
  },
  {
    action: 'floorB',
    group: 'transport',
    chords: [C('ArrowRight')],
    caps: ['→'],
    label: 'kb.floorPick',
    contexts: CONSOLE_ONLY,
    chessOnly: true,
  },
  {
    // The editor's draft history. A running round has no undo: going back a segment is
    // how the console recovers from a mistaken advance.
    action: 'undo',
    group: 'transport',
    chords: [C('z', { mod: true })],
    caps: ['⌘', 'Z'],
    label: 'kb.undoRedo',
    contexts: ['editor'],
  },
  {
    action: 'redo',
    group: 'transport',
    chords: [C('z', { mod: true, shift: true })],
    caps: ['⌘', '⇧', 'Z'],
    label: 'kb.undoRedo',
    contexts: ['editor'],
  },
  {
    action: 'loadCursored',
    group: 'navigation',
    chords: [C('Enter')],
    caps: ['⏎'],
    label: 'kb.loadPip',
    contexts: CONSOLE_ONLY,
  },
  {
    action: 'fullscreen',
    group: 'navigation',
    chords: [C('f')],
    caps: ['F'],
    label: 'kb.fullscreen',
    contexts: EVERYWHERE,
  },
  {
    action: 'langToggle',
    group: 'navigation',
    chords: [C('l')],
    caps: ['L'],
    label: 'kb.langToggle',
    contexts: EVERYWHERE,
  },
  {
    action: 'mute',
    group: 'navigation',
    chords: [C('m')],
    caps: ['M'],
    label: 'kb.mute',
    contexts: ['launch', 'console', 'editor', 'summary'],
  },
  {
    action: 'editor',
    group: 'navigation',
    chords: [C('e')],
    caps: ['E'],
    label: 'kb.editor',
    contexts: ['launch', 'console', 'summary'],
  },
  {
    action: 'palette',
    group: 'navigation',
    chords: [C('k', { mod: true })],
    caps: ['⌘', 'K'],
    label: 'kb.palette',
    contexts: ['editor'],
  },
  {
    action: 'share',
    group: 'navigation',
    chords: [C('s', { mod: true })],
    caps: ['⌘', 'S'],
    label: 'kb.share',
    contexts: ['launch', 'console', 'editor', 'summary'],
  },
  {
    action: 'legend',
    group: 'navigation',
    chords: [C('?', { anyShift: true }), C('/', { shift: true })],
    caps: ['?'],
    label: 'kb.legend',
    contexts: EVERYWHERE,
  },
  {
    action: 'escape',
    group: 'navigation',
    chords: [C('Escape')],
    caps: ['Esc'],
    label: 'kb.escape',
    contexts: EVERYWHERE,
  },
];

const BY_ACTION = new Map<HotkeyAction, KeyBinding>(KEYMAP.map((b) => [b.action, b]));

export function bindingOf(action: HotkeyAction): KeyBinding | undefined {
  return BY_ACTION.get(action);
}

export function bindingsFor(context: HotkeyContext): KeyBinding[] {
  return KEYMAP.filter((b) => b.contexts.includes(context));
}

export function bindingsForGroup(context: HotkeyContext, group: HotkeyGroup): KeyBinding[] {
  return bindingsFor(context).filter((b) => b.group === group);
}

/* ------------------------------------------------------------- platform labels */

const APPLE = /Mac|iPhone|iPad|iPod/i;

function isApple(): boolean {
  return typeof navigator !== 'undefined' && APPLE.test(navigator.platform || navigator.userAgent);
}

/** What a non-Apple keyboard prints on the keys the map declares in Apple glyphs. */
const PC_CAPS: Readonly<Record<string, string>> = {
  '⌘': 'Ctrl',
  '⇧': 'Shift',
  '⌥': 'Alt',
  '⏎': 'Enter',
};

/** Keycaps as this platform's keyboard labels them. */
export function displayCaps(caps: readonly string[]): string[] {
  if (isApple()) return [...caps];
  return caps.map((cap) => PC_CAPS[cap] ?? cap);
}

/** The keycaps for one action, for a legend row or a button. */
export function capsOf(action: HotkeyAction): string[] {
  return displayCaps(BY_ACTION.get(action)?.caps ?? []);
}

const KEY_NAMES: Readonly<Record<string, string>> = {
  ' ': 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Escape: 'Esc',
};

/** One chord in words: `⌘Z` on a Mac, `Ctrl+Z` elsewhere. */
export function chordText(chord: Chord): string {
  const apple = isApple();
  const parts: string[] = [];
  if (chord.mod === true) parts.push(apple ? '⌘' : 'Ctrl');
  if (chord.shift === true) parts.push(apple ? '⇧' : 'Shift');
  if (chord.alt === true) parts.push(apple ? '⌥' : 'Alt');
  const named = chord.key === 'Enter' ? (apple ? '⏎' : 'Enter') : KEY_NAMES[chord.key];
  parts.push(named ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key));
  return parts.join(apple ? '' : '+');
}

/** Every chord bound to an action, for a `title`: `P`, `B / .`, `Shift+N`. */
export function shortcutText(action: HotkeyAction): string {
  return (BY_ACTION.get(action)?.chords ?? []).map(chordText).join(' / ');
}

/** `aria-keyshortcuts` wants real key names joined by `+`, not the legend's glyphs. */
export function ariaShortcut(action: HotkeyAction): string | undefined {
  const chord = BY_ACTION.get(action)?.chords[0];
  if (!chord) return undefined;
  const parts: string[] = [];
  if (chord.mod === true) parts.push(isApple() ? 'Meta' : 'Control');
  if (chord.shift === true) parts.push('Shift');
  if (chord.alt === true) parts.push('Alt');
  parts.push(
    chord.key === ' ' ? 'Space' : chord.key.length === 1 ? chord.key.toUpperCase() : chord.key,
  );
  return parts.join('+');
}

/* --------------------------------------------------------------- chord matching */

function normKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

function matches(chord: Chord, e: KeyboardEvent): boolean {
  if (normKey(e.key) !== chord.key) return false;
  if (chord.anyShift !== true && (chord.shift === true) !== e.shiftKey) return false;
  if ((chord.alt === true) !== e.altKey) return false;
  const mod = isApple() ? e.metaKey : e.ctrlKey;
  const other = isApple() ? e.ctrlKey : e.metaKey;
  if ((chord.mod === true) !== mod) return false;
  // A stray Ctrl on macOS (or ⌘ on Windows) is a different chord, not this one.
  if (other) return false;
  return true;
}

function bindingFor(e: KeyboardEvent, context: HotkeyContext): KeyBinding | null {
  for (const b of KEYMAP) {
    if (!b.contexts.includes(context)) continue;
    for (const chord of b.chords) {
      if (matches(chord, e)) return b;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ IME + focus */

let composing = false;

if (typeof document !== 'undefined') {
  document.addEventListener('compositionstart', () => {
    composing = true;
  }, true);
  const end = (): void => {
    composing = false;
  };
  document.addEventListener('compositionend', end, true);
  // A composition cancelled by blurring the field never fires `compositionend`.
  document.addEventListener('focusout', end, true);
}

export function isComposing(e?: KeyboardEvent): boolean {
  if (composing) return true;
  if (!e) return false;
  // `keyCode === 229` is what an IME sends on engines that predate `isComposing`.
  return e.isComposing || e.keyCode === 229;
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** Focus inside any field belongs to the field, including a select whose Space opens it. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return TYPING_TAGS.has(target.tagName);
}

/* ------------------------------------------------------------------- registry */

interface Registration {
  context: HotkeyContext;
  handlers: HotkeyHandlers;
  enabled: boolean;
}

const registrations: Registration[] = [];

/** Newest registration wins, so a mounted screen shadows the shell for one action. */
function resolve(action: HotkeyAction, context: HotkeyContext): Registration | null {
  for (let i = registrations.length - 1; i >= 0; i--) {
    const reg = registrations[i];
    if (!reg || !reg.enabled || reg.context !== context) continue;
    if (typeof reg.handlers[action] === 'function') return reg;
  }
  return null;
}

function anyEnabled(context: HotkeyContext): boolean {
  return registrations.some((r) => r.enabled && r.context === context);
}

/* ------------------------------------------------------------ the one listener */

let listening = 0;
let lastRemoteKey: string | null = null;
const remoteListeners = new Set<() => void>();

const REMOTE_KEYS = new Set(['PageDown', 'PageUp', '.', 'b']);

function noteRemote(key: string): void {
  if (!REMOTE_KEYS.has(key) || lastRemoteKey === key) return;
  lastRemoteKey = key;
  for (const fn of remoteListeners) fn();
}

/** The band-1 "remote tell": which clicker button the operator last pressed. */
export function getLastRemoteKey(): string | null {
  return lastRemoteKey;
}

export function subscribeRemote(fn: () => void): () => void {
  remoteListeners.add(fn);
  return () => {
    remoteListeners.delete(fn);
  };
}

function onKeyDown(e: KeyboardEvent): void {
  if (isComposing(e)) return;
  if (isTypingTarget(e.target)) return;

  const context = activeContext();
  if (!context) return;

  const binding = bindingFor(e, context);
  if (!binding) return;

  noteRemote(e.key);

  const reg = resolve(binding.action, context);
  // No handler: the binding is inert. Nothing is prevented, nothing happens — this is
  // exactly the state SWAP occupies whenever `canSwap` is false.
  if (!reg) return;

  e.preventDefault();
  reg.handlers[binding.action]?.(e);
}

let contextResolver: (() => HotkeyContext | null) | null = null;

function activeContext(): HotkeyContext | null {
  const declared = contextResolver?.() ?? null;
  if (declared) return anyEnabled(declared) ? declared : null;
  // No shell mounted (a screen rendered on its own, or a test): the newest live
  // registration decides.
  for (let i = registrations.length - 1; i >= 0; i--) {
    const reg = registrations[i];
    if (reg?.enabled) return reg.context;
  }
  return null;
}

/**
 * The shell declares which context is live. Called once by `App`; a screen never
 * has to (and must not) fight over it.
 */
export function setContextResolver(fn: () => HotkeyContext | null): () => void {
  contextResolver = fn;
  return () => {
    if (contextResolver === fn) contextResolver = null;
  };
}

function attach(): void {
  if (listening++ > 0) return;
  window.addEventListener('keydown', onKeyDown);
}

function detach(): void {
  if (--listening > 0) return;
  window.removeEventListener('keydown', onKeyDown);
}

export interface HotkeyOptions {
  /** Default true. False parks the registration without unmounting it. */
  enabled?: boolean;
}

/**
 * Register a handler map for one context.
 *
 * Handlers are read from a ref on every keystroke, so passing fresh closures every render
 * is correct and costs nothing. Omitting an action — or passing `undefined` for it —
 * makes that binding inert.
 */
export function useHotkeys(
  context: HotkeyContext,
  handlers: HotkeyHandlers,
  options: HotkeyOptions = {},
): void {
  const enabled = options.enabled !== false;
  const reg = useRef<Registration>({ context, handlers, enabled });
  // Synced in a layout effect, not during render: a render can be thrown away, and a
  // discarded render must not leave a live keystroke pointing at handlers that were
  // never committed. Commit is still long before any key can arrive.
  useLayoutEffect(() => {
    reg.current.context = context;
    reg.current.handlers = handlers;
    reg.current.enabled = enabled;
  });

  useEffect(() => {
    const entry = reg.current;
    registrations.push(entry);
    attach();
    return () => {
      const i = registrations.indexOf(entry);
      if (i >= 0) registrations.splice(i, 1);
      detach();
    };
  }, []);
}
