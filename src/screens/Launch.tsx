/**
 * LAUNCH `#/` — cold URL to a running round in well under a minute.
 *
 * The order of the page is the order of the operator's urgency:
 *   1. an interrupted live round (< 8h) — losing your place mid-round is the one
 *      failure this app may never commit, so the offer sits above everything,
 *   2. the seven formats, each showing its roster as figures and its Ribbon as the
 *      timeline strip, so the SHAPE of the round — who is in the room, and how the
 *      time is divided — is legible before you commit to it,
 *   3. rounds this browser has run before,
 *   4. a paste-or-drop field for a share link, a `.debate.json`, or a legacy Unity
 *      `save.json`,
 *   5. a plain description of what this is.
 *
 * A format is a starting point and nothing more: opening one never locks the roster,
 * the order or the times, and nothing on this screen compares a round back against
 * the preset it came from.
 */

import type { ChangeEvent, CSSProperties, DragEvent, JSX } from 'react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { Lang, RoundConfig } from '../domain/config';
import { canonicalJson } from '../domain/config';
import type { MigrationProblem } from '../domain/migrate';
import { plan as buildPlan } from '../domain/plan';
import { hasErrors, validate } from '../domain/validate';
import type { PresetKey, PresetMeta } from '../domain/presets';
import {
  DEFAULT_PRESET,
  PRESET_META,
  instantiateConfig,
  instantiatePreset,
} from '../domain/presets';
import type { Now } from '../engine/chronometer';
import { now } from '../engine/chronometer';
import { registerTick } from '../engine/loop';
import type { DraftRecord, RecentEntry } from '../engine/persist';
import {
  clearDraft,
  clearDraftFor,
  clearRecents,
  readApplied,
  readDraft,
  readLibrary,
  readLive,
  readRecents,
  saveToLibrary,
} from '../engine/persist';
import { clockView, primaryClockId, roundPhase } from '../engine/selectors';
import type { Session } from '../engine/store';
import { getSession, useRound } from '../engine/store';
import type { StringKey } from '../i18n/strings';
import type { TFn } from '../i18n/useLang';
import { useLang } from '../i18n/useLang';
import { autoInk } from '../lib/contrast';
import { formatTime } from '../lib/format';
import { configHash } from '../lib/hash';
import { useConfirm } from '../ui/useConfirm';
import { Icon } from '../ui/Icons';
import { Keycaps } from '../ui/KeyLegendOverlay';
import { Ribbon } from '../ui/Ribbon';
import { ribbonFromPlan, ribbonFromShares } from '../ui/ribbonData';
import { Debater } from '../ui/unity/Debater';

import type { OpenOptions } from '../app/boot';
import {
  clearShareError,
  dismissResume,
  hasRound,
  importText,
  keepRound,
  openConfig,
  openLegend,
  outgoingRound,
  restartRound,
  resumeRound,
  toggleTheme,
  useBootState,
  useTheme,
} from '../app/boot';
import { useHotkeys } from '../app/hotkeys';
import { ROUTES, navigate } from '../app/router';

import './screens.css';

/* ------------------------------------------------------------------- helpers */

const PRESET_NAME: Record<PresetKey, StringKey> = {
  chinese4v4: 'pr.chinese',
  bp: 'pr.bp',
  wsdc: 'pr.wsdc',
  ld: 'pr.ld',
  policy: 'pr.policy',
  pf: 'pr.pf',
  blank: 'pr.blank',
};

