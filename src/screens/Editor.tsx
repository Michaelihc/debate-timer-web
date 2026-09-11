/**
 * The setup editor.
 *
 * Two panes: the roster (who is debating) and the run order (what happens, in what order,
 * for how long). A segment's details open in place, under its own row. Everything about
 * the round as a whole — the motion, side names and colours, cues, display, the two
 * behaviour settings — lives in one Round settings panel off the top bar.
 *
 * The draft autosaves, but a draft is not the round. APPLY hands it to the console, and
 * the top bar always says whether anything is still unapplied. Leaving with unapplied edits
 * — Back, Esc, the browser's Back/Forward, a hand-edited address, closing the tab — asks
 * first: apply and leave, discard, or keep editing. (It used to autosave the draft and
 * navigate away, so edits silently never reached the round.)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE THIS SCREEN IS BUILT AROUND
 *
 * The run order belongs to the operator. Any speaker may appear at any position, any
 * number of times, or not at all. Prep, free debate and breaks may sit anywhere. That is
 * legal and ordinary — the operator's own format runs 3 before 2 on purpose. Nothing in
 * this file warns, badges, asterisks, colour-codes, sorts, dedupes, auto-completes or
 * "suggests" anything about the sequence. The only problems shown anywhere are the ones
 * `domain/validate.ts` returns, in its own words.
 *
 * The case for this screen is legibility and speed against hand-editing JSON. It is not
 * error prevention.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { JSX, ReactNode, RefObject } from 'react';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';

import type {
  CueSpec,
  CueTone,
  Id,
  L10n,
  Lang,
  RoundConfig,
  Rules,
  Segment,
  SideCfg,
  SideId,
  SpeakerCfg,
} from '../domain/config';
import { canonicalJson } from '../domain/config';
import type { SegmentPlan } from '../domain/plan';
import { KIND_LABELS, plan, resolveCues } from '../domain/plan';
import { uniqueId } from '../domain/id';
import type { PresetKey } from '../domain/presets';
import { PRESET_META, instantiatePreset } from '../domain/presets';
import { migrate } from '../domain/migrate';
import type { Problem } from '../domain/validate';
import { firstError, hasErrors, validate } from '../domain/validate';

import { clearDraft, flushDraft, pushRecent, readDraft, writeDraft } from '../engine/persist';
import { reconcileState } from '../engine/state';
import { replacePlan, useRound } from '../engine/store';

import { useHotkeys } from '../app/hotkeys';
import { ROUTES, currentRoute, mirrorPath, mirrorRoute, navigate, setLeaveGuard } from '../app/router';
import { formatTime } from '../lib/format';
import { encodeSharePlain, tryDecodeShare } from '../lib/urlState';
import type { TFn } from '../i18n/useLang';
import { useLang } from '../i18n/useLang';

import { Confirm } from '../ui/Confirm';
import type { ComposerPick } from '../ui/Composer';
import { Composer } from '../ui/Composer';
import { Icon } from '../ui/Icons';
import { Overlay } from '../ui/Overlay';
import { overlayDepth } from '../ui/overlayStack';
import { Ribbon } from '../ui/Ribbon';
import { ribbonFromShares } from '../ui/ribbonData';
import type { SegmentWho } from '../ui/SegmentCard';
import { SegmentCard } from '../ui/SegmentCard';
import { ShareSheet } from '../ui/ShareSheet';
import { SideColorPicker } from '../ui/SideColorPicker';
import type { FocusRequest } from '../ui/SpeakerRow';
import { SpeakerRow } from '../ui/SpeakerRow';
import { TimeField } from '../ui/TimeField';
import { ValidationStrip } from '../ui/ValidationStrip';

import './editor.css';

/* ══════════════════════════════════════════════════════ draft + undo stack ══ */

const UNDO_DEPTH = 50;
const DEFAULT_PREP_MS = 180_000;
const DEFAULT_CHESS_MS = 240_000;
const DEFAULT_SHARED_MS = 180_000;
const DEFAULT_BREAK_MS = 300_000;
const DEFAULT_SPEECH_MS = 180_000;
const MIRROR_DEBOUNCE_MS = 500;
const APPLIED_FLASH_MS = 2500;
const SIDES: readonly SideId[] = ['A', 'B'];

const APPLY_KEYS =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
    ? '⌘⏎'
    : 'Ctrl+Enter';

interface Draft {
  config: RoundConfig;
  past: RoundConfig[];
  future: RoundConfig[];
  /** Consecutive edits sharing a key coalesce into one undo entry (typing a name). */
  mergeKey: string | null;
}

type DraftAction =
  | { t: 'edit'; config: RoundConfig; merge?: string }
  | { t: 'undo' }
  | { t: 'redo' };

function reduceDraft(state: Draft, action: DraftAction): Draft {
  switch (action.t) {
    case 'edit': {
      if (action.config === state.config) return state;
      const merge = action.merge ?? null;
      if (merge !== null && merge === state.mergeKey) {
        return { ...state, config: action.config, future: [] };
      }
      return {
        config: action.config,
        past: [...state.past, state.config].slice(-UNDO_DEPTH),
        future: [],
        mergeKey: merge,
      };
    }
    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (prev === undefined) return state;
      return {
        config: prev,
        past: state.past.slice(0, -1),
        future: [state.config, ...state.future].slice(0, UNDO_DEPTH),
        mergeKey: null,
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (next === undefined) return state;
      return {
        config: next,
        past: [...state.past, state.config].slice(-UNDO_DEPTH),
        future: state.future.slice(1),
        mergeKey: null,
      };
    }
  }
}

/** The draft wins over the live round only when it is the same round, or nothing is live. */
function initDraft(live: RoundConfig): Draft {
  const record = readDraft();
  const empty = live.segments.length === 0 && live.speakers.length === 0;
  const config =
    record !== null && (record.config.id === live.id || empty)
      ? record.config
      : structuredClone(live);
  return { config, past: [], future: [], mergeKey: null };
}

/* ═════════════════════════════════════════════════════════ config surgery ══ */

function mintId(config: RoundConfig): Id {
  const taken = new Set<string>([config.id]);
  for (const s of config.speakers) taken.add(s.id);
  for (const s of config.segments) taken.add(s.id);
  return uniqueId(taken);
}

function speakersOf(config: RoundConfig, side: SideId): SpeakerCfg[] {
  return config.speakers.filter((s) => s.side === side);
}

function sideCfg(config: RoundConfig, side: SideId): SideCfg {
  return side === 'A' ? config.sides[0] : config.sides[1];
}

/** Roster order is per side; the flat array is regrouped so both lists stay contiguous. */
function setSideSpeakers(config: RoundConfig, side: SideId, list: SpeakerCfg[]): RoundConfig {
  const other = speakersOf(config, side === 'A' ? 'B' : 'A');
  return { ...config, speakers: side === 'A' ? [...list, ...other] : [...other, ...list] };
}

function withSide(config: RoundConfig, side: SideId, patch: Partial<SideCfg>): RoundConfig {
  const sides: [SideCfg, SideCfg] =
    side === 'A'
      ? [{ ...config.sides[0], ...patch }, config.sides[1]]
      : [config.sides[0], { ...config.sides[1], ...patch }];
  return { ...config, sides };
}

