import { useSyncExternalStore } from 'react';
import type { L10n, Lang } from '../domain/config';
import type { StringKey } from './strings';
import { STRINGS } from './strings';

export const LANG_STORAGE_KEY = 'dt.v3.lang';

export type Vars = Record<string, string | number>;
export type TFn = (key: StringKey, vars?: Vars) => string;

export interface LangApi {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  t: TFn;
  /** Resolve a `{en, zh}` label from the round data in the live language. */
  l10n: (text: L10n | undefined) => string;
}

function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'zh';
}

function readStored(): Lang | null {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    return isLang(stored) ? stored : null;
  } catch {
    return null; // private browsing / storage blocked — the app still runs
  }
}

function initialLang(): Lang {
  const stored = readStored();
  if (stored) return stored;
  if (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')) {
    return 'zh';
  }
  return 'en';
}

let current: Lang = initialLang();
const listeners = new Set<() => void>();

function syncDocument(lang: Lang): void {
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}
syncDocument(current);

// A language toggle in one tab must retranslate any other open tab of the app too; they
// share one origin, so the storage event is the cheapest link that already exists.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== LANG_STORAGE_KEY) return;
    if (!isLang(e.newValue) || e.newValue === current) return;
    current = e.newValue;
    syncDocument(current);
    for (const fn of listeners) fn();
  });
}

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  syncDocument(lang);
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // no persistence available; the in-memory language is still correct
  }
  for (const fn of listeners) fn();
}

export function toggleLang(): void {
  setLang(current === 'en' ? 'zh' : 'en');
}

export function subscribeLang(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

const VAR_RE = /\{(\w+)\}/g;

/** An unsupplied `{token}` is left visible rather than blanked — a silent gap hides bugs. */
function interpolate(template: string, vars: Vars | undefined): string {
  if (!vars) return template;
  return template.replace(VAR_RE, (match: string, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

export function translate(lang: Lang, key: StringKey, vars?: Vars): string {
  return interpolate(STRINGS[lang][key], vars);
}

export function resolveL10n(text: L10n | undefined, lang: Lang): string {
  if (!text) return '';
  return lang === 'zh' ? text.zh : text.en;
}

const tCache = new Map<Lang, TFn>();
/** Stable per language, so components that memo on `t` do not thrash. */
export function tFor(lang: Lang): TFn {
  let fn = tCache.get(lang);
  if (!fn) {
    fn = (key, vars) => translate(lang, key, vars);
    tCache.set(lang, fn);
  }
  return fn;
}

export function useLang(): LangApi {
  const lang = useSyncExternalStore(subscribeLang, getLang, getLang);
  return {
    lang,
    setLang,
    toggleLang,
    t: tFor(lang),
    l10n: (text) => resolveL10n(text, lang),
  };
}
