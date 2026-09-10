/**
 * `#/console` — the operator's instrument.
 *
 * Four bands: chrome, the working area (rails + core), the Ribbon, the keycap legend.
 * The transport row is always visible and every control stays live at and past zero,
 * because a clock never decides that a speech is over — the operator does.
 *
 * Two rules this screen exists to keep honest:
 *
 *   PERIPHERY / CORE. Identity colour is confined to the rails, the floor bars and the
 *   nameplate slabs; clock-state colour is confined to the digits, the depletion bar and
 *   the overtime fill. Asking "is that amber the Con team or the 30-second warning?" is
 *   structurally impossible here.
 *
 *   THE RUN ORDER IS THE OPERATOR'S. Speaker 3 before speaker 2, speaker 2 twice, speaker
 *   1 never — all of it is data, drawn exactly as arranged. Nothing on this screen warns,
 *   badges, reorders, dedupes or "suggests fixing" a run order.
 *
 * Every clock number on screen comes from `engine/selectors`; nothing here recomputes one.
 */

import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { armAudioNow, useAudio } from '../app/boot';
import type { HotkeyAction } from '../app/hotkeys';
import { useHotkeys } from '../app/hotkeys';
import { ROUTES, navigate } from '../app/router';
import type { Id, L10n, SideId, SpeakerCfg } from '../domain/config';
import { chessClockId } from '../domain/plan';
import { startLeader } from '../engine/channel';
import { elapsedMs, now } from '../engine/chronometer';
import { registerTick } from '../engine/loop';
import { canSwap, clockView, roundView } from '../engine/selectors';
import { toggleMuted } from '../engine/sound';
import { dispatch, getSession, redo, undo, useRound } from '../engine/store';
import { useLang } from '../i18n/useLang';
import { formatTime } from '../lib/format';
import { Icon } from '../ui/Icons';
import type { RibbonHandle } from '../ui/Ribbon';
import { Ribbon } from '../ui/Ribbon';
import { ribbonFromPlan } from '../ui/ribbonData';

import type { ChessSideView } from '../console/ChessCore';
import { ChessCore } from '../console/ChessCore';
import { CoreClock } from '../console/CoreClock';
import { KeyLegend } from '../console/KeyLegend';
import { RunSheetBar } from '../console/RunSheetBar';
import type { FloorLevel } from '../console/SideRail';
import { SideRail } from '../console/SideRail';
import { SharedCore } from '../console/SharedCore';
import { SpeakerPlate } from '../console/SpeakerPlate';
import { Transport } from '../console/Transport';
import { UndoChip } from '../console/UndoChip';
import '../console/console.css';

const STEP_15 = 15_000;
const STEP_60 = 60_000;
const STEP_5 = 5_000;

type CoreMode = 'pre' | 'complete' | 'bank' | 'chess' | 'speech' | 'shared';