function withRules(config: RoundConfig, patch: Partial<Rules>): RoundConfig {
  return { ...config, rules: { ...config.rules, ...patch } };
}

function move<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  const item = out[from];
  if (item === undefined) return out;
  const target = Math.max(0, Math.min(out.length - 1, to));
  out.splice(from, 1);
  out.splice(target, 0, item);
  return out;
}

function makeSegment(pick: ComposerPick, id: Id): Segment {
  switch (pick.kind) {
    case 'speech':
      return { id, kind: 'speech', speakerId: pick.speakerId, allottedMs: null };
    case 'prep':
      return { id, kind: 'prep', label: { ...KIND_LABELS.prep }, side: 'both', allottedMs: DEFAULT_PREP_MS };
    case 'chess':
      return {
        id,
        kind: 'chess',
        label: { ...KIND_LABELS.chess },
        perSideMs: DEFAULT_CHESS_MS,
        firstFloor: 'A',
      };
    case 'shared':
      return {
        id,
        kind: 'shared',
        label: { ...KIND_LABELS.shared },
        allottedMs: DEFAULT_SHARED_MS,
        live: ['A', 'B'],
      };
    case 'break':
      return { id, kind: 'break', label: { ...KIND_LABELS.break }, allottedMs: DEFAULT_BREAK_MS };
  }
}

/** The editable number for a segment: one side's clock for free debate, the allotment otherwise. */
function durationOf(segment: Segment, config: RoundConfig): number {
  if (segment.kind === 'chess') return segment.perSideMs;
  if (segment.kind !== 'speech') return segment.allottedMs;
  if (segment.allottedMs !== null) return segment.allottedMs;
  return config.speakers.find((s) => s.id === segment.speakerId)?.defaultMs ?? 0;
}

function setDuration(segment: Segment, ms: number): Segment {
  if (segment.kind === 'chess') return { ...segment, perSideMs: ms };
  if (segment.kind === 'speech') return { ...segment, allottedMs: ms };
  return { ...segment, allottedMs: ms };
}

/**
 * Language mirroring: typing one language also fills the other while the other is empty,
 * or still identical to this one. Once the other half has been written separately it is
 * left alone. (Checking "empty" alone stopped mirroring after the first keystroke, so the
 * other language kept only the first character.)
 */
function mirrorL10n(current: L10n | undefined, lang: Lang, text: string): L10n {
  const mine = current?.[lang] ?? '';
  const other = lang === 'zh' ? (current?.en ?? '') : (current?.zh ?? '');
  const filled = other.trim() === '' || other === mine ? text : other;
  return lang === 'zh' ? { en: filled, zh: text } : { en: text, zh: filled };
}

/** Drop a segment's own ladder so it falls back to `rules.cues`, without a union cast. */
function withoutCues(segment: Segment): Segment {
  switch (segment.kind) {
    case 'speech': {
      const { cues: _drop, ...rest } = segment;
      return rest;
    }
    case 'shared': {
      const { cues: _drop, ...rest } = segment;
      return rest;
    }
    case 'prep': {
      const { cues: _drop, ...rest } = segment;
      return rest;
    }
    case 'chess': {
      const { cues: _drop, ...rest } = segment;
      return rest;
    }
    case 'break': {
      const { cues: _drop, ...rest } = segment;
      return rest;
    }
  }
}

/** What to call a speaker who has not been named yet: "Proposition 3", never a blank. */
function speakerDisplay(config: RoundConfig, speaker: SpeakerCfg, lang: Lang): string {
  const name = speaker.name.trim();
  if (name !== '') return name;
  const ordinal = speakersOf(config, speaker.side).findIndex((s) => s.id === speaker.id) + 1;
  return `${sideCfg(config, speaker.side).label[lang]} ${ordinal}`;
}

/**
 * Whose clock a row is: the speaker for a speech, the side (or both sides) for prep, free
 * debate and a shared clock, nobody for a break. This is a reading of the data — it is
 * never a comment on where the segment sits in the order.
 */
function whoOf(ps: SegmentPlan, config: RoundConfig, lang: Lang, t: TFn): SegmentWho | null {
  if (ps.segment.kind === 'speech') {
    if (ps.speaker === null) return null;
    return { text: speakerDisplay(config, ps.speaker, lang), color: sideCfg(config, ps.speaker.side).color };
  }
  if (ps.segment.kind === 'break') return null;
  const [first, second] = ps.liveSides;
  if (first === undefined) return null;
  if (second === undefined) {
    const cfg = sideCfg(config, first);
    return { text: cfg.label[lang], color: cfg.color };
  }
  return { text: t('ui.both'), color: null };
}

function sortCues(cues: readonly CueSpec[]): CueSpec[] {
  return [...cues].sort((a, b) => b.atMs - a.atMs);
}

function cueList(cues: readonly CueSpec[], secondsOnly: boolean, t: TFn): string {
  if (cues.length === 0) return t('ui.none');
  return sortCues(cues)
    .map((cue) => formatTime(cue.atMs, { secondsOnly }))
    .join(' · ');
}

