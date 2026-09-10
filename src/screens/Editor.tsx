/**
 * The GUI setup editor — the reason this rewrite exists.
 *
 * Three panes on one page: roster | run sheet | inspector. No wizard, no steps, no Next
 * button, and no Save/Discard pair (the original's worst data-loss path: Save wrote the
 * file without refreshing the view, Reload refreshed the view and threw away the edits).
 * The draft autosaves; ⌘⏎ APPLIES it to the live round by stable-id reconciliation.
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
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';

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
import { KIND_LABELS, plan, resolveCues } from '../domain/plan';
import { uniqueId } from '../domain/id';
import type { PresetKey } from '../domain/presets';
import { PRESET_META, instantiatePreset } from '../domain/presets';
import { migrate } from '../domain/migrate';
import type { Problem } from '../domain/validate';
import { hasErrors, validate } from '../domain/validate';

import { flushDraft, pushRecent, readApplied, readDraft, writeDraft } from '../engine/persist';
import { reconcileState } from '../engine/state';
import { replacePlan, useRound } from '../engine/store';

import { useHotkeys } from '../app/hotkeys';
import { ROUTES, currentRoute, mirrorPath, navigate } from '../app/router';
import { formatTime } from '../lib/format';
import { encodeSharePlain, tryDecodeShare, writeHash } from '../lib/urlState';
import { useLang } from '../i18n/useLang';

import { Confirm } from '../ui/Confirm';
import type { ComposerPick } from '../ui/Composer';
import { Composer } from '../ui/Composer';
import { Icon } from '../ui/Icons';
import { Keycaps } from '../ui/KeyLegendOverlay';
import { Overlay } from '../ui/Overlay';
import { overlayDepth } from '../ui/overlayStack';
import { Ribbon } from '../ui/Ribbon';
import { ribbonFromPlan, ribbonFromShares } from '../ui/ribbonData';
import { SegmentCard } from '../ui/SegmentCard';
import { ShareSheet } from '../ui/ShareSheet';
import { SideColorPicker } from '../ui/SideColorPicker';
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

/** Language mirroring: one typed word fills both halves until the other is written. */
function mirrorL10n(current: L10n | undefined, lang: Lang, text: string): L10n {
  const other = lang === 'zh' ? (current?.en ?? '') : (current?.zh ?? '');
  const filled = other.trim() === '' ? text : other;
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
  return `${sideCfg(config, speaker.side).label[lang === 'zh' ? 'zh' : 'en']} ${ordinal}`;
}

function sortCues(cues: readonly CueSpec[]): CueSpec[] {
  return [...cues].sort((a, b) => b.atMs - a.atMs);
}

/* ══════════════════════════════════════════════════════════════ the screen ══ */

type Pane = 'roster' | 'sheet' | 'inspector';
type InspectorTab = 'segment' | 'round';