export default function Console(): JSX.Element {
  const { t, l10n, lang, toggleLang } = useLang();
  const session = useRound();
  const audio = useAudio();
  const { state, plan, config } = session;

  const ribbonRef = useRef<RibbonHandle>(null);
  const [selected, setSelected] = useState(0);
  const [advancedTo, setAdvancedTo] = useState<string | null>(null);
  const [resetProgress, setResetProgress] = useState(0);
  const [stageOpen, setStageOpen] = useState(false);
  const [stageBlocked, setStageBlocked] = useState(false);
  const stageWin = useRef<Window | null>(null);

  // One `roundView` per discrete change. The ticking numbers never come through here —
  // they are written straight to the DOM by the band components' frame writers.
  const view = useMemo(() => roundView(state, plan, now()), [state, plan]);

  const ps = state.cursor >= 0 ? (plan.segments[state.cursor] ?? null) : null;
  const nextPs = plan.segments[state.cursor + 1] ?? null;
  const secondsOnly = plan.display === 'seconds';
  const swapAllowed = canSwap(state, plan);
  const isChess = ps?.kind === 'chess';

  const sideLabels = useMemo<Record<SideId, string>>(
    () => ({ A: l10n(config.sides[0].label), B: l10n(config.sides[1].label) }),
    // `l10n` is rebuilt every render; the language is what actually matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.sides, lang],
  );

  const rosters = useMemo<Record<SideId, SpeakerCfg[]>>(
    () => ({
      A: config.speakers.filter((s) => s.side === 'A'),
      B: config.speakers.filter((s) => s.side === 'B'),
    }),
    [config.speakers],
  );

  /** History, not judgement: who has already had the floor at least once. */
  const spokenIds = useMemo<Set<Id>>(() => {
    const ids = new Set<Id>();
    const upto = Math.min(state.cursor, plan.segments.length);
    for (let i = 0; i < upto; i += 1) {
      const speaker = plan.segments[i]?.speaker;
      if (speaker) ids.add(speaker.id);
    }
    return ids;
  }, [plan.segments, state.cursor]);

  const hasBank = useMemo<Record<SideId, boolean>>(
    () => ({ A: plan.banks.A !== null, B: plan.banks.B !== null }),
    [plan.banks],
  );

  const ribbon = useMemo(() => ribbonFromPlan(plan, state, lang), [plan, state, lang]);

  const mode: CoreMode =
    view.bankDraw !== null
      ? 'bank'
      : view.phase === 'pre'
        ? 'pre'
        : view.phase === 'complete' || ps === null
          ? 'complete'
          : ps.kind === 'chess'
            ? 'chess'
            : ps.kind === 'speech'
              ? 'speech'
              : 'shared';

  /* ------------------------------------------------------------------ commands */

  const raiseChip = useCallback(() => {
    const s = getSession();
    const landed = s.plan.segments[s.state.cursor] ?? null;
    setAdvancedTo(
      landed === null ? t('st.complete') : (landed.speaker?.name ?? l10n(landed.label)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const doAdvance = useCallback(
    (start?: boolean) => {
      dispatch(start === true ? { t: 'ADVANCE', start: true } : { t: 'ADVANCE' });
      raiseChip();
    },
    [raiseChip],
  );

  const loadAt = useCallback((index: number) => {
    dispatch({ t: 'LOAD', cursor: index });
  }, []);

  const openStage = useCallback(() => {
    const open = stageWin.current;
    if (open && !open.closed) {
      open.focus();
      return;
    }
    const url = new URL(window.location.href);
    url.hash = ROUTES.stage;
    const win = window.open(url.toString(), 'debate-timer-stage', 'width=1280,height=720');
    if (!win) {
      setStageBlocked(true);
      setStageOpen(false);
      return;
    }
    stageWin.current = win;
    setStageBlocked(false);
    setStageOpen(true);
  }, []);

  /* -------------------------------------------------------------------- effects */

  // The console is the leader of the console↔stage link, always. The stage never claims
  // leadership: a two-leader flicker is worse than a frozen room display.
  useEffect(() => startLeader(), []);

  // Polled only for the pip, and only while a window of ours is open.
  useEffect(() => {
    if (!stageOpen) return undefined;
    const id = window.setInterval(() => {
      if (stageWin.current?.closed === true) {
        stageWin.current = null;
        setStageOpen(false);
      }
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [stageOpen]);

  useEffect(() => {
    setSelected(Math.max(0, Math.min(state.cursor, plan.segments.length - 1)));
  }, [state.cursor, plan.segments.length]);

  // The current block fills to ACTUAL consumption, sixty times a second, without a render.
  useEffect(() => {
    return registerTick((n) => {
      const s = getSession();
      const i = s.state.cursor;
      const current = i >= 0 ? s.plan.segments[i] : undefined;
      if (!current) return;
      let used = 0;
      for (const id of current.clockIds) used += elapsedMs(s.state, id, n);
      ribbonRef.current?.write(i, used);
    });
  }, []);

  /* ------------------------------------------------------------------- hotkeys */

  const onHoldProgress = useCallback((action: HotkeyAction, progress: number) => {
    if (action === 'reset') setResetProgress(progress);
  }, []);

  const go = (): void => {
    if (view.hold) {
      dispatch({ t: 'RELEASE' });
      return;
    }
    if (view.phase === 'in' && view.transport === 'running') {
      doAdvance();
      return;
    }
    dispatch({ t: 'TOGGLE' });
  };

  const adjust = (deltaMs: number): void => {
    dispatch({ t: 'ADJUST', deltaMs });
  };

  useHotkeys(
    'console',
    {
      toggle: () => dispatch({ t: 'TOGGLE' }),
      togglePause: () => dispatch({ t: 'TOGGLE', pauseInChess: true }),
      advance: () => doAdvance(),
      advanceStart: () => doAdvance(true),
      prev: () => dispatch({ t: 'PREV' }),
      go,
      goBack: () => dispatch({ t: 'PREV' }),
      hold: () => dispatch(view.hold ? { t: 'RELEASE' } : { t: 'HOLD' }),
      reset: () => dispatch({ t: 'RESET_SEGMENT' }),
      // SWAP is hidden and its binding goes inert in the same breath: an omitted handler
      // prevents no default and does nothing at all.
      swap: swapAllowed ? () => dispatch({ t: 'SWAP' }) : undefined,
      plus15: () => adjust(STEP_15),
      minus15: () => adjust(-STEP_15),
      plus60: () => adjust(STEP_60),
      minus60: () => adjust(-STEP_60),
      plus5: () => adjust(STEP_5),
      minus5: () => adjust(-STEP_5),
      floorA: isChess ? () => dispatch({ t: 'GIVE_FLOOR', side: 'A' }) : undefined,
      floorB: isChess ? () => dispatch({ t: 'GIVE_FLOOR', side: 'B' }) : undefined,
      bankA: hasBank.A ? () => dispatch({ t: 'BANK_DRAW', side: 'A' }) : undefined,
      bankB: hasBank.B ? () => dispatch({ t: 'BANK_DRAW', side: 'B' }) : undefined,
      undo: () => undo(),
      redo: () => redo(),
      loadCursored: () => loadAt(selected),
      stageWindow: openStage,
      editor: () => navigate(ROUTES.edit),
      escape: view.bankDraw === null ? undefined : () => dispatch({ t: 'BANK_END' }),
    },
    { onHoldProgress },
  );

  /* ---------------------------------------------------------------------- rails */

  const floorLevels = useMemo<Record<SideId, FloorLevel>>(() => {
    const off: Record<SideId, FloorLevel> = { A: 'off', B: 'off' };
    if (view.bankDraw !== null) {
      return view.bankDraw === 'A' ? { A: 'on', B: 'off' } : { A: 'off', B: 'on' };
    }
    if (!ps) return off;
    if (ps.kind === 'chess') {
      if (!view.floor) return off;
      const level: FloorLevel = view.transport === 'running' ? 'on' : 'half';
      return view.floor === 'A' ? { A: level, B: 'off' } : { A: 'off', B: level };
    }
    if (ps.kind === 'speech') {
      const side = ps.speaker?.side ?? null;
      if (!side) return off;
      return side === 'A' ? { A: 'on', B: 'off' } : { A: 'off', B: 'on' };
    }
    return {
      A: ps.liveSides.includes('A') ? 'half' : 'off',
      B: ps.liveSides.includes('B') ? 'half' : 'off',
    };
  }, [ps, view.bankDraw, view.floor, view.transport]);

  const speakingId = view.currentSpeaker?.id ?? null;
  const onDeckId = view.onDeck?.id ?? null;

  /* ----------------------------------------------------------------------- core */

  const statusWord = view.hold
    ? t('st.held')
    : view.band === 'over'
      ? t('st.over')
      : view.transport === 'running'
        ? t('st.running')
        : view.transport === 'paused'
          ? t('st.paused')
          : t('st.armed');

  const primary = view.primary;
  const armed = !view.hold && view.transport === 'armed';

  const announcement = useMemo(() => {
    if (view.hold) return t('a11y.roundHeld');
    if (!ps) return view.phase === 'complete' ? t('st.complete') : t('st.preRound');
    if (isChess && view.floor) return t('a11y.floorNow', { side: sideLabels[view.floor] });
    const label = l10n(ps.label);
    const time = formatTime(primary?.remainingMs ?? ps.allottedMs, { secondsOnly });
    return view.transport === 'running'
      ? t('a11y.segmentStarted', { label, time })
      : t('a11y.segmentArmed', { label, time });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, ps, isChess, sideLabels, secondsOnly, primary, lang]);

  const chessSides = useMemo<readonly [ChessSideView, ChessSideView] | null>(() => {
    const segment = ps?.segment;
    if (!ps || segment?.kind !== 'chess') return null;
    const n = now();
    const build = (side: SideId): ChessSideView => {
      const clockId = chessClockId(ps.segId, side);
      return {
        side,
        label: sideLabels[side],
        clockId,
        allottedMs: segment.perSideMs,
        view: clockView(state, plan, clockId, n),
      };
    };
    return [build('A'), build('B')];
  }, [ps, sideLabels, state, plan]);

  const firstFloor = ps?.segment.kind === 'chess' ? ps.segment.firstFloor : 'A';
  const canStart =
    !isChess || view.floor !== null || firstFloor !== 'operator' || view.phase !== 'in';

  const roleOf = useCallback(
    (speaker: { role?: L10n }): string => l10n(speaker.role),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang],
  );

  const bankSide = view.bankDraw;
  const bankPlan = bankSide === null ? null : plan.banks[bankSide];

  let core: JSX.Element;
  if (mode === 'pre') {
    core = (
      <div className="core core--card">
        <h2 className="core__label t-cap">{t('st.preRound')}</h2>
        <p className="core__motion t-read">{l10n(config.title)}</p>
        <p className="core__hint t-meta">{t('st.armed')}</p>
      </div>
    );
  } else if (mode === 'bank' && bankSide !== null && bankPlan !== null) {
    core = (
      <CoreClock
        clockId={bankPlan.id}
        allottedMs={bankPlan.allottedMs}
        remainingMs={primary?.remainingMs ?? bankPlan.allottedMs}
        band={primary?.band ?? 'normal'}
        transport={primary?.transport ?? 'armed'}
        cues={bankPlan.cues}
        label={`${sideLabels[bankSide]} · ${t('st.prepBank')}`}
        status={statusWord}
        name={sideLabels[bankSide]}
        secondsOnly={secondsOnly}
        armed={armed}
      >
        <div className="core__plates">
          <SpeakerPlate
            side={bankSide}
            name={sideLabels[bankSide]}
            role={t('st.prepBank')}
            state="speaking"
            variant="plate"
          />
        </div>
      </CoreClock>
    );
  } else if (mode === 'chess' && ps && chessSides) {
    core = (
      <ChessCore
        label={l10n(ps.label)}
        status={statusWord}
        sides={chessSides}
        floor={view.floor}
        awaitingFloor={view.awaitingFloor}
        operatorChooses={firstFloor === 'operator'}
        firstFloorLabel={firstFloor === 'operator' ? '' : sideLabels[firstFloor]}
        cues={ps.cues}
        secondsOnly={secondsOnly}
      />
    );
  } else if (mode === 'speech' && ps) {
    const speaker = ps.speaker;
    core = (
      <CoreClock
        clockId={ps.primaryClockId}
        allottedMs={primary?.allottedMs ?? ps.allottedMs}
        remainingMs={primary?.remainingMs ?? ps.allottedMs}
        band={primary?.band ?? 'normal'}
        transport={primary?.transport ?? 'armed'}
        cues={ps.cues}
        protectedMs={ps.protectedMs}
        label={l10n(ps.label)}
        status={statusWord}
        name={speaker?.name ?? ''}
        secondsOnly={secondsOnly}
        armed={armed}
      >
        {speaker ? (
          <div className="core__plates">
            <SpeakerPlate
              side={speaker.side}
              name={speaker.name}
              role={roleOf(speaker)}
              state="speaking"
              variant="plate"
            />
          </div>
        ) : null}
        <OnDeck
          name={nextPs?.speaker?.name ?? null}
          label={nextPs === null ? null : l10n(nextPs.label)}
          timeMs={nextPs?.allottedMs ?? null}
          urgent={view.onDeckUrgent}
        />
      </CoreClock>
    );
  } else if (mode === 'shared' && ps) {
    core = (
      <SharedCore
        clockId={ps.primaryClockId}
        allottedMs={primary?.allottedMs ?? ps.allottedMs}
        remainingMs={primary?.remainingMs ?? ps.allottedMs}
        band={primary?.band ?? 'normal'}
        transport={primary?.transport ?? 'armed'}
        cues={ps.cues}
        label={l10n(ps.label)}
        status={statusWord}
        secondsOnly={secondsOnly}
        armed={armed}
        participants={ps.participants}
        sides={ps.liveSides}
        sideLabels={sideLabels}
        roleOf={roleOf}
      />
    );
  } else {
    core = (
      <div className="core core--card">
        <h2 className="core__label t-cap">{t('st.complete')}</h2>
        <p className="core__motion t-read">{l10n(config.title)}</p>
        <button type="button" className="btn btn--primary" onClick={() => navigate(ROUTES.summary)}>
          {t('nav.summary')}
        </button>
      </div>
    );
  }

  /* --------------------------------------------------------------------- render */

  return (
    <section className="console" data-mode={mode} aria-label={t('a11y.consoleRegion')}>
      <RunSheetBar
        title={l10n(config.title)}
        subtitle={`${sideLabels.A} · ${sideLabels.B}`}
        segmentIndex={Math.min(Math.max(state.cursor + 1, 0), plan.segments.length)}
        segmentCount={plan.segments.length}
        scheduledMs={plan.totalMs}
        lang={lang}
        onLang={toggleLang}
        audio={audio}
        onAudio={() => {
          if (!audio.armed) void armAudioNow();
          else toggleMuted();
        }}
        stageOpen={stageOpen}
        stageBlocked={stageBlocked}
        onStage={openStage}
        onEditor={() => navigate(ROUTES.edit)}
      />

      <div className="console__body">
        <SideRail
          side="A"
          label={sideLabels.A}
          speakers={rosters.A}
          speakingId={view.currentSpeaker?.side === 'A' ? speakingId : null}
          onDeckId={view.onDeck?.side === 'A' ? onDeckId : null}
          spokenIds={spokenIds}
          floor={floorLevels.A}
          lit={ps === null ? false : ps.liveSides.includes('A')}
          drawing={view.bankDraw === 'A'}
          hasBank={hasBank.A}
          bankMs={view.bank.A}
          onDrawBank={() => dispatch({ t: 'BANK_DRAW', side: 'A' })}
          urgent={view.onDeckUrgent}
        />

        <div className="console__core">
          {core}

          <Transport
            phase={view.phase}
            transport={view.transport}
            hold={view.hold}
            chess={isChess}
            swap={swapAllowed}
            canStart={canStart}
            sideLabels={sideLabels}
            canPrev={state.cursor > 0}
            canUndo={view.canUndo}
            canRedo={view.canRedo}
            resetProgress={resetProgress}
            on={{
              toggle: () => dispatch({ t: 'TOGGLE' }),
              togglePause: () => dispatch({ t: 'TOGGLE', pauseInChess: true }),
              advance: () => doAdvance(),
              prev: () => dispatch({ t: 'PREV' }),
              reset: () => dispatch({ t: 'RESET_SEGMENT' }),
              hold: () => dispatch(view.hold ? { t: 'RELEASE' } : { t: 'HOLD' }),
              swap: () => dispatch({ t: 'SWAP' }),
              adjust,
              floor: (side) => dispatch({ t: 'GIVE_FLOOR', side }),
              undo: () => undo(),
              redo: () => redo(),
            }}
          />

          <UndoChip
            name={advancedTo}
            onUndo={() => {
              undo();
              setAdvancedTo(null);
            }}
            onExpire={() => setAdvancedTo(null)}
          />
        </div>

        <SideRail
          side="B"
          label={sideLabels.B}
          speakers={rosters.B}
          speakingId={view.currentSpeaker?.side === 'B' ? speakingId : null}
          onDeckId={view.onDeck?.side === 'B' ? onDeckId : null}
          spokenIds={spokenIds}
          floor={floorLevels.B}
          lit={ps === null ? false : ps.liveSides.includes('B')}
          drawing={view.bankDraw === 'B'}
          hasBank={hasBank.B}
          bankMs={view.bank.B}
          onDrawBank={() => dispatch({ t: 'BANK_DRAW', side: 'B' })}
          urgent={view.onDeckUrgent}
        />
      </div>

      <div className="console__ribbon">
        <Ribbon
          ref={ribbonRef}
          scale="live"
          segments={ribbon}
          cursor={state.cursor}
          selected={selected}
          onSelect={setSelected}
          onLoad={loadAt}
          colors={{ A: config.sides[0].color, B: config.sides[1].color }}
          ariaLabel={t('ed.runsheet')}
        />
      </div>

      <KeyLegend chess={isChess} swap={swapAllowed} />

      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </section>
  );
}

/** The next-up strip. It names a person; it never prints a bare index. */
function OnDeck({
  name,
  label,
  timeMs,
  urgent,
}: {
  name: string | null;
  label: string | null;
  timeMs: number | null;
  urgent: boolean;
}): JSX.Element | null {
  const { t } = useLang();
  if (label === null) return null;
  return (
    <p className="core__ondeck t-ctl" data-urgent={urgent ? '' : undefined}>
      <span className="t-cap core__ondecklabel">{t('st.upNext')}</span>
      <Icon name="caret" size={14} className={urgent ? 'm-nudge' : undefined} />
      {name === null ? null : <span className="core__ondeckname">{name}</span>}
      <span className="core__ondeckrole t-meta">{label}</span>
      {timeMs === null ? null : (
        <span className="t-meta" data-numeric="">
          {formatTime(timeMs)}
        </span>
      )}
    </p>
  );
}