/** `scrollIntoView` where the engine has it (jsdom does not). */
function reveal(el: Element | null | undefined): void {
  if (el instanceof HTMLElement && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
}

function rowToggle(list: HTMLOListElement | null, segId: Id): HTMLButtonElement | null {
  if (list === null) return null;
  for (const child of Array.from(list.children)) {
    if (child instanceof HTMLElement && child.dataset['seg'] === segId) {
      return child.querySelector<HTMLButtonElement>('.step__toggle');
    }
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════ the screen ══ */

type Pane = 'roster' | 'order';
type SettingsView = 'closed' | 'open' | 'colour';

export default function Editor(): JSX.Element {
  const { t, l10n, lang } = useLang();
  const session = useRound();

  const [draft, dispatchDraft] = useReducer(reduceDraft, session.config, initDraft);
  const config = draft.config;

  const [expanded, setExpanded] = useState<Id | null>(null);
  const [pane, setPane] = useState<Pane>('order');
  const [announce, setAnnounce] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [presetPending, setPresetPending] = useState<PresetKey | null>(null);
  const [settings, setSettings] = useState<SettingsView>('closed');
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const [appliedFlash, setAppliedFlash] = useState(false);
  const [focusSpeaker, setFocusSpeaker] = useState<FocusRequest | null>(null);

  const sheetRef = useRef<HTMLOListElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const colourRef = useRef<HTMLDivElement>(null);
  const focusSeq = useRef(0);
  /** Set by "Discard changes": from then on nothing may write the draft back. */
  const discarded = useRef(false);

  const stateId = useId();
  const hintId = useId();

  const edit = useCallback((next: RoundConfig, merge?: string) => {
    dispatchDraft(merge === undefined ? { t: 'edit', config: next } : { t: 'edit', config: next, merge });
  }, []);

  const draftPlan = useMemo(() => plan(config), [config]);
  const problems = useMemo(() => validate(config), [config]);
  const blocked = hasErrors(problems);
  const errorCount = problems.filter((p) => p.severity === 'error').length;
  const secondsOnly = config.rules.display === 'seconds';
  const dangling = useMemo(
    () => draftPlan.segments.filter((s) => s.missingSpeakerIds.length > 0).map((s) => s.segId),
    [draftPlan],
  );

  // Unapplied = the draft is not the round the console is running. Canonical JSON, so key
  // order and dropped `undefined`s never count as a change.
  const draftJson = useMemo(() => canonicalJson(config), [config]);
  const liveJson = useMemo(() => canonicalJson(session.config), [session.config]);
  const dirty = draftJson !== liveJson;

  const exitRoute = session.plan.segments.length > 0 ? ROUTES.console : ROUTES.launch;

  const requestSpeakerFocus = useCallback((id: Id) => {
    focusSeq.current += 1;
    setFocusSpeaker({ id, seq: focusSeq.current });
  }, []);

  /* ── persistence: the draft and the URL both follow the config ───────────── */

  useEffect(() => {
    if (!discarded.current) writeDraft(config);
  }, [config]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        mirrorRoute(mirrorPath('edit', encodeSharePlain(config)));
      } catch {
        // A config too large for the address bar still edits fine; the URL simply
        // stops mirroring rather than the screen failing.
      }
    }, MIRROR_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [config]);

  useEffect(() => {
    const flush = (): void => {
      if (!discarded.current) flushDraft();
    };
    // A tab closed inside the 400ms autosave debounce would otherwise lose the last edit.
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  // `#/edit/r/<token>` is both this screen's own mirror and a link somebody sent. On the
  // first paint only, a token that is NOT the mirror of what is already loaded is decoded
  // and adopted — which is what makes "copy the URL" a real way to hand a config over.
  const configRef = useRef(config);
  useLayoutEffect(() => {
    configRef.current = config;
  });
  const adopted = useRef(false);
  useEffect(() => {
    if (adopted.current) return;
    adopted.current = true;
    const token = currentRoute().token;
    if (token === null) return;
    const here = configRef.current;
    if (encodeSharePlain(here) === token) return;
    let live = true;
    void tryDecodeShare(token).then((decoded) => {
      if (!live || !decoded.ok) return;
      const result = migrate(decoded.raw);
      // A link that will not decode leaves the draft exactly as it was.
      if (result.config) edit({ ...result.config, id: here.id });
    });
    return () => {
      live = false;
    };
  }, [edit]);

  /* ── roster ─────────────────────────────────────────────────────────────── */

  const addSpeaker = useCallback(
    (side: SideId, afterId?: Id) => {
      const list = speakersOf(config, side);
      const last = list[list.length - 1];
      const speaker: SpeakerCfg = {
        id: mintId(config),
        side,
        name: '',
        defaultMs: last?.defaultMs ?? DEFAULT_SPEECH_MS,
      };
      const at = afterId === undefined ? list.length : list.findIndex((s) => s.id === afterId) + 1;
      const next = [...list];
      next.splice(at, 0, speaker);
      edit(setSideSpeakers(config, side, next));
      requestSpeakerFocus(speaker.id);
    },
    [config, edit, requestSpeakerFocus],
  );

  const patchSpeaker = useCallback(
    (id: Id, patch: Partial<SpeakerCfg>, merge?: string) => {
      edit(
        {
          ...config,
          speakers: config.speakers.map((s) => (s.id === id ? { ...s, ...patch } : s)),
        },
        merge,
      );
    },
    [config, edit],
  );

  const deleteSpeaker = useCallback(
    (id: Id) => {
      // Segments that name this speaker are left exactly where they are. They become a
      // MISSING_SPEAKER error the operator resolves by picking a replacement — the run
      // order is never rewritten on their behalf.
      edit({ ...config, speakers: config.speakers.filter((s) => s.id !== id) });
    },
    [config, edit],
  );

  const duplicateSpeaker = useCallback(
    (side: SideId, id: Id) => {
      const list = speakersOf(config, side);
      const at = list.findIndex((s) => s.id === id);
      const source = list[at];
      if (source === undefined) return;
      const copy: SpeakerCfg = { ...source, id: mintId(config) };
      const next = [...list];
      next.splice(at + 1, 0, copy);
      edit(setSideSpeakers(config, side, next));
      requestSpeakerFocus(copy.id);
    },
    [config, edit, requestSpeakerFocus],
  );

  const reorderSpeaker = useCallback(
    (side: SideId, from: number, to: number) => {
      const list = speakersOf(config, side);
      const target = Math.max(0, Math.min(list.length - 1, to));
      if (target === from || list[from] === undefined) return;
      edit(setSideSpeakers(config, side, move(list, from, target)));
      setAnnounce(t('ed.movedTo', { i: target + 1, n: list.length }));
    },
    [config, edit, t],
  );

  /* ── run order ──────────────────────────────────────────────────────────── */

  const appendSegment = useCallback(
    (pick: ComposerPick) => {
      const segment = makeSegment(pick, mintId(config));
      edit({ ...config, segments: [...config.segments, segment] });
      // The add buttons stay put; the order scrolls so the new row is in view.
      requestAnimationFrame(() => {
        const box = scrollRef.current;
        if (box !== null) box.scrollTop = box.scrollHeight;
      });
    },
    [config, edit],
  );

  const patchSegment = useCallback(
    (index: number, next: Segment, merge?: string) => {
      edit({ ...config, segments: config.segments.map((s, i) => (i === index ? next : s)) }, merge);
    },
    [config, edit],
  );

  const deleteSegment = useCallback(
    (index: number) => {
      const gone = config.segments[index];
      edit({ ...config, segments: config.segments.filter((_, i) => i !== index) });
      if (gone !== undefined) setExpanded((cur) => (cur === gone.id ? null : cur));
    },
    [config, edit],
  );

  const duplicateSegment = useCallback(
    (index: number) => {
      const source = config.segments[index];
      if (source === undefined) return;
      const copy: Segment = { ...source, id: mintId(config) };
      const segments = [...config.segments];
      segments.splice(index + 1, 0, copy);
      edit({ ...config, segments });
    },
    [config, edit],
  );

  const reorderSegment = useCallback(
    (from: number, to: number) => {
      const moved = config.segments[from];
      const target = Math.max(0, Math.min(config.segments.length - 1, to));
      if (moved === undefined || target === from) return;
      edit({ ...config, segments: move(config.segments, from, target) });
      setAnnounce(t('ed.movedTo', { i: target + 1, n: config.segments.length }));
      requestAnimationFrame(() => rowToggle(sheetRef.current, moved.id)?.focus());
    },
    [config, edit, t],
  );

  const removeDangling = useCallback(() => {
    const drop = new Set(dangling);
    edit({ ...config, segments: config.segments.filter((s) => !drop.has(s.id)) });
    setExpanded(null);
  }, [config, dangling, edit]);

  /** A1, B1, A2, B2 … from both rosters — offered only while the order is empty. */
  const alternate = useCallback(() => {
    const a = speakersOf(config, 'A');
    const b = speakersOf(config, 'B');
    const taken = new Set<string>([config.id, ...config.speakers.map((s) => s.id), ...config.segments.map((s) => s.id)]);
    const added: Segment[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      for (const speaker of [a[i], b[i]]) {
        if (speaker === undefined) continue;
        added.push({ id: uniqueId(taken), kind: 'speech', speakerId: speaker.id, allottedMs: null });
      }
    }
    if (added.length === 0) return;
    edit({ ...config, segments: [...config.segments, ...added] });
  }, [config, edit]);

  /* ── presets and apply ──────────────────────────────────────────────────── */

  const applyPreset = useCallback(
    (key: PresetKey, keepRoster: boolean) => {
      const fresh = instantiatePreset(key);
      let next: RoundConfig = { ...fresh, id: config.id };
      if (keepRoster) {
        next = {
          ...next,
          sides: [
            { ...next.sides[0], label: config.sides[0].label, color: config.sides[0].color },
            { ...next.sides[1], label: config.sides[1].label, color: config.sides[1].color },
          ],
          speakers: next.speakers.map((speaker) => {
            const ordinal = next.speakers.filter((s) => s.side === speaker.side).indexOf(speaker);
            const mine = speakersOf(config, speaker.side)[ordinal];
            if (mine === undefined) return speaker;
            return mine.role === undefined
              ? { ...speaker, name: mine.name }
              : { ...speaker, name: mine.name, role: mine.role };
          }),
        };
      }
      edit(next);
      setExpanded(null);
      setPresetsOpen(false);
      setPresetPending(null);
    },
    [config, edit],
  );

  /** True when the round now matches the draft — applied just now, or already. */
  const apply = useCallback((): boolean => {
    if (hasErrors(validate(config))) return false;
    if (canonicalJson(config) === canonicalJson(session.config)) return true;
    const nextPlan = plan(config);
    const outcome = reconcileState(session.state, nextPlan);
    replacePlan(nextPlan, outcome.state);
    pushRecent(
      config.presetRef === undefined
        ? { id: config.id, title: config.title }
        : { id: config.id, title: config.title, presetRef: config.presetRef },
    );
    flushDraft();
    setAnnounce(outcome.droppedRunning ? t('ed.appliedHeld') : t('ed.applied'));
    setAppliedFlash(true);
    return true;
  }, [config, session.config, session.state, t]);

  useEffect(() => {
    if (!appliedFlash) return;
    const timer = setTimeout(() => setAppliedFlash(false), APPLIED_FLASH_MS);
    return () => clearTimeout(timer);
  }, [appliedFlash]);

  /* ── the validation strip's chips move focus to the offending control ────── */

  const focusProblem = useCallback(
    (problem: Problem) => {
      const ref = problem.ref;
      if (ref.kind === 'segment' || ref.kind === 'cue') {
        setPane('order');
        setExpanded(ref.segId);
        requestAnimationFrame(() => {
          const toggle = rowToggle(sheetRef.current, ref.segId);
          reveal(toggle);
          toggle?.focus();
        });
        return;
      }
      if (ref.kind === 'speaker') {
        setPane('roster');
        requestSpeakerFocus(ref.speakerId);
        return;
      }
      if (ref.kind === 'side') {
        // Every side-level problem is about colour; open the settings at the picker.
        setSettings('colour');
        return;
      }
      // The round itself: the only round-level error is an empty order.
      setPane('order');
      requestAnimationFrame(() => addRef.current?.focus());
    },
    [requestSpeakerFocus],
  );

  // The strip itself is not a live region — it changes on every keystroke. What a
  // screen-reader user needs is the transition: the round became runnable, or stopped
  // being runnable.
  const lastErrors = useRef(errorCount);
  useEffect(() => {
    if (lastErrors.current === errorCount) return;
    lastErrors.current = errorCount;
    setAnnounce(errorCount === 0 ? t('v.ready') : t('v.fixToRun', { n: errorCount }));
  }, [errorCount, t]);

  /* ── leaving ────────────────────────────────────────────────────────────── */

  // One guard for every way out: the Back button and Esc call `navigate`, and the router
  // sends the browser's Back/Forward and hand-typed addresses through the same function.
  const dirtyRef = useRef(dirty);
  useLayoutEffect(() => {
    dirtyRef.current = dirty;
  });
  useEffect(
    () =>
      setLeaveGuard((to) => {
        if (discarded.current || !dirtyRef.current) return true;
        setLeaveTo(to);
        return false;
      }),
    [],
  );

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      // Older engines only prompt when returnValue is set.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const leave = useCallback(() => navigate(exitRoute), [exitRoute]);

  const applyAndLeave = useCallback(() => {
    const to = leaveTo;
    if (to === null || !apply()) return;
    setLeaveTo(null);
    navigate(to, { force: true });
  }, [apply, leaveTo]);

  const discardAndLeave = useCallback(() => {
    const to = leaveTo;
    if (to === null) return;
    // The persisted draft goes too, or `initDraft` would bring the edits straight back
    // the next time the editor opens.
    discarded.current = true;
    clearDraft();
    setLeaveTo(null);
    navigate(to, { force: true });
  }, [leaveTo]);

  const fixErrors = useCallback(() => {
    setLeaveTo(null);
    const first = firstError(problems);
    if (first !== null) focusProblem(first);
  }, [focusProblem, problems]);

  /* ── keyboard ───────────────────────────────────────────────────────────── */

  // ⌘⏎ commits from anywhere, including from inside a field — that is the whole point
  // of a commit chord, so it lives outside the hotkey layer's typing guard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.isComposing) return;
      e.preventDefault();
      apply();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [apply]);

  useHotkeys('editor', {
    undo: draft.past.length > 0 ? () => dispatchDraft({ t: 'undo' }) : undefined,
    redo: draft.future.length > 0 ? () => dispatchDraft({ t: 'redo' }) : undefined,
    share: () => setShareOpen(true),
    palette: () => {
      setPane('order');
      requestAnimationFrame(() => addRef.current?.focus());
    },
    escape: () => {
      // An open overlay owns Esc; this only fires when the editor itself is on top.
      if (overlayDepth() > 0) return;
      leave();
    },
  });

  /* ── render ─────────────────────────────────────────────────────────────── */

  const applyTitle = blocked
    ? l10n(firstError(problems)?.message)
    : dirty
      ? `${t('ed.applyTitle')} (${APPLY_KEYS})`
      : t('ed.nothingToApply');

  return (
    <section className="ed">
      <header className="ed__bar">
        <button type="button" className="btn btn--quiet ed__back" onClick={leave}>
          <Icon name="prev" /> {t('nav.back')}
        </button>

        <label className="ed__title">
          <span className="sr-only">{t('ed.title')}</span>
          <input
            type="text"
            className="ed__title-input t-name"
            value={l10n(config.title)}
            placeholder={t('ed.titlePlaceholder')}
            autoComplete="off"
            onChange={(e) => edit({ ...config, title: mirrorL10n(config.title, lang, e.target.value) }, 'title')}
          />
        </label>

        <div className="ed__tools">
          <div className="ed__group">
            <button
              type="button"
              className="btn btn--quiet ed__icon"
              aria-label={t('t.undo')}
              title={t('t.undo')}
              disabled={draft.past.length === 0}
              onClick={() => dispatchDraft({ t: 'undo' })}
            >
              <Icon name="undo" />
            </button>
            <button
              type="button"
              className="btn btn--quiet ed__icon"
              aria-label={t('t.redo')}
              title={t('t.redo')}
              disabled={draft.future.length === 0}
              onClick={() => dispatchDraft({ t: 'redo' })}
            >
              <Icon name="redo" />
            </button>
          </div>

          <div className="ed__group">
            <button type="button" className="btn btn--quiet ed__tool" onClick={() => setPresetsOpen(true)}>
              {t('ed.formats')}
            </button>
            <button type="button" className="btn btn--quiet ed__tool" onClick={() => setShareOpen(true)}>
              {t('ed.share')}
            </button>
            <button type="button" className="btn btn--quiet ed__tool" onClick={() => setSettings('open')}>
              {t('ed.settings')}
            </button>
          </div>

          <div className="ed__commit">
            <span
              id={stateId}
              className="ed__state t-meta"
              data-state={dirty ? 'dirty' : appliedFlash ? 'applied' : 'clean'}
            >
              {dirty ? (
                <>
                  <span className="ed__dot" aria-hidden="true" />
                  <span className="ed__state-text">{t('ed.unapplied')}</span>
                </>
              ) : appliedFlash ? (
                <>
                  <Icon name="check" />
                  <span className="ed__state-text">{t('ed.appliedShort')}</span>
                </>
              ) : null}
            </span>
            <button
              type="button"
              className="btn btn--primary ed__apply"
              disabled={!dirty || blocked}
              title={applyTitle}
              aria-describedby={stateId}
              aria-keyshortcuts="Control+Enter Meta+Enter"
              onClick={() => {
                apply();
              }}
            >
              {t('ed.apply')}
            </button>
          </div>
        </div>
      </header>

      <nav className="ed__tabs" role="tablist" aria-label={t('nav.editor')}>
        {(['roster', 'order'] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            className="ed__tab t-cap"
            aria-selected={pane === name}
            onClick={() => setPane(name)}
          >
            {name === 'roster' ? t('ed.roster') : t('ed.runsheet')}
          </button>
        ))}
      </nav>

      <div className="ed__panes">
        {/* ─────────────────────────────────────────────────────── roster ── */}
        <section className="ed__pane ed__pane--roster" data-active={pane === 'roster'} aria-labelledby="ed-h-roster">
          <h2 id="ed-h-roster" className="t-cap ed__pane-head">
            {t('ed.roster')}
          </h2>
          <div className="ed__scroll">
            {SIDES.map((side) => {
              const cfg = sideCfg(config, side);
              const list = speakersOf(config, side);
              const total = list.reduce((sum, s) => sum + s.defaultMs, 0);
              return (
                <div className="team" key={side} style={{ borderLeftColor: cfg.color }}>
                  <h3 className="team__head">
                    <span className="team__name t-row">{l10n(cfg.label)}</span>
                    <span className="team__meta t-meta num">
                      {t('ed.sideTotalLine', { n: list.length, len: formatTime(total, { secondsOnly }) })}
                    </span>
                  </h3>

                  <ul className="team__list">
                    {list.map((speaker, i) => (
                      <SpeakerRow
                        key={speaker.id}
                        speaker={speaker}
                        ordinal={i + 1}
                        index={i}
                        sideLabel={l10n(cfg.label)}
                        secondsOnly={secondsOnly}
                        flagged={problems.some(
                          (p) => p.ref.kind === 'speaker' && p.ref.speakerId === speaker.id,
                        )}
                        focus={focusSpeaker}
                        onPatch={(patch) => patchSpeaker(speaker.id, patch, `speaker-${speaker.id}`)}
                        onEnter={() => addSpeaker(side, speaker.id)}
                        onDuplicate={() => duplicateSpeaker(side, speaker.id)}
                        onDelete={() => deleteSpeaker(speaker.id)}
                        onMoveSide={() =>
                          edit({
                            ...config,
                            speakers: config.speakers.map((s) =>
                              s.id === speaker.id ? { ...s, side: side === 'A' ? 'B' : 'A' } : s,
                            ),
                          })
                        }
                        onSetAllOnSide={() =>
                          edit(
                            setSideSpeakers(
                              config,
                              side,
                              list.map((s) => ({ ...s, defaultMs: speaker.defaultMs })),
                            ),
                          )
                        }
                        onMove={(delta) => reorderSpeaker(side, i, i + delta)}
                        onReorder={(from, to) => reorderSpeaker(side, from, to)}
                      />
                    ))}
                  </ul>

                  <button type="button" className="btn btn--quiet team__add" onClick={() => addSpeaker(side)}>
                    <Icon name="plus" /> {t('ed.addSpeaker')}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* ──────────────────────────────────────────────────────── order ── */}
        <section className="ed__pane ed__pane--order" data-active={pane === 'order'} aria-labelledby="ed-h-order">
          <h2 id="ed-h-order" className="t-cap ed__pane-head">
            {t('ed.runsheet')}
          </h2>

          <div className="ed__scroll" ref={scrollRef}>
            {config.segments.length === 0 ? (
              <div className="ed__empty">
                <p className="t-ctl">{t('ed.emptySheet')}</p>
                {config.speakers.length === 0 ? null : (
                  <>
                    <button type="button" className="btn" onClick={alternate}>
                      {t('ed.alternate')}
                    </button>
                    <p className="t-meta ed__empty-hint">{t('ed.alternateHint')}</p>
                  </>
                )}
              </div>
            ) : (
              <ol className="steps" ref={sheetRef}>
                {draftPlan.segments.map((ps) => {
                  const segment = ps.segment;
                  const side =
                    ps.speaker?.side ?? (ps.liveSides.length === 1 ? (ps.liveSides[0] ?? null) : null);
                  const open = expanded === ps.segId;
                  return (
                    <SegmentCard
                      key={ps.segId}
                      segment={segment}
                      index={ps.index}
                      count={draftPlan.segments.length}
                      label={l10n(ps.label)}
                      who={whoOf(ps, config, lang, t)}
                      missing={ps.missingSpeakerIds.length > 0}
                      color={side === null ? null : sideCfg(config, side).color}
                      durationMs={durationOf(segment, config)}
                      perSide={segment.kind === 'chess'}
                      custom={segment.kind === 'speech' && segment.allottedMs !== null}
                      expanded={open}
                      secondsOnly={secondsOnly}
                      hintId={hintId}
                      onToggle={() => setExpanded((cur) => (cur === ps.segId ? null : ps.segId))}
                      onDuration={(ms) => patchSegment(ps.index, setDuration(segment, ms))}
                      onDuplicate={() => duplicateSegment(ps.index)}
                      onDelete={() => deleteSegment(ps.index)}
                      onMove={(delta) => reorderSegment(ps.index, ps.index + delta)}
                      onReorder={reorderSegment}
                    >
                      {open ? (
                        <SegmentDetails
                          config={config}
                          ps={ps}
                          secondsOnly={secondsOnly}
                          onPatch={(next, merge) => patchSegment(ps.index, next, merge)}
                        />
                      ) : null}
                    </SegmentCard>
                  );
                })}
              </ol>
            )}
          </div>

          <Composer config={config} secondsOnly={secondsOnly} firstRef={addRef} onAppend={appendSegment} />
          <p id={hintId} className="sr-only">
            {t('ed.reorderHint')}
          </p>
        </section>
      </div>

      <ValidationStrip
        problems={problems}
        segmentCount={config.segments.length}
        totalMs={draftPlan.totalMs}
        speakingMs={draftPlan.speakingMs}
        sideLabels={{ A: l10n(config.sides[0].label), B: l10n(config.sides[1].label) }}
        secondsOnly={secondsOnly}
        danglingCount={dangling.length}
        onRemoveDangling={removeDangling}
        onFocusProblem={focusProblem}
      />

      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      <Overlay
        open={settings !== 'closed'}
        onClose={() => setSettings('closed')}
        title={t('ed.settingsTitle')}
        size="lg"
        initialFocus={settings === 'colour' ? colourRef : undefined}
      >
        <RoundSettings config={config} secondsOnly={secondsOnly} colourRef={colourRef} onEdit={edit} />
      </Overlay>

      <ShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        config={config}
        onImport={(imported) => {
          edit({ ...imported, id: config.id });
          setExpanded(null);
          setShareOpen(false);
        }}
      />

      <Overlay open={presetsOpen} onClose={() => setPresetsOpen(false)} title={t('ed.presets')} size="lg">
        <ul className="presets">
          {PRESET_META.map((meta) => (
            <li key={meta.key} className="presets__card">
              <h3 className="t-row">{l10n(meta.name)}</h3>
              <Ribbon
                scale="thumb"
                segments={ribbonFromShares(meta.ribbon, meta.totalMs, lang)}
                colors={{ A: config.sides[0].color, B: config.sides[1].color }}
                className="presets__ribbon"
              />
              <p className="t-meta num">
                {t('lc.structure', {
                  sides: `${meta.speakersPerSide.A}v${meta.speakersPerSide.B}`,
                  n: meta.segmentCount,
                  len: formatTime(meta.totalMs, { showHours: meta.totalMs >= 3_600_000 }),
                })}
              </p>
              <p className="t-meta presets__note">{t('pr.basedOn')}</p>
              <button type="button" className="btn" onClick={() => setPresetPending(meta.key)}>
                {t('ed.usePreset')}
              </button>
            </li>
          ))}
        </ul>
      </Overlay>

      <Confirm
        open={presetPending !== null}
        title={t('d.applyPreset')}
        body={t('d.keepNamesColours')}
        confirmLabel={t('ed.keepRoster')}
        altLabel={t('ed.replaceRoster')}
        onAlt={() => {
          if (presetPending) applyPreset(presetPending, false);
        }}
        onConfirm={() => {
          if (presetPending) applyPreset(presetPending, true);
        }}
        onCancel={() => setPresetPending(null)}
      />

      <Confirm
        open={leaveTo !== null}
        title={t('d.unappliedTitle')}
        body={
          <span className="ed-leave">
            {blocked ? t('d.unappliedBlocked', { n: errorCount }) : t('d.unappliedBody')}
          </span>
        }
        cancelLabel={t('d.keepEditing')}
        altLabel={t('d.discardChanges')}
        onAlt={discardAndLeave}
        confirmLabel={blocked ? t('d.fixErrors') : t('d.applyLeave')}
        onConfirm={blocked ? fixErrors : applyAndLeave}
        onCancel={() => setLeaveTo(null)}
      />
    </section>
  );
}

/* ═════════════════════════════════════════════════ a segment, opened in place ══ */

interface SegmentDetailsProps {
  config: RoundConfig;
  ps: SegmentPlan;
  secondsOnly: boolean;
  onPatch: (next: Segment, merge?: string) => void;
}

function SegmentDetails({ config, ps, secondsOnly, onPatch }: SegmentDetailsProps): JSX.Element {
  const { t, lang } = useLang();
  const segment = ps.segment;
  const duration = durationOf(segment, config);
  const sideName = (side: SideId): string => sideCfg(config, side).label[lang];

  function setLabel(next: L10n): void {
    if (segment.kind === 'speech') {
      // A speech without its own label shows its speaker's role; clearing both halves
      // returns it to that rather than to a blank.
      const blank = next.en.trim() === '' && next.zh.trim() === '';
      const { label: _drop, ...rest } = segment;
      onPatch(blank ? rest : { ...segment, label: next }, `label-${segment.id}`);
      return;
    }
    onPatch({ ...segment, label: next }, `label-${segment.id}`);
  }

  const cues = (
    <Group label={t('ed.cueTiers')}>
      <Toggle
        checked={segment.cues !== undefined}
        label={t('ed.customCues')}
        hint={
          segment.cues === undefined
            ? t('ed.roundCuesSummary', { list: cueList(config.rules.cues, secondsOnly, t) })
            : undefined
        }
        onChange={(on) => onPatch(on ? { ...segment, cues: resolveCues(segment, config.rules) } : withoutCues(segment))}
      />
      {segment.cues === undefined ? null : (
        <CueEditor cues={segment.cues} secondsOnly={secondsOnly} onChange={(next) => onPatch({ ...segment, cues: next })} />
      )}
    </Group>
  );

  const label = (
    <Bilingual label={t('ed.label')} value={segment.label} placeholder={ps.label} onChange={(next) => setLabel(next)} />
  );

  const timeLabel = segment.kind === 'chess' ? `${t('ed.time')} · ${t('ed.perSide')}` : t('ed.time');
  const time = (
    <TimeRow label={timeLabel}>
      <TimeField
        className="fld__time"
        valueMs={duration}
        onChange={(ms) => onPatch(setDuration(segment, ms))}
        label={timeLabel}
        labelHidden
        secondsOnly={secondsOnly}
      />
      {segment.kind === 'speech' && ps.speaker !== null ? (
        segment.allottedMs === null ? (
          <span className="fld__hint t-meta">
            {t('ed.followsSpeaker', { name: speakerDisplay(config, ps.speaker, lang) })}
          </span>
        ) : (
          <button
            type="button"
            className="btn btn--quiet fld__inline t-meta"
            onClick={() => onPatch({ ...segment, allottedMs: null })}
          >
            {t('ed.useSpeakerTime', {
              name: speakerDisplay(config, ps.speaker, lang),
              time: formatTime(ps.speaker.defaultMs, { secondsOnly }),
            })}
          </button>
        )
      ) : null}
    </TimeRow>
  );

  switch (segment.kind) {
    case 'speech':
      return (
        <div className="det">
          <Field label={t('ed.pickSpeaker')}>
            <select
              className="in"
              value={segment.speakerId}
              onChange={(e) => onPatch({ ...segment, speakerId: e.target.value })}
            >
              {config.speakers.map((speaker) => (
                <option key={speaker.id} value={speaker.id}>
                  {`${sideName(speaker.side)} · ${speakerDisplay(config, speaker, lang)}`}
                </option>
              ))}
              {config.speakers.some((s) => s.id === segment.speakerId) ? null : (
                <option value={segment.speakerId}>{t('ed.speakerDeleted')}</option>
              )}
            </select>
          </Field>
          {time}
          <TimeRow label={t('ed.protectedTime')} hint={t('ed.protectedHelp')}>
            <TimeField
              className="fld__time"
              valueMs={segment.protectedMs ?? 0}
              onChange={(ms) => {
                if (ms <= 0) {
                  const { protectedMs: _drop, ...rest } = segment;
                  onPatch(rest);
                  return;
                }
                onPatch({ ...segment, protectedMs: ms });
              }}
              label={t('ed.protectedTime')}
              labelHidden
              bareUnit="seconds"
              secondsOnly={secondsOnly}
            />
          </TimeRow>
          {label}
          {cues}
        </div>
      );

    case 'prep':
      return (
        <div className="det">
          {time}
          <Field label={t('ed.prepSide')}>
            <select
              className="in"
              value={segment.side}
              onChange={(e) => onPatch({ ...segment, side: e.target.value as SideId | 'both' })}
            >
              <option value="both">{t('ui.both')}</option>
              <option value="A">{sideName('A')}</option>
              <option value="B">{sideName('B')}</option>
            </select>
          </Field>
          {label}
          {cues}
        </div>
      );

    case 'chess':
      return (
        <div className="det">
          {time}
          <Field label={t('ed.firstFloor')}>
            <select
              className="in"
              value={segment.firstFloor}
              onChange={(e) => onPatch({ ...segment, firstFloor: e.target.value as SideId | 'operator' })}
            >
              <option value="A">{sideName('A')}</option>
              <option value="B">{sideName('B')}</option>
              <option value="operator">{t('ed.operatorChooses')}</option>
            </select>
          </Field>
          {label}
          {cues}
        </div>
      );

    case 'shared':
      return (
        <div className="det">
          {time}
          <Group label={t('ed.liveSides')}>
            {SIDES.map((side) => (
              <Toggle
                key={side}
                checked={segment.live.includes(side)}
                label={sideName(side)}
                onChange={(on) =>
                  onPatch({
                    ...segment,
                    live: on ? [...segment.live, side] : segment.live.filter((s) => s !== side),
                  })
                }
              />
            ))}
          </Group>
          <Group label={t('ed.participants')}>
            {config.speakers.map((speaker) => (
              <Toggle
                key={speaker.id}
                checked={(segment.speakerIds ?? []).includes(speaker.id)}
                label={`${sideName(speaker.side)} · ${speakerDisplay(config, speaker, lang)}`}
                onChange={(on) => {
                  const ids = segment.speakerIds ?? [];
                  onPatch({
                    ...segment,
                    speakerIds: on ? [...ids, speaker.id] : ids.filter((id) => id !== speaker.id),
                  });
                }}
              />
            ))}
          </Group>
          {label}
          {cues}
        </div>
      );

    case 'break':
      return (
        <div className="det">
          {time}
          {label}
          {cues}
        </div>
      );
  }
}

/* ═══════════════════════════════════════════════════════════ round settings ══ */

interface RoundSettingsProps {
  config: RoundConfig;
  secondsOnly: boolean;
  colourRef: RefObject<HTMLDivElement | null>;
  onEdit: (next: RoundConfig, merge?: string) => void;
}

function RoundSettings({ config, secondsOnly, colourRef, onEdit }: RoundSettingsProps): JSX.Element {
  const { t, lang } = useLang();
  const rules = config.rules;
  const advanceStarts = rules.advanceStartsClock === true;
  const exclusive = rules.freeDebateExclusive !== false;
  const colourId = useId();

  return (
    <div className="rs">
      <Bilingual
        label={t('ed.title')}
        value={config.title}
        onChange={(title, half) => onEdit({ ...config, title }, `title-${half}`)}
      />

      <Section title={t('ed.sides')}>
        <Bilingual
          label={t('ed.sideAName')}
          value={config.sides[0].label}
          onChange={(label, half) => onEdit(withSide(config, 'A', { label }), `side-A-${half}`)}
        />
        <Bilingual
          label={t('ed.sideBName')}
          value={config.sides[1].label}
          onChange={(label, half) => onEdit(withSide(config, 'B', { label }), `side-B-${half}`)}
        />
        <div className="fld">
          <span className="fld__key" id={colourId}>
            {t('ed.color')}
          </span>
          <div className="fld__val fld__val--wide rs__colour" ref={colourRef} tabIndex={-1} role="group" aria-labelledby={colourId}>
            <SideColorPicker
              colorA={config.sides[0].color}
              colorB={config.sides[1].color}
              labelA={config.sides[0].label[lang]}
              labelB={config.sides[1].label[lang]}
              onChange={(a, b) =>
                onEdit({
                  ...config,
                  sides: [
                    { ...config.sides[0], color: a },
                    { ...config.sides[1], color: b },
                  ],
                })
              }
            />
          </div>
        </div>
      </Section>

      <Section title={t('ed.cueTiers')}>
        <Group label={t('ed.defaultCues')}>
          <CueEditor cues={rules.cues} secondsOnly={secondsOnly} onChange={(cues) => onEdit(withRules(config, { cues }))} />
        </Group>
        <TimeRow label={t('ed.grace')} hint={t('ed.graceHelp')}>
          <TimeField
            className="fld__time"
            valueMs={rules.graceMs}
            onChange={(ms) => onEdit(withRules(config, { graceMs: ms }))}
            label={t('ed.grace')}
            labelHidden
            bareUnit="seconds"
            secondsOnly={secondsOnly}
          />
        </TimeRow>
        <TimeRow label={t('ed.overtimeCap')}>
          <TimeField
            className="fld__time"
            valueMs={rules.overtimeCapMs}
            onChange={(ms) => onEdit(withRules(config, { overtimeCapMs: ms }))}
            label={t('ed.overtimeCap')}
            labelHidden
            secondsOnly={secondsOnly}
          />
        </TimeRow>
      </Section>

      <Section title={t('ed.displaySound')}>
        <Group label={t('ed.display')} radio>
          <Choice
            name="display"
            checked={rules.display === 'mm:ss'}
            label={t('ed.displayMinutes')}
            onSelect={() => onEdit(withRules(config, { display: 'mm:ss' }))}
          />
          <Choice
            name="display"
            checked={rules.display === 'seconds'}
            label={t('ed.displaySeconds')}
            onSelect={() => onEdit(withRules(config, { display: 'seconds' }))}
          />
        </Group>
        <Group label={t('ed.language')} radio>
          <Choice
            name="rlang"
            checked={rules.lang === 'en'}
            label="English"
            onSelect={() => onEdit(withRules(config, { lang: 'en' }))}
          />
          <Choice
            name="rlang"
            checked={rules.lang === 'zh'}
            label="中文"
            onSelect={() => onEdit(withRules(config, { lang: 'zh' }))}
          />
        </Group>
        <Group label={t('ed.sound')}>
          <Toggle
            checked={rules.sound}
            label={t('ed.soundOn')}
            onChange={(on) => onEdit(withRules(config, { sound: on }))}
          />
        </Group>
      </Section>

      {/* Two ordinary settings. Neither position is the right one; each is described by
          what it does, and the operator picks the one that matches their room. */}
      <Section title={t('ed.behaviour')}>
        <Group label={t('ed.advanceRule')} radio>
          <Choice
            name="advance"
            checked={!advanceStarts}
            label={t('ed.advanceArm')}
            hint={t('ed.advanceArmHelp')}
            onSelect={() => onEdit(withRules(config, { advanceStartsClock: false }))}
          />
          <Choice
            name="advance"
            checked={advanceStarts}
            label={t('ed.advanceAuto')}
            hint={t('ed.advanceAutoHelp')}
            onSelect={() => onEdit(withRules(config, { advanceStartsClock: true }))}
          />
        </Group>
        <Group label={t('ed.freeDebateRule')} radio>
          <Choice
            name="chess"
            checked={exclusive}
            label={t('ed.freeExclusive')}
            hint={t('ed.freeExclusiveHelp')}
            onSelect={() => onEdit(withRules(config, { freeDebateExclusive: true }))}
          />
          <Choice
            name="chess"
            checked={!exclusive}
            label={t('ed.freeConcurrent')}
            hint={t('ed.freeConcurrentHelp')}
            onSelect={() => onEdit(withRules(config, { freeDebateExclusive: false }))}
          />
        </Group>
      </Section>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════ small controls ══ */

const TONES: CueTone[] = ['soft', 'single', 'double', 'triple'];
const TONE_KEY = {
  soft: 'ed.toneSoft',
  single: 'ed.toneSingle',
  double: 'ed.toneDouble',
  triple: 'ed.toneTriple',
} as const;

function CueEditor({
  cues,
  secondsOnly,
  onChange,
}: {
  cues: readonly CueSpec[];
  secondsOnly: boolean;
  onChange: (cues: CueSpec[]) => void;
}): JSX.Element {
  const { t } = useLang();
  return (
    <div className="cues">
      {cues.length === 0 ? null : (
        <ul className="cues__list">
          {cues.map((cue, i) => (
            <li key={`${cue.atMs}-${i}`} className="cues__row">
              <TimeField
                valueMs={cue.atMs}
                onChange={(ms) => onChange(sortCues(cues.map((c, j) => (j === i ? { ...c, atMs: ms } : c))))}
                label={t('ed.cueAt')}
                labelHidden
                bareUnit="seconds"
                secondsOnly={secondsOnly}
                className="cues__time"
              />
              <label className="cues__tone">
                <span className="sr-only">{t('ed.cueTone')}</span>
                <select
                  className="in"
                  value={cue.tone}
                  onChange={(e) =>
                    onChange(cues.map((c, j) => (j === i ? { ...c, tone: e.target.value as CueTone } : c)))
                  }
                >
                  {TONES.map((tone) => (
                    <option key={tone} value={tone}>
                      {t(TONE_KEY[tone])}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn btn--quiet cues__drop"
                aria-label={t('ed.delete')}
                title={t('ed.delete')}
                onClick={() => onChange(cues.filter((_, j) => j !== i))}
              >
                <Icon name="minus" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="btn btn--quiet cues__add t-meta"
        onClick={() => onChange(sortCues([...cues, { atMs: 30_000, tone: 'soft' }]))}
      >
        <Icon name="plus" /> {t('ed.addCue')}
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  const id = useId();
  return (
    <section className="rs__sec" aria-labelledby={id}>
      <h3 id={id} className="rs__head t-cap">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** A key on the left, one native control on the right; the key is the control's label. */
function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label className="fld">
      <span className="fld__key">{label}</span>
      <span className="fld__val">{children}</span>
    </label>
  );
}

/** A key and a TimeField, which carries the same text as its own (hidden) label. */
function TimeRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): JSX.Element {
  return (
    <div className="fld">
      <span className="fld__key" aria-hidden="true">
        {label}
      </span>
      <div className="fld__val">
        <div className="fld__line">{children}</div>
        {hint === undefined ? null : <span className="fld__hint t-meta">{hint}</span>}
      </div>
    </div>
  );
}

function Group({ label, radio = false, children }: { label: string; radio?: boolean; children: ReactNode }): JSX.Element {
  const id = useId();
  return (
    <div className="fld" role={radio ? 'radiogroup' : 'group'} aria-labelledby={id}>
      <span className="fld__key" id={id}>
        {label}
      </span>
      <div className="fld__val">{children}</div>
    </div>
  );
}

/**
 * A label in both languages: the one the operator is working in first, the other beneath
 * it, smaller and quieter. Typing the first fills the second until the second is written.
 */
function Bilingual({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: L10n | undefined;
  placeholder?: L10n;
  onChange: (next: L10n, half: Lang) => void;
}): JSX.Element {
  const { t, lang } = useLang();
  const id = useId();
  const other: Lang = lang === 'zh' ? 'en' : 'zh';
  const base: L10n = value ?? { en: '', zh: '' };
  const otherName = other === 'zh' ? t('ed.labelZh') : t('ed.labelEn');

  return (
    <div className="fld">
      <label className="fld__key" htmlFor={id}>
        {label}
      </label>
      <div className="fld__val">
        <input
          id={id}
          type="text"
          className="in"
          lang={lang}
          value={base[lang]}
          placeholder={placeholder?.[lang]}
          autoComplete="off"
          onChange={(e) => onChange(mirrorL10n(value, lang, e.target.value), lang)}
        />
        <span className="bi">
          <span className="bi__lang t-cap" aria-hidden="true">
            {otherName}
          </span>
          <input
            type="text"
            className="in in--second"
            lang={other}
            value={base[other]}
            placeholder={placeholder?.[other]}
            aria-label={`${label} · ${otherName}`}
            autoComplete="off"
            onChange={(e) =>
              onChange(other === 'zh' ? { ...base, zh: e.target.value } : { ...base, en: e.target.value }, other)
            }
          />
        </span>
      </div>
    </div>
  );
}

function Toggle({
  checked,
  label,
  hint,
  onChange,
}: {
  checked: boolean;
  label: string;
  hint?: string;
  onChange: (on: boolean) => void;
}): JSX.Element {
  return (
    <label className="opt">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="t-ctl">{label}</span>
      {hint === undefined ? null : <span className="t-meta opt__hint">{hint}</span>}
    </label>
  );
}

function Choice({
  name,
  checked,
  label,
  hint,
  onSelect,
}: {
  name: string;
  checked: boolean;
  label: string;
  hint?: string;
  onSelect: () => void;
}): JSX.Element {
  return (
    <label className="opt">
      <input type="radio" name={name} checked={checked} onChange={onSelect} />
      <span className="t-ctl">{label}</span>
      {hint === undefined ? null : <span className="t-meta opt__hint">{hint}</span>}
    </label>
  );
}