export default function Editor(): JSX.Element {
  const { t, l10n, lang } = useLang();
  const session = useRound();

  const [draft, dispatchDraft] = useReducer(reduceDraft, session.config, initDraft);
  const config = draft.config;

  const [selected, setSelected] = useState<number | null>(null);
  const [pane, setPane] = useState<Pane>('sheet');
  const [tab, setTab] = useState<InspectorTab>('round');
  const [announce, setAnnounce] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [presetPending, setPresetPending] = useState<PresetKey | null>(null);
  const [focusSpeaker, setFocusSpeaker] = useState<string | null>(null);

  const sheetRef = useRef<HTMLUListElement>(null);
  const composerRef = useRef<HTMLInputElement>(null);
  const colorRef = useRef<HTMLDivElement>(null);

  const edit = useCallback(
    (next: RoundConfig, merge?: string) => {
      dispatchDraft(merge === undefined ? { t: 'edit', config: next } : { t: 'edit', config: next, merge });
    },
    [dispatchDraft],
  );

  const draftPlan = useMemo(() => plan(config), [config]);
  const problems = useMemo(() => validate(config), [config]);
  const blocked = hasErrors(problems);
  const secondsOnly = config.rules.display === 'seconds';
  const ribbon = useMemo(() => ribbonFromPlan(draftPlan, null, lang), [draftPlan, lang]);
  const dangling = useMemo(
    () => draftPlan.segments.filter((s) => s.missingSpeakerIds.length > 0).map((s) => s.segId),
    [draftPlan],
  );

  /* ── persistence: the draft and the URL both follow the config ───────────── */

  useEffect(() => {
    writeDraft(config);
  }, [config]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        writeHash(mirrorPath('edit', encodeSharePlain(config)), 'replace');
      } catch {
        // A config too large for the address bar still edits fine; the URL simply
        // stops mirroring rather than the screen failing.
      }
    }, MIRROR_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [config]);

  useEffect(() => () => flushDraft(), []);

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
      setFocusSpeaker(speaker.id);
    },
    [config, edit],
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
      setFocusSpeaker(copy.id);
    },
    [config, edit],
  );

  const reorderSpeaker = useCallback(
    (side: SideId, from: number, to: number) => {
      const list = speakersOf(config, side);
      if (from === to || list[from] === undefined) return;
      edit(setSideSpeakers(config, side, move(list, from, to)));
      setAnnounce(t('ed.movedTo', { i: Math.max(0, Math.min(list.length - 1, to)) + 1, n: list.length }));
    },
    [config, edit, t],
  );

  /* ── run sheet ──────────────────────────────────────────────────────────── */

  const appendSegment = useCallback(
    (pick: ComposerPick) => {
      const segment = makeSegment(pick, mintId(config));
      edit({ ...config, segments: [...config.segments, segment] });
      setSelected(config.segments.length);
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
      edit({ ...config, segments: config.segments.filter((_, i) => i !== index) });
      setSelected((cur) => (cur === null ? null : cur > index ? cur - 1 : cur === index ? null : cur));
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
      setSelected(index + 1);
    },
    [config, edit],
  );

  const reorderSegment = useCallback(
    (from: number, to: number) => {
      if (from === to) return;
      const target = Math.max(0, Math.min(config.segments.length - 1, to));
      edit({ ...config, segments: move(config.segments, from, target) });
      setSelected((cur) => (cur === from ? target : cur));
      setAnnounce(t('ed.movedTo', { i: target + 1, n: config.segments.length }));
      requestAnimationFrame(() => {
        const card = sheetRef.current?.children.item(target);
        if (card instanceof HTMLElement) card.focus();
      });
    },
    [config, edit, t],
  );

  const removeDangling = useCallback(() => {
    const drop = new Set(dangling);
    edit({ ...config, segments: config.segments.filter((s) => !drop.has(s.id)) });
    setSelected(null);
  }, [config, dangling, edit]);

  /** A1, B1, A2, B2 … appended from both rosters, exactly as long as the shorter side. */
  const alternate = useCallback(() => {
    const a = speakersOf(config, 'A');
    const b = speakersOf(config, 'B');
    const taken = new Set<string>([config.id, ...config.speakers.map((s) => s.id), ...config.segments.map((s) => s.id)]);
    const added: Segment[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const pair = [a[i], b[i]];
      for (const speaker of pair) {
        if (speaker === undefined) continue;
        added.push({ id: uniqueId(taken), kind: 'speech', speakerId: speaker.id, allottedMs: null });
      }
    }
    if (added.length === 0) return;
    edit({ ...config, segments: [...config.segments, ...added] });
  }, [config, edit]);

  /** Free debate before the two closing summaries — a placement, never a correction. */
  const freeBeforeSummaries = useCallback(() => {
    const segment = makeSegment({ kind: 'chess' }, mintId(config));
    const speechAt: number[] = [];
    config.segments.forEach((s, i) => {
      if (s.kind === 'speech') speechAt.push(i);
    });
    const at = speechAt.length >= 2 ? (speechAt[speechAt.length - 2] ?? config.segments.length) : config.segments.length;
    const segments = [...config.segments];
    segments.splice(at, 0, segment);
    edit({ ...config, segments });
    setSelected(at);
  }, [config, edit]);

  /* ── presets, apply, revert ─────────────────────────────────────────────── */

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
      setSelected(null);
      setPresetsOpen(false);
      setPresetPending(null);
    },
    [config, edit],
  );

  const apply = useCallback(() => {
    if (hasErrors(validate(config))) return;
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
  }, [config, session.state, t]);

  const revert = useCallback(() => {
    const applied = readApplied();
    if (applied === null) {
      setAnnounce(t('ed.noApplied'));
      return;
    }
    edit(structuredClone(applied));
    setSelected(null);
    setAnnounce(t('ed.reverted'));
  }, [edit, t]);

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
      setPane('sheet');
      composerRef.current?.focus();
    },
    escape: () => {
      // An open overlay owns Esc; this only fires when the editor itself is on top.
      if (overlayDepth() > 0) return;
      flushDraft();
      navigate(session.plan.segments.length > 0 ? ROUTES.console : ROUTES.launch);
    },
  });

  /* ── the validation strip's chips move focus to the offending control ────── */

  const focusProblem = useCallback((problem: Problem, moveFocus = true) => {
    const ref = problem.ref;
    if (ref.kind === 'segment' || ref.kind === 'cue') {
      setPane('sheet');
      setSelected(ref.index);
      requestAnimationFrame(() => {
        const card = sheetRef.current?.children.item(ref.index);
        if (!(card instanceof HTMLElement)) return;
        card.scrollIntoView({ block: 'nearest' });
        if (moveFocus) card.focus();
      });
      return;
    }
    if (ref.kind === 'speaker') {
      setPane('roster');
      if (moveFocus) setFocusSpeaker(ref.speakerId);
      return;
    }
    setPane('inspector');
    setTab('round');
    requestAnimationFrame(() => {
      colorRef.current?.scrollIntoView({ block: 'nearest' });
      if (moveFocus) colorRef.current?.querySelector('button')?.focus();
    });
  }, []);

  // The strip itself is not a live region — it changes on every keystroke. What a
  // screen-reader user needs is the transition: the round became runnable, or stopped
  // being runnable.
  const errorCount = problems.filter((p) => p.severity === 'error').length;
  const lastErrors = useRef(errorCount);
  useEffect(() => {
    if (lastErrors.current === errorCount) return;
    lastErrors.current = errorCount;
    setAnnounce(errorCount === 0 ? t('v.ready') : t('v.fixToRun', { n: errorCount }));
  }, [errorCount, t]);

  /* ── render ─────────────────────────────────────────────────────────────── */

  const selectedSegment = selected === null ? null : (config.segments[selected] ?? null);
  const totalShowHours = draftPlan.totalMs >= 3_600_000;

  return (
    <section className="ed">
      <header className="ed__bar">
        <button
          type="button"
          className="btn btn--quiet"
          onClick={() => {
            flushDraft();
            navigate(session.plan.segments.length > 0 ? ROUTES.console : ROUTES.launch);
          }}
        >
          <Icon name="prev" /> {t('nav.back')}
        </button>

        <label className="ed__title">
          <span className="sr-only">{t('ed.title')}</span>
          <input
            type="text"
            className="ed__title-input t-read"
            value={l10n(config.title)}
            placeholder={t('ed.titlePlaceholder')}
            autoComplete="off"
            onChange={(e) => edit({ ...config, title: mirrorL10n(config.title, lang, e.target.value) }, 'title')}
          />
        </label>

        <div className="ed__bar-actions">
          <button
            type="button"
            className="btn btn--quiet"
            aria-label={t('t.undo')}
            title={t('t.undo')}
            disabled={draft.past.length === 0}
            onClick={() => dispatchDraft({ t: 'undo' })}
          >
            <Icon name="undo" />
          </button>
          <button
            type="button"
            className="btn btn--quiet"
            aria-label={t('t.redo')}
            title={t('t.redo')}
            disabled={draft.future.length === 0}
            onClick={() => dispatchDraft({ t: 'redo' })}
          >
            <Icon name="redo" />
          </button>
          <button type="button" className="btn" onClick={() => setPresetsOpen(true)}>
            {t('ed.presets')}
          </button>
          <button type="button" className="btn" onClick={() => setShareOpen(true)}>
            <Icon name="share" /> {t('sh.title')}
          </button>
          <button type="button" className="btn btn--quiet t-meta" onClick={revert}>
            {t('ed.revert')}
          </button>
          <span
            className="ed__apply"
            onMouseEnter={() => {
              if (!blocked) return;
              const first = problems.find((p) => p.severity === 'error');
              if (first) focusProblem(first, false);
            }}
          >
            <button type="button" className="btn btn--primary" disabled={blocked} onClick={apply}>
              {t('ed.apply')} <Keycaps caps={['⌘', '⏎']} />
            </button>
          </span>
        </div>
      </header>

      <nav className="ed__tabs" role="tablist" aria-label={t('nav.editor')}>
        {(['roster', 'sheet', 'inspector'] as Pane[]).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            className="ed__tab t-cap"
            aria-selected={pane === name}
            onClick={() => setPane(name)}
          >
            {name === 'roster' ? t('ed.roster') : name === 'sheet' ? t('ed.runsheet') : t('ed.inspector')}
          </button>
        ))}
      </nav>

      <div className="ed__panes">
        {/* ─────────────────────────────────────────────────────── roster ── */}
        <section className="ed__pane ed__pane--roster" data-active={pane === 'roster'} aria-labelledby="ed-h-roster">
          <h2 id="ed-h-roster" className="t-cap ed__pane-head">
            {t('ed.roster')}
          </h2>
          {(['A', 'B'] as SideId[]).map((side) => {
            const cfg = sideCfg(config, side);
            const list = speakersOf(config, side);
            const total = list.reduce((sum, s) => sum + s.defaultMs, 0);
            return (
              <div className="rosterblock" key={side}>
                <div className="rosterblock__head">
                  <span className="rosterblock__edge" style={{ background: cfg.color }} aria-hidden="true" />
                  <input
                    type="text"
                    className="rosterblock__label t-row"
                    value={l10n(cfg.label)}
                    aria-label={t('ed.sideLabel')}
                    autoComplete="off"
                    onChange={(e) =>
                      edit(withSide(config, side, { label: mirrorL10n(cfg.label, lang, e.target.value) }), `side-${side}`)
                    }
                  />
                  <button
                    type="button"
                    className="rosterblock__swatch"
                    style={{ background: cfg.color }}
                    aria-label={t('ed.color')}
                    title={t('ed.color')}
                    onClick={() => {
                      setPane('inspector');
                      setTab('round');
                      requestAnimationFrame(() => colorRef.current?.scrollIntoView({ block: 'nearest' }));
                    }}
                  />
                  <span className="rosterblock__total t-meta num">
                    {t('ed.sideTotalLine', { n: list.length, len: formatTime(total, { secondsOnly }) })}
                  </span>
                </div>

                <ul className="rosterblock__list">
                  {list.map((speaker, i) => (
                    <SpeakerRow
                      key={speaker.id}
                      speaker={speaker}
                      ordinal={i + 1}
                      index={i}
                      color={cfg.color}
                      sideLabel={l10n(cfg.label)}
                      secondsOnly={secondsOnly}
                      flagged={problems.some(
                        (p) => p.ref.kind === 'speaker' && p.ref.speakerId === speaker.id,
                      )}
                      focusKey={focusSpeaker}
                      onPatch={(patch) => patchSpeaker(speaker.id, patch, `speaker-${speaker.id}`)}
                      onEnter={() => addSpeaker(side, speaker.id)}
                      onDuplicate={() => duplicateSpeaker(side, speaker.id)}
                      onDelete={() => deleteSpeaker(speaker.id)}
                      onMoveSide={() => edit({
                        ...config,
                        speakers: config.speakers.map((s) =>
                          s.id === speaker.id ? { ...s, side: side === 'A' ? 'B' : 'A' } : s,
                        ),
                      })}
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

                <button type="button" className="btn btn--quiet rosterblock__add" onClick={() => addSpeaker(side)}>
                  <Icon name="plus" /> {t('ed.addSpeaker')}
                </button>
              </div>
            );
          })}
        </section>

        {/* ────────────────────────────────────────────────────── run sheet ── */}
        <section className="ed__pane ed__pane--sheet" data-active={pane === 'sheet'} aria-labelledby="ed-h-sheet">
          <h2 id="ed-h-sheet" className="t-cap ed__pane-head">
            {t('ed.runsheet')}
          </h2>

          <Ribbon
            scale="spine"
            segments={ribbon}
            selected={selected}
            onSelect={(i) => setSelected(i)}
            colors={{ A: config.sides[0].color, B: config.sides[1].color }}
            ariaLabel={t('ed.runsheet')}
            className="ed__spine"
          />

          <div className="ed__sheet-scroll">
            {config.segments.length === 0 ? (
              <p className="ed__empty t-ctl">{t('ed.emptySheet')}</p>
            ) : (
              <ul className="ed__cards" ref={sheetRef}>
                {draftPlan.segments.map((ps) => {
                  const segment = ps.segment;
                  const side = ps.speaker?.side ?? (ps.liveSides.length === 1 ? (ps.liveSides[0] ?? null) : null);
                  return (
                    <SegmentCard
                      key={ps.segId}
                      segment={segment}
                      index={ps.index}
                      count={draftPlan.segments.length}
                      offsetMs={ps.offsetMs}
                      durationMs={durationOf(segment, config)}
                      perSide={segment.kind === 'chess'}
                      label={l10n(ps.label)}
                      speaker={ps.speaker}
                      missing={ps.missingSpeakerIds.length > 0}
                      side={side}
                      color={side === null ? null : sideCfg(config, side).color}
                      cues={ps.cues.map((c) => c.atMs)}
                      customCues={segment.cues !== undefined}
                      inherited={segment.kind === 'speech' && segment.allottedMs === null}
                      selected={selected === ps.index}
                      secondsOnly={secondsOnly}
                      onSelect={() => {
                        setSelected(ps.index);
                        setTab('segment');
                      }}
                      onDuration={(ms) => patchSegment(ps.index, setDuration(segment, ms))}
                      onToggleInherit={() => {
                        if (segment.kind !== 'speech') return;
                        patchSegment(
                          ps.index,
                          segment.allottedMs === null
                            ? { ...segment, allottedMs: durationOf(segment, config) }
                            : { ...segment, allottedMs: null },
                        );
                      }}
                      onDuplicate={() => duplicateSegment(ps.index)}
                      onDelete={() => deleteSegment(ps.index)}
                      onMove={(delta) => reorderSegment(ps.index, ps.index + delta)}
                      onReorder={reorderSegment}
                    />
                  );
                })}
              </ul>
            )}
          </div>

          <p className="ed__length t-read num">
            <span className="t-cap ed__length-label">{t('ed.roundLength')}</span>
            {formatTime(draftPlan.totalMs, { secondsOnly, showHours: totalShowHours })}
          </p>

          <Composer
            config={config}
            secondsOnly={secondsOnly}
            inputRef={composerRef}
            onAppend={appendSegment}
            onAlternate={alternate}
            onFreeBeforeSummaries={freeBeforeSummaries}
          />
        </section>

        {/* ────────────────────────────────────────────────────── inspector ── */}
        <section
          className="ed__pane ed__pane--inspector"
          data-active={pane === 'inspector'}
          aria-labelledby="ed-h-inspector"
        >
          <h2 id="ed-h-inspector" className="sr-only">
            {t('ed.inspector')}
          </h2>
          <div className="ed__inspector-tabs" role="tablist" aria-labelledby="ed-h-inspector">
            <button
              type="button"
              role="tab"
              className="ed__tab t-cap"
              aria-selected={tab === 'segment'}
              onClick={() => setTab('segment')}
            >
              {t('ed.segmentTab')}
            </button>
            <button
              type="button"
              role="tab"
              className="ed__tab t-cap"
              aria-selected={tab === 'round'}
              onClick={() => setTab('round')}
            >
              {t('ed.roundTab')}
            </button>
          </div>

          <div className="ed__inspector-body">
            {tab === 'segment' ? (
              selectedSegment === null || selected === null ? (
                <p className="ed__empty t-ctl">{t('ed.noSelection')}</p>
              ) : (
                <SegmentInspector
                  config={config}
                  segment={selectedSegment}
                  index={selected}
                  secondsOnly={secondsOnly}
                  onPatch={(next, merge) => patchSegment(selected, next, merge)}
                />
              )
            ) : (
              <RoundInspector
                config={config}
                secondsOnly={secondsOnly}
                colorRef={colorRef}
                onEdit={edit}
              />
            )}
          </div>
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

      <ShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        config={config}
        onImport={(imported) => {
          edit({ ...imported, id: config.id });
          setSelected(null);
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
    </section>
  );
}

/* ═══════════════════════════════════════════════════ the segment inspector ══ */

interface SegmentInspectorProps {
  config: RoundConfig;
  segment: Segment;
  index: number;
  secondsOnly: boolean;
  onPatch: (next: Segment, merge?: string) => void;
}

function SegmentInspector({
  config,
  segment,
  index,
  secondsOnly,
  onPatch,
}: SegmentInspectorProps): JSX.Element {
  const { t, lang } = useLang();
  const label = segment.label;
  const inherited = segment.kind === 'speech' && segment.allottedMs === null;
  const duration = durationOf(segment, config);

  function setLabelHalf(which: Lang, text: string): void {
    const base: L10n = label ?? { en: '', zh: '' };
    const next: L10n = which === 'zh' ? { ...base, zh: text } : { ...base, en: text };
    if (segment.kind === 'speech') {
      const blank = next.en.trim() === '' && next.zh.trim() === '';
      const { label: _drop, ...rest } = segment;
      onPatch(blank ? rest : { ...segment, label: next }, `label-${segment.id}`);
      return;
    }
    onPatch({ ...segment, label: next }, `label-${segment.id}`);
  }

  return (
    <div className="insp">
      <h3 className="t-cap insp__head">
        {t('ed.segmentN', { i: index + 1 })} · {t(kindKey(segment))}
      </h3>

      <Field label={t('ed.labelEn')}>
        <input
          type="text"
          className="insp__text t-ctl"
          value={label?.en ?? ''}
          autoComplete="off"
          onChange={(e) => setLabelHalf('en', e.target.value)}
        />
      </Field>
      <Field label={t('ed.labelZh')}>
        <input
          type="text"
          className="insp__text t-ctl"
          value={label?.zh ?? ''}
          lang="zh"
          autoComplete="off"
          onChange={(e) => setLabelHalf('zh', e.target.value)}
        />
      </Field>

      <Field label={segment.kind === 'chess' ? `${t('ed.time')} · ${t('ed.perSide')}` : t('ed.time')}>
        <TimeField
          valueMs={duration}
          onChange={(ms) => onPatch(setDuration(segment, ms))}
          label={t('ed.time')}
          labelHidden
          secondsOnly={secondsOnly}
          inherited={inherited}
        />
      </Field>

      {segment.kind === 'speech' ? (
        <>
          <Toggle
            checked={!inherited}
            label={t('ed.override')}
            hint={t('ed.inherit')}
            onChange={(on) =>
              onPatch(on ? { ...segment, allottedMs: duration } : { ...segment, allottedMs: null })
            }
          />
          <Field label={t('ed.pickSpeaker')}>
            <select
              className="insp__select t-ctl"
              value={segment.speakerId}
              onChange={(e) => onPatch({ ...segment, speakerId: e.target.value })}
            >
              {config.speakers.map((speaker) => (
                <option key={speaker.id} value={speaker.id}>
                  {speakerDisplay(config, speaker, lang)}
                </option>
              ))}
              {config.speakers.some((s) => s.id === segment.speakerId) ? null : (
                <option value={segment.speakerId}>{t('ed.speakerDeleted')}</option>
              )}
            </select>
          </Field>
          <Field label={t('ed.protectedTime')} hint={t('ed.protectedHelp')}>
            <TimeField
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
          </Field>
        </>
      ) : null}

      {segment.kind === 'prep' ? (
        <Field label={t('ed.prepSide')}>
          <select
            className="insp__select t-ctl"
            value={segment.side}
            onChange={(e) => onPatch({ ...segment, side: e.target.value as SideId | 'both' })}
          >
            <option value="both">{t('ui.both')}</option>
            <option value="A">{sideCfg(config, 'A').label[lang === 'zh' ? 'zh' : 'en']}</option>
            <option value="B">{sideCfg(config, 'B').label[lang === 'zh' ? 'zh' : 'en']}</option>
          </select>
        </Field>
      ) : null}

      {segment.kind === 'chess' ? (
        <Field label={t('ed.firstFloor')}>
          <select
            className="insp__select t-ctl"
            value={segment.firstFloor}
            onChange={(e) => onPatch({ ...segment, firstFloor: e.target.value as SideId | 'operator' })}
          >
            <option value="A">{sideCfg(config, 'A').label[lang === 'zh' ? 'zh' : 'en']}</option>
            <option value="B">{sideCfg(config, 'B').label[lang === 'zh' ? 'zh' : 'en']}</option>
            <option value="operator">{t('ed.operatorChooses')}</option>
          </select>
        </Field>
      ) : null}

      {segment.kind === 'shared' ? (
        <>
          <fieldset className="insp__set">
            <legend className="t-cap">{t('ed.liveSides')}</legend>
            {(['A', 'B'] as SideId[]).map((side) => (
              <Toggle
                key={side}
                checked={segment.live.includes(side)}
                label={sideCfg(config, side).label[lang === 'zh' ? 'zh' : 'en']}
                onChange={(on) =>
                  onPatch({
                    ...segment,
                    live: on ? [...segment.live, side] : segment.live.filter((s) => s !== side),
                  })
                }
              />
            ))}
          </fieldset>
          <fieldset className="insp__set">
            <legend className="t-cap">{t('ed.participants')}</legend>
            {config.speakers.map((speaker) => {
              const on = (segment.speakerIds ?? []).includes(speaker.id);
              return (
                <Toggle
                  key={speaker.id}
                  checked={on}
                  label={speakerDisplay(config, speaker, lang)}
                  onChange={(next) => {
                    const ids = segment.speakerIds ?? [];
                    onPatch({
                      ...segment,
                      speakerIds: next ? [...ids, speaker.id] : ids.filter((id) => id !== speaker.id),
                    });
                  }}
                />
              );
            })}
          </fieldset>
        </>
      ) : null}

      <fieldset className="insp__set">
        <legend className="t-cap">{t('ed.cueTiers')}</legend>
        <Toggle
          checked={segment.cues !== undefined}
          label={t('ed.customCues')}
          hint={t('ed.useRoundCues')}
          onChange={(on) => {
            if (on) {
              onPatch({ ...segment, cues: resolveCues(segment, config.rules) });
              return;
            }
            onPatch(withoutCues(segment));
          }}
        />
        {segment.cues === undefined ? null : (
          <CueEditor
            cues={segment.cues}
            secondsOnly={secondsOnly}
            onChange={(cues) => onPatch({ ...segment, cues })}
          />
        )}
      </fieldset>
    </div>
  );
}

function kindKey(segment: Segment): 'k.speech' | 'k.shared' | 'k.prep' | 'k.free' | 'k.break' {
  switch (segment.kind) {
    case 'shared':
      return 'k.shared';
    case 'prep':
      return 'k.prep';
    case 'chess':
      return 'k.free';
    case 'break':
      return 'k.break';
    default:
      return 'k.speech';
  }
}

/* ═════════════════════════════════════════════════════ the round inspector ══ */

interface RoundInspectorProps {
  config: RoundConfig;
  secondsOnly: boolean;
  colorRef: RefObject<HTMLDivElement | null>;
  onEdit: (next: RoundConfig, merge?: string) => void;
}

function RoundInspector({ config, secondsOnly, colorRef, onEdit }: RoundInspectorProps): JSX.Element {
  const { t, lang } = useLang();
  const rules = config.rules;
  const advanceStarts = rules.advanceStartsClock === true;
  const exclusive = rules.freeDebateExclusive !== false;

  return (
    <div className="insp">
      <h3 className="t-cap insp__head">{t('ed.title')}</h3>
      <Field label={t('ed.labelEn')}>
        <input
          type="text"
          className="insp__text t-ctl"
          value={config.title.en}
          autoComplete="off"
          onChange={(e) => onEdit({ ...config, title: { ...config.title, en: e.target.value } }, 'title-en')}
        />
      </Field>
      <Field label={t('ed.labelZh')}>
        <input
          type="text"
          className="insp__text t-ctl"
          lang="zh"
          value={config.title.zh}
          autoComplete="off"
          onChange={(e) => onEdit({ ...config, title: { ...config.title, zh: e.target.value } }, 'title-zh')}
        />
      </Field>

      <h3 className="t-cap insp__head">{t('ed.sides')}</h3>
      {(['A', 'B'] as SideId[]).map((side) => {
        const cfg = sideCfg(config, side);
        return (
          <div key={side} className="insp__side">
            <Field label={`${t('ed.sideLabel')} · ${t('ed.labelEn')}`}>
              <input
                type="text"
                className="insp__text t-ctl"
                value={cfg.label.en}
                autoComplete="off"
                onChange={(e) =>
                  onEdit(withSide(config, side, { label: { ...cfg.label, en: e.target.value } }), `sl-${side}-en`)
                }
              />
            </Field>
            <Field label={`${t('ed.sideLabel')} · ${t('ed.labelZh')}`}>
              <input
                type="text"
                className="insp__text t-ctl"
                lang="zh"
                value={cfg.label.zh}
                autoComplete="off"
                onChange={(e) =>
                  onEdit(withSide(config, side, { label: { ...cfg.label, zh: e.target.value } }), `sl-${side}-zh`)
                }
              />
            </Field>
            <Field label={t('ed.prepBank')}>
              <TimeField
                valueMs={cfg.prepBankMs}
                onChange={(ms) => onEdit(withSide(config, side, { prepBankMs: ms }))}
                label={t('ed.prepBank')}
                labelHidden
                secondsOnly={secondsOnly}
              />
            </Field>
          </div>
        );
      })}

      <div ref={colorRef}>
        <h3 className="t-cap insp__head">{t('ed.color')}</h3>
        <SideColorPicker
          colorA={config.sides[0].color}
          colorB={config.sides[1].color}
          labelA={config.sides[0].label[lang === 'zh' ? 'zh' : 'en']}
          labelB={config.sides[1].label[lang === 'zh' ? 'zh' : 'en']}
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

      <h3 className="t-cap insp__head">{t('ed.cueTiers')}</h3>
      <CueEditor
        cues={rules.cues}
        secondsOnly={secondsOnly}
        onChange={(cues) => onEdit(withRules(config, { cues }))}
      />

      <Field label={t('ed.grace')} hint={t('ed.graceHelp')}>
        <TimeField
          valueMs={rules.graceMs}
          onChange={(ms) => onEdit(withRules(config, { graceMs: ms }))}
          label={t('ed.grace')}
          labelHidden
          bareUnit="seconds"
          secondsOnly={secondsOnly}
        />
      </Field>

      <Field label={t('ed.overtimeCap')}>
        <TimeField
          valueMs={rules.overtimeCapMs}
          onChange={(ms) => onEdit(withRules(config, { overtimeCapMs: ms }))}
          label={t('ed.overtimeCap')}
          labelHidden
          secondsOnly={secondsOnly}
        />
      </Field>

      <fieldset className="insp__set">
        <legend className="t-cap">{t('ed.display')}</legend>
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
      </fieldset>

      <fieldset className="insp__set">
        <legend className="t-cap">{t('ed.language')}</legend>
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
      </fieldset>

      <Toggle
        checked={rules.sound}
        label={t('ed.sound')}
        onChange={(on) => onEdit(withRules(config, { sound: on }))}
      />

      {/* Two ordinary settings. Neither position is the right one; each is described by
          what it does, and the operator picks the one that matches their room. */}
      <fieldset className="insp__set">
        <legend className="t-cap">{t('ed.advanceRule')}</legend>
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
      </fieldset>

      <fieldset className="insp__set">
        <legend className="t-cap">{t('ed.freeDebateRule')}</legend>
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
      </fieldset>
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
                className="insp__select t-meta"
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
      <button
        type="button"
        className="btn btn--quiet t-meta"
        onClick={() => onChange(sortCues([...cues, { atMs: 30_000, tone: 'soft' }]))}
      >
        <Icon name="plus" /> {t('ed.addCue')}
      </button>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="insp__field">
      <span className="t-cap insp__label">{label}</span>
      {children}
      {hint === undefined ? null : <span className="t-meta insp__hint">{hint}</span>}
    </label>
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
    <label className="insp__toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="t-ctl">{label}</span>
      {hint === undefined ? null : <span className="t-meta insp__hint">{hint}</span>}
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
    <label className="insp__choice">
      <input type="radio" name={name} checked={checked} onChange={onSelect} />
      <span className="t-ctl">{label}</span>
      {hint === undefined ? null : <span className="t-meta insp__hint">{hint}</span>}
    </label>
  );
}