/** `2 hours ago` / `2小时前`, from the platform rather than a table of plural forms. */
function agoPhrase(ms: number, lang: Lang): string {
  const rtf = new Intl.RelativeTimeFormat(lang === 'zh' ? 'zh-CN' : 'en', {
    numeric: 'always',
  });
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return rtf.format(-seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  return rtf.format(-Math.round(hours / 24), 'day');
}

/** `Updated just now` inside the first minute: `0 seconds ago` reads like a fault. */
function updatedPhrase(ms: number, lang: Lang, t: TFn): string {
  return ms < 60_000 ? t('lc.updatedJustNow') : t('lc.updated', { time: agoPhrase(ms, lang) });
}

/** `4v4 · 10 segments · 34:00`, or null for a round with nothing in it yet. */
function structureLine(config: RoundConfig, totalMs: number, t: TFn): string | null {
  if (config.segments.length === 0 && config.speakers.length === 0) return null;
  const a = config.speakers.filter((s) => s.side === 'A').length;
  const b = config.speakers.filter((s) => s.side === 'B').length;
  return t('lc.structure', {
    sides: `${a}v${b}`,
    n: config.segments.length,
    len: formatTime(totalMs),
  });
}

/** What the round's clock reads right now. A free debate nobody has opened reads its
 *  first side, since both sides start from the same allotment. */
function remainingNow(s: Session, n: Now): number {
  const segment = s.plan.segments[s.state.cursor];
  const id = primaryClockId(s.state, s.plan) ?? segment?.clockIds[0] ?? null;
  const view = id === null ? null : clockView(s.state, s.plan, id, n);
  return view?.remainingMs ?? 0;
}

function sideColors(config: RoundConfig): { A?: string; B?: string } {
  const a = config.sides[0]?.color;
  const b = config.sides[1]?.color;
  const out: { A?: string; B?: string } = {};
  if (a !== undefined) out.A = a;
  if (b !== undefined) out.B = b;
  return out;
}

/**
 * A card paints a preset's own colours, not the loaded round's, so the four identity
 * tokens `<Debater>` reads are set on the card rather than on the document root.
 */
function sideTokens(config: RoundConfig): CSSProperties {
  const a = config.sides[0].color;
  const b = config.sides[1].color;
  return {
    ['--side-a' as string]: a,
    ['--side-a-ink' as string]: autoInk(a),
    ['--side-b' as string]: b,
    ['--side-b-ink' as string]: autoInk(b),
  } as CSSProperties;
}

async function textOfDrop(event: DragEvent<HTMLElement>): Promise<string> {
  const file = event.dataTransfer.files.item(0);
  if (file) return file.text();
  return event.dataTransfer.getData('text');
}

/* -------------------------------------------------------------------- screen */

export default function Launch(): JSX.Element {
  const { t, l10n, lang, toggleLang } = useLang();
  const boot = useBootState();
  const theme = useTheme();
  const session = useRound();
  const { ask, dialog } = useConfirm();

  const [recents, setRecents] = useState<RecentEntry[]>(() => readRecents());
  // One reading of the wall clock for the whole visit: "2 hours ago" has no business
  // changing under the operator between two renders of the same list.
  const [listedAt] = useState(() => Date.now());
  const [pasted, setPasted] = useState('');
  const [staged, setStaged] = useState<RoundConfig | null>(null);
  const [problems, setProblems] = useState<MigrationProblem[]>([]);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const underWay = roundPhase(session.state, session.plan) === 'in';

  // The editor's draft, read once per visit like the recents. It is offered back only while
  // it differs from the loaded round: a draft that matches it has nothing unapplied in it.
  const [draft, setDraft] = useState<DraftRecord | null>(() => readDraft());
  const unapplied = useMemo(
    () =>
      draft !== null && canonicalJson(draft.config) !== canonicalJson(session.config) ? draft : null,
    [draft, session.config],
  );

  /** A draft is the only copy of its changes, so throwing one away is asked, never done. */
  const confirmDiscard = useCallback(
    (record: DraftRecord): Promise<boolean> =>
      ask({
        title: t('lc.discardDraftTitle'),
        body: t('lc.discardDraftBody', { title: l10n(record.config.title) || t('lc.untitled') }),
        confirmLabel: t('d.discardChanges'),
        tone: 'danger',
      }),
    [ask, l10n, t],
  );

  /**
   * Open a round. The only thing worth a dialog on this screen is what that does to the
   * round already loaded: under way or edited, the operator is asked first. Either way it
   * goes into Recent rounds, edits and all, before the new round takes its place.
   */
  const openWith = useCallback(
    async (config: RoundConfig, opts: OpenOptions = {}): Promise<void> => {
      const current = getSession();
      // The round that is already loaded: go to it. Opening it again would start it
      // over, and nobody presses Open to lose their place.
      if (
        hasRound() &&
        config.id === current.config.id &&
        configHash(config) === current.plan.hash
      ) {
        dismissResume();
        navigate(opts.route ?? ROUTES.console);
        return;
      }
      // A draft of a round that is neither loaded nor the one being opened: nothing else
      // holds those changes, and the next round's editor would write over them.
      const stray = readDraft();
      if (stray !== null && stray.config.id !== current.config.id && stray.config.id !== config.id) {
        if (!(await confirmDiscard(stray))) return;
        clearDraft();
        setDraft(null);
      }
      const outgoing = outgoingRound();
      if (outgoing !== null && (outgoing.progress || outgoing.edited)) {
        const title = l10n(outgoing.config.title) || t('lc.untitled');
        const lost = outgoing.draft !== null && hasErrors(validate(outgoing.draft));
        const ok = await ask({
          title: t('d.replaceTitle'),
          body: (
            <>
              <p>{t('d.replaceKept', { title })}</p>
              {lost ? <p>{t('d.replaceDraftBlocked')}</p> : null}
              {outgoing.progress ? <p>{t('d.replaceRestart')}</p> : null}
            </>
          ),
          confirmLabel: t('d.replaceConfirm'),
          cancelLabel: t('d.keepCurrent'),
        });
        if (!ok) return;
      }
      if (outgoing !== null) {
        if (outgoing.keep) keepRound(outgoing.config);
        // Anything its draft still held was asked about above; the draft goes with it.
        clearDraftFor(outgoing.config.id);
      }
      if (opts.recent !== false) {
        // Recents store only a title; the config itself lives in the library, which is
        // what makes a recent row re-openable on the next visit.
        saveToLibrary(config.id, config, l10n(config.title) || t('lc.untitled'));
      }
      dismissResume();
      openConfig(config, opts);
      setDraft(readDraft());
    },
    [ask, confirmDiscard, l10n, t],
  );

  /** Back into the editor on the draft: straight there for the loaded round, else by opening it. */
  const continueDraft = useCallback(
    (record: DraftRecord): void => {
      if (record.config.id === getSession().config.id) {
        navigate(ROUTES.edit);
        return;
      }
      void openWith(record.config, { route: ROUTES.edit, recent: false });
    },
    [openWith],
  );

  const discardDraft = useCallback(
    async (record: DraftRecord): Promise<void> => {
      if (!(await confirmDiscard(record))) return;
      clearDraft();
      setDraft(null);
    },
    [confirmDiscard],
  );

  /** Starting the loaded round over throws its clocks away, so it is asked, not done. */
  const restart = useCallback(async (): Promise<void> => {
    const ok = await ask({
      title: t('d.restartTitle'),
      body: t('d.restartBody'),
      confirmLabel: t('d.discard'),
      tone: 'danger',
    });
    if (ok) restartRound();
  }, [ask, t]);

  useHotkeys('launch', {
    editor: () => {
      const config = hasRound() ? session.config : instantiatePreset(DEFAULT_PRESET);
      void openWith(config, { route: ROUTES.edit, recent: false });
    },
  });

  /* --- recents ---------------------------------------------------------- */

  // A recent row is only shown when its config can actually be produced; a row that
  // cannot open is worse than no row.
  const openable = useMemo(() => {
    const library = readLibrary();
    const applied = readApplied();
    const live = readLive();
    const rows: { entry: RecentEntry; config: RoundConfig; totalMs: number }[] = [];
    for (const entry of recents) {
      let found: RoundConfig | null = null;
      if (session.config.id === entry.id) found = session.config;
      else if (library[entry.id]) found = library[entry.id]?.config ?? null;
      else if (applied && applied.id === entry.id) found = applied;
      else if (live && live.config.id === entry.id) found = live.config;
      if (found) rows.push({ entry, config: found, totalMs: buildPlan(found).totalMs });
    }
    return rows;
  }, [recents, session.config]);

  const clearList = useCallback(async (): Promise<void> => {
    const ok = await ask({
      title: t('lc.clearRecent'),
      body: t('lc.clearRecentConfirm'),
      confirmLabel: t('d.confirm'),
      tone: 'danger',
    });
    if (!ok) return;
    clearRecents();
    setRecents([]);
  }, [ask, t]);

  /* --- import ----------------------------------------------------------- */

  const ingest = useCallback(async (text: string): Promise<void> => {
    if (text.trim() === '') return;
    setReading(true);
    try {
      const outcome = await importText(text);
      setProblems(outcome.problems);
      setStaged(outcome.config);
    } finally {
      setReading(false);
    }
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>): void => {
      event.preventDefault();
      setDragging(false);
      void textOfDrop(event).then((text) => ingest(text));
    },
    [ingest],
  );

  const onFile = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const file = event.target.files?.item(0);
      event.target.value = '';
      if (file) void file.text().then((text) => ingest(text));
    },
    [ingest],
  );

  const discardImport = useCallback((): void => {
    setStaged(null);
    setProblems([]);
    setPasted('');
  }, []);

  return (
    <section className="scr" aria-labelledby="lc-title">
      <header className="scr__bar">
        <div className="scr__brand">
          <span id="lc-title" className="scr__brandname t-name">
            {t('app.name')}
          </span>
          <span className="scr__brandsub">{t('app.tagline')}</span>
        </div>
        <div className="scr__tools">
          <button type="button" className="btn btn--quiet" onClick={toggleLang}>
            {t('kb.langToggle')}
          </button>
          {/* Labelled with what it does, not with the theme already on screen. */}
          <button type="button" className="btn btn--quiet" onClick={toggleTheme}>
            {theme === 'dark' ? t('nav.useLight') : t('nav.useDark')}
          </button>
          <button
            type="button"
            className="btn btn--quiet scr__keyhint"
            onClick={openLegend}
            aria-haspopup="dialog"
            aria-keyshortcuts="?"
          >
            <Keycaps caps={['?']} />
            {t('kb.title')}
          </button>
        </div>
      </header>

      <div className="scr__scroll">
        <div className="scr__inner">
          {underWay || unapplied !== null ? (
            <div className="lc__banners">
              {underWay ? (
                <ResumeBanner
                  updatedAt={boot.resume?.updatedAt ?? null}
                  listedAt={listedAt}
                  onRestart={() => void restart()}
                />
              ) : null}
              {unapplied === null ? null : (
                <DraftBanner
                  record={unapplied}
                  listedAt={listedAt}
                  onContinue={() => continueDraft(unapplied)}
                  onDiscard={() => void discardDraft(unapplied)}
                />
              )}
            </div>
          ) : null}

          {boot.shareError === null ? null : (
            <div className="scr__alert" data-tone="warn" role="alert">
              <span className="scr__alerttext" title={boot.shareError}>
                <Icon name="alert" />
                {t('lc.linkBad')}
              </span>
              <button
                type="button"
                className="btn btn--quiet"
                onClick={clearShareError}
                aria-label={t('ed.close')}
              >
                <Icon name="close" />
              </button>
            </div>
          )}

          {boot.storage ? null : (
            <div className="scr__alert" data-tone="warn">
              <span className="scr__alerttext">
                <Icon name="alert" />
                {t('lc.noStorage')}
              </span>
            </div>
          )}

          <section className="scr__sec" aria-labelledby="lc-formats">
            <div className="scr__sechead">
              <h2 id="lc-formats" className="scr__sectitle t-row">
                {t('lc.presets')}
              </h2>
            </div>
            <p className="scr__note">{t('lc.presetNote')}</p>
            <div className="lc__grid">
              {PRESET_META.map((meta) => (
                <PresetCard
                  key={meta.key}
                  meta={meta}
                  onRun={(config) => void openWith(config)}
                  onEdit={(config) =>
                    void openWith(config, { route: ROUTES.edit, recent: false })
                  }
                />
              ))}
            </div>
          </section>

          <section className="scr__sec" aria-labelledby="lc-recent">
            <div className="scr__sechead">
              <h2 id="lc-recent" className="scr__sectitle t-row">
                {t('lc.recent')}
              </h2>
              {openable.length === 0 ? null : (
                <button type="button" className="btn btn--quiet" onClick={() => void clearList()}>
                  {t('lc.clearRecent')}
                </button>
              )}
            </div>
            {openable.length === 0 ? (
              <p className="lc__empty">{t('lc.noRecent')}</p>
            ) : (
              <ul className="lc__list">
                {openable.map(({ entry, config, totalMs }) => (
                  <li key={entry.id} className="lc__row">
                    <div className="lc__rowmain">
                      <span className="lc__rowtitle t-ctl">
                        {l10n(entry.title) || t('lc.untitled')}
                      </span>
                      <span className="lc__rowmeta">
                        {[
                          structureLine(config, totalMs, t),
                          updatedPhrase(listedAt - entry.updatedAt, lang, t),
                        ]
                          .filter((part): part is string => part !== null)
                          .join(' · ')}
                      </span>
                    </div>
                    <div className="scr__acts">
                      <button
                        type="button"
                        className="btn btn--quiet"
                        onClick={() => void openWith(config, { route: ROUTES.edit, recent: false })}
                      >
                        {t('pr.editIt')}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void openWith(config)}
                      >
                        {t('lc.open')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="scr__sec" aria-labelledby="lc-open">
            <div className="scr__sechead">
              <h2 id="lc-open" className="scr__sectitle t-row">
                {t('lc.openRound')}
              </h2>
            </div>
            <div
              className="lc__import"
              data-drag={dragging ? '' : undefined}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <label className="sr-only" htmlFor="lc-paste">
                {t('lc.pasteLink')}
              </label>
              <textarea
                id="lc-paste"
                className="lc__paste"
                value={pasted}
                spellCheck={false}
                placeholder={t('lc.pasteLink')}
                onChange={(event) => setPasted(event.target.value)}
              />
              <div className="lc__importacts">
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={reading || pasted.trim() === ''}
                  onClick={() => void ingest(pasted)}
                >
                  {t('lc.import')}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => fileRef.current?.click()}
                >
                  <Icon name="download" />
                  {t('lc.openFile')}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  className="sr-only"
                  accept=".json,application/json"
                  tabIndex={-1}
                  onChange={onFile}
                />
                <span className="scr__note">{t('lc.dropHint')}</span>
              </div>

              {problems.length === 0 ? null : (
                <div className="scr__sec" role="status">
                  <span className="t-cap">{t('sh.migrationReport')}</span>
                  <ul className="lc__problems">
                    {problems.map((problem, i) => (
                      <li
                        key={`${problem.code}-${String(i)}`}
                        className="lc__problem"
                        data-sev={problem.severity}
                      >
                        <Icon name={problem.severity === 'info' ? 'check' : 'alert'} />
                        {l10n(problem.message)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {staged === null ? null : (
                <StagedRound
                  config={staged}
                  onRun={() => void openWith(staged)}
                  onEdit={() => void openWith(staged, { route: ROUTES.edit, recent: false })}
                  onDiscard={discardImport}
                />
              )}
            </div>
          </section>

          <section className="scr__sec" aria-labelledby="lc-about">
            <div className="scr__sechead">
              <h2 id="lc-about" className="scr__sectitle t-row">
                {t('app.name')}
              </h2>
            </div>
            <p className="scr__note">{t('lc.about')}</p>
          </section>
        </div>
      </div>

      {dialog}
    </section>
  );
}

/* ----------------------------------------------------------- round in progress */

interface ResumeBannerProps {
  /** When boot put the round back from storage; null when the operator just walked here. */
  updatedAt: number | null;
  /** The one wall-clock reading this visit uses for every "updated" phrase. */
  listedAt: number;
  onRestart: () => void;
}

/**
 * The round that is loaded and under way, above everything else on the screen: which
 * segment it is on and what its clock reads. A running clock keeps counting here, written
 * by the frame loop, so the number is the one the console will show.
 */
function ResumeBanner({ updatedAt, listedAt, onRestart }: ResumeBannerProps): JSX.Element {
  const { t, l10n, lang } = useLang();
  const session = useRound();
  const left = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const paint = (n: Now): void => {
      const s = getSession();
      const text = t('d.resumeLeft', {
        time: formatTime(remainingNow(s, n), { secondsOnly: s.plan.display === 'seconds' }),
      });
      const el = left.current;
      if (el && el.textContent !== text) el.textContent = text;
    };
    paint(now());
    return registerTick(paint);
  }, [t]);

  return (
    <div className="lc__resume" role="region" aria-labelledby="lc-resume">
      <div className="lc__resumemain">
        <h2 id="lc-resume" className="lc__resumetitle t-row">
          {t('d.resumeTitle')}
        </h2>
        <p className="lc__resumebody">
          {t('d.resumeWhere', {
            title: l10n(session.config.title) || t('lc.untitled'),
            i: session.state.cursor + 1,
            n: session.plan.segments.length,
          })}
          {' · '}
          <span ref={left} data-numeric="" />
        </p>
        {updatedAt === null ? null : (
          <span className="lc__resumeage">{updatedPhrase(listedAt - updatedAt, lang, t)}</span>
        )}
      </div>
      <div className="scr__acts">
        <button type="button" className="btn btn--primary" onClick={resumeRound}>
          {t('d.resume')}
        </button>
        <button type="button" className="btn btn--quiet" onClick={onRestart}>
          {t('d.discard')}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------ unapplied editor changes */

interface DraftBannerProps {
  record: DraftRecord;
  /** The one wall-clock reading this visit uses for every "updated" phrase. */
  listedAt: number;
  onContinue: () => void;
  onDiscard: () => void;
}

/**
 * Changes the editor saved and nobody applied, usually from a tab closed mid-edit. Lighter
 * than the round in progress: nothing is running, but nothing else holds these edits.
 */
function DraftBanner({ record, listedAt, onContinue, onDiscard }: DraftBannerProps): JSX.Element {
  const { t, l10n, lang } = useLang();
  return (
    <div className="lc__draft" role="region" aria-label={t('ed.unapplied')}>
      <p className="lc__draftmain">
        <span className="lc__draftdot" aria-hidden="true" />
        <span>
          {t('lc.draft', { title: l10n(record.config.title) || t('lc.untitled') })}
          <span className="lc__draftage">
            {' · '}
            {updatedPhrase(listedAt - record.updatedAt, lang, t)}
          </span>
        </span>
      </p>
      <div className="scr__acts">
        <button type="button" className="btn btn--primary" onClick={onContinue}>
          {t('lc.continueEditing')}
        </button>
        <button type="button" className="btn btn--quiet" onClick={onDiscard}>
          {t('ed.discard')}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ roster preview */

/** Past this many figures a side is summarised instead; the exact count is in the
 *  structure line directly below either way. */
const FIGURE_CAP = 8;

/**
 * The round's two sides, drawn with the same figures the console draws,
 * facing each other across the card. Nothing here is interactive and nothing is
 * judged: the roster is shown in the order the config gives it.
 */
function RosterPreview({ config }: { config: RoundConfig }): JSX.Element | null {
  const { t, l10n } = useLang();
  const rows = (['A', 'B'] as const).map((side) => ({
    side,
    label: l10n(config.sides[side === 'A' ? 0 : 1].label),
    people: config.speakers.filter((speaker) => speaker.side === side),
  }));
  if (rows.every((row) => row.people.length === 0)) return null;

  return (
    <div className="lc__roster" style={sideTokens(config)}>
      {rows.map((row) => {
        const shown = row.people.slice(0, FIGURE_CAP);
        const hidden = row.people.length - shown.length;
        return (
          <ul
            key={row.side}
            className={row.side === 'A' ? 'lc__side' : 'lc__side lc__side--b'}
            aria-label={t('c.roster', { side: row.label })}
          >
            {shown.map((speaker, i) => (
              <li key={speaker.id}>
                <Debater side={row.side} index={i + 1} state="idle" />
              </li>
            ))}
            {hidden > 0 ? (
              <li className="lc__more">{t('lc.plusMore', { n: hidden })}</li>
            ) : null}
          </ul>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------- preset card */

interface PresetCardProps {
  meta: PresetMeta;
  onRun: (config: RoundConfig) => void;
  onEdit: (config: RoundConfig) => void;
}

function PresetCard({ meta, onRun, onEdit }: PresetCardProps): JSX.Element {
  const { t, lang } = useLang();
  const segments = useMemo(
    () => ribbonFromShares(meta.ribbon, meta.totalMs, lang),
    [meta, lang],
  );
  const colors = useMemo(() => sideColors(meta.config), [meta]);
  const isDefault = meta.key === DEFAULT_PRESET;
  const name = t(PRESET_NAME[meta.key]);

  return (
    <article className="lc__card" data-default={isDefault ? '' : undefined}>
      <div className="lc__cardhead">
        <h3 className="lc__cardname t-ctl">{name}</h3>
        {isDefault ? <span className="lc__chip">{t('lc.defaultFormat')}</span> : null}
      </div>

      <RosterPreview config={meta.config} />

      {segments.length === 0 ? null : (
        <Ribbon scale="thumb" segments={segments} colors={colors} />
      )}

      <p className="lc__cardmeta">
        {meta.segmentCount === 0
          ? t('lc.newRound')
          : t('lc.structure', {
              sides: `${meta.speakersPerSide.A}v${meta.speakersPerSide.B}`,
              n: meta.segmentCount,
              len: formatTime(meta.totalMs),
            })}
      </p>

      <div className="lc__cardacts">
        <button
          type="button"
          className="btn btn--quiet"
          onClick={() => onEdit(instantiateConfig(meta.config))}
        >
          <Icon name="edit" />
          {t('pr.editIt')}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => onRun(instantiateConfig(meta.config))}
        >
          {t('pr.runNow')}
        </button>
      </div>
    </article>
  );
}

/* ------------------------------------------------------- staged import panel */

interface StagedRoundProps {
  config: RoundConfig;
  onRun: () => void;
  onEdit: () => void;
  onDiscard: () => void;
}

/**
 * §12.2 — an import is staged and described before it is applied. Nothing about the
 * incoming run order is judged here; it is drawn exactly as it arrived.
 */
function StagedRound({ config, onRun, onEdit, onDiscard }: StagedRoundProps): JSX.Element {
  const { t, l10n, lang } = useLang();
  const runPlan = useMemo(() => buildPlan(config), [config]);
  const segments = useMemo(() => ribbonFromPlan(runPlan, null, lang), [runPlan, lang]);
  const colors = useMemo(() => sideColors(config), [config]);
  const structure = structureLine(config, runPlan.totalMs, t);

  return (
    <div className="lc__staged">
      <span className="t-cap">{t('lc.staged')}</span>
      <span className="t-ctl">{l10n(config.title) || t('lc.untitled')}</span>
      <RosterPreview config={config} />
      {segments.length === 0 ? null : (
        <Ribbon scale="thumb" segments={segments} colors={colors} />
      )}
      {structure === null ? null : <span className="lc__cardmeta">{structure}</span>}
      <div className="scr__acts">
        <button type="button" className="btn btn--primary" onClick={onRun}>
          {t('pr.runNow')}
        </button>
        <button type="button" className="btn" onClick={onEdit}>
          <Icon name="edit" />
          {t('pr.editIt')}
        </button>
        <button type="button" className="btn btn--quiet" onClick={onDiscard}>
          {t('ed.discard')}
        </button>
      </div>
    </div>
  );
}
