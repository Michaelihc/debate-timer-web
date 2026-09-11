/**
 * `#/console` — the operator's instrument, in the original's layout.
 *
 * The Unity app is one picture: the motion across the top, the two teams facing each other
 * as columns of person-shaped figures, a radial countdown ring between them, and a strip of
 * small square events along the bottom. This screen is that picture. Under the ring sit the
 * timer controls and nothing else; moving between segments lives on the strip.
 *
 * Three rules it exists to keep honest:
 *
 *   PERIPHERY / CORE. Identity colour is confined to the figures, the team names and the
 *   floor bars; clock-state colour is confined to the ring, the digits and the free-debate
 *   fills. Asking "is that yellow the Con team or the 30-second warning?" is structurally
 *   impossible here.
 *
 *   THE RUN ORDER IS THE OPERATOR'S. Speaker 3 before speaker 2, speaker 2 twice, speaker
 *   1 never — all of it is data, drawn exactly as arranged. Nothing on this screen warns,
 *   badges, reorders, dedupes or "suggests fixing" a run order.
 *
 *   AN ENABLED CONTROL DOES WHAT IT SAYS. Whether a command would change the round is asked
 *   of the reducer itself, not re-derived here; a control that could not act is disabled,
 *   and one that cannot act at all in this state (SWAP, a side's give-floor) is hidden.
 *
 * Every clock number on screen comes from `engine/selectors`; nothing here recomputes one.
 */

import type { JSX } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { armAudioNow, useAudio } from '../app/boot';
import { useHotkeys } from '../app/hotkeys';
import { ROUTES, navigate } from '../app/router';
import type { Id, SideId, SpeakerCfg } from '../domain/config';
import { chessClockId } from '../domain/plan';
import { elapsedMs, now } from '../engine/chronometer';
import { onCue, registerTick } from '../engine/loop';
import { reduce } from '../engine/reducer';
import { canSwap, clockView, primaryClockId, roundView } from '../engine/selectors';
import { toggleMuted } from '../engine/sound';
import type { Command } from '../engine/state';
import { dispatch, getSession, useRound } from '../engine/store';
import { useLang } from '../i18n/useLang';
import { formatTime } from '../lib/format';
import type { DebaterOverlay } from '../ui/unity/Debater';
import { RingTimer } from '../ui/unity/RingTimer';
import '../ui/unity/unity.css';

import type { ChessSideView } from '../console/ChessBars';
import { ChessBars } from '../console/ChessBars';
import { RingCore } from '../console/RingCore';
import type { FloorLevel } from '../console/Teams';
import { TeamColumn } from '../console/Teams';
import type { TimelineHandle } from '../console/Timeline';
import { Timeline } from '../console/Timeline';
import { pipsFromPlan, rosterOrdinals } from '../console/timelineData';
import { TopBar } from '../console/TopBar';
import { Transport } from '../console/Transport';
import '../console/console.css';

const STEP_15 = 15_000;
const STEP_60 = 60_000;
const STEP_5 = 5_000;

type CoreMode = 'pre' | 'complete' | 'chess' | 'speech' | 'shared';

/**
 * True once the clock the transport acts on has run out — `AnimationController`'s
 * `RemainingTime < 0.1` test. Read every frame rather than off the last render, so the
 * on-deck figure steps up and its arrow starts to bob at the instant of expiry, even in a
 * format whose cue ladder has no bell at zero to force a render.
 */
function useExpired(): boolean {
  const [expired, setExpired] = useState(false);
  const last = useRef(false);
  useEffect(
    () =>
      registerTick((n) => {
        const s = getSession();
        const id = primaryClockId(s.state, s.plan);
        const v = id === null ? null : clockView(s.state, s.plan, id, n);
        const next = v !== null && v.remainingMs <= 0;
        if (next !== last.current) {
          last.current = next;
          setExpired(next);
        }
      }),
    [],
  );
  return expired;
}

export default function Console(): JSX.Element {
  const { t, l10n, lang, toggleLang } = useLang();
  const session = useRound();
  const audio = useAudio();
  const { state, plan, config } = session;

  const timelineRef = useRef<TimelineHandle>(null);
  const flashRef = useRef<HTMLSpanElement>(null);
  const [selected, setSelected] = useState(0);
  const expired = useExpired();

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

  /** Each speaker's number within their own side — what the figure and the pip print. */
  const ordinals = useMemo(() => rosterOrdinals(config.speakers), [config.speakers]);

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

  const pips = useMemo(() => pipsFromPlan(plan, lang, t), [plan, lang, t]);

  const mode: CoreMode =
    view.phase === 'pre'
      ? 'pre'
      : view.phase === 'complete' || ps === null
        ? 'complete'
        : ps.kind === 'chess'
          ? 'chess'
          : ps.kind === 'speech'
            ? 'speech'
            : 'shared';

  /**
   * The phase overlay EVERY figure carries at once, exactly as `AnimationController` does
   * it: clipboards during prep, the group icon during free debate.
   */
  const overlay: DebaterOverlay = ps?.kind === 'prep' ? 'prep' : isChess ? 'free' : 'none';

  /** Which commands would change the round right now, asked of the reducer itself. */
  const can = useMemo(() => {
    const ctx = { plan, now: now() };
    const would = (cmd: Command): boolean => reduce(state, cmd, ctx) !== state;
    const floor: Record<SideId, boolean> = {
      A: would({ t: 'GIVE_FLOOR', side: 'A' }),
      B: would({ t: 'GIVE_FLOOR', side: 'B' }),
    };
    return {
      prev: would({ t: 'PREV' }),
      advance: would({ t: 'ADVANCE' }),
      adjust: would({ t: 'ADJUST', deltaMs: STEP_15 }),
      floor,
    };
  }, [state, plan]);

  /* -------------------------------------------------------------------- effects */

  // flash.anim — the original's one-shot screen pulse on a warning cue. Re-firing restarts
  // the animation, which is what the forced reflow between the two writes buys.
  useEffect(
    () =>
      onCue((event) => {
        // A grace bell sits at a negative threshold and is not a warning.
        if (event.cue.atMs < 0) return;
        const el = flashRef.current;
        if (!el) return;
        delete el.dataset['fire'];
        void el.offsetWidth;
        el.dataset['fire'] = '';
      }),
    [],
  );

  useEffect(() => {
    setSelected(Math.max(0, Math.min(state.cursor, plan.segments.length - 1)));
  }, [state.cursor, plan.segments.length]);

  // The current square fills to ACTUAL consumption, sixty times a second, without a render.
  useEffect(() => {
    return registerTick((n) => {
      const s = getSession();
      const i = s.state.cursor;
      const current = i >= 0 ? s.plan.segments[i] : undefined;
      if (!current) return;
      let used = 0;
      for (const id of current.clockIds) used += elapsedMs(s.state, id, n);
      timelineRef.current?.write(i, used);
    });
  }, []);

  /* ------------------------------------------------------------------- commands */

  const loadAt = (index: number): void => {
    dispatch({ t: 'LOAD', cursor: index });
  };

  const adjust = (deltaMs: number): void => {
    dispatch({ t: 'ADJUST', deltaMs });
  };

  const toggleHold = (): void => {
    dispatch(view.hold ? { t: 'RELEASE' } : { t: 'HOLD' });
  };

  /** One click, like the original's Reset: the segment is back at full time, stopped. */
  const resetSegment = (): void => {
    dispatch({ t: 'RESET_SEGMENT' });
  };

  const go = (): void => {
    if (view.hold) {
      dispatch({ t: 'RELEASE' });
      return;
    }
    if (view.phase === 'in' && view.transport === 'running') {
      dispatch({ t: 'ADVANCE' });
      return;
    }
    dispatch({ t: 'TOGGLE' });
  };

  useHotkeys('console', {
    toggle: () => dispatch({ t: 'TOGGLE' }),
    togglePause: () => dispatch({ t: 'TOGGLE', pauseInChess: true }),
    advance: () => dispatch({ t: 'ADVANCE' }),
    advanceStart: () => dispatch({ t: 'ADVANCE', start: true }),
    prev: () => dispatch({ t: 'PREV' }),
    go,
    goBack: () => dispatch({ t: 'PREV' }),
    hold: toggleHold,
    reset: resetSegment,
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
    loadCursored: () => loadAt(selected),
    editor: () => navigate(ROUTES.edit),
  });

  /* ----------------------------------------------------------------------- teams */

  const floorLevels = useMemo<Record<SideId, FloorLevel>>(() => {
    const off: Record<SideId, FloorLevel> = { A: 'off', B: 'off' };
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
  }, [ps, view.floor, view.transport]);

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

  /** Whose clock this is — announced with the time to assistive tech, never printed. */
  const clockOwner =
    mode === 'speech'
      ? (ps?.speaker?.name ?? '')
      : mode === 'shared' && ps
        ? ps.participants.map((sp) => sp.name).join(' · ')
        : '';

  // The next segment by its own label and length. Who gives it is on the figures already:
  // their arrow says so.
  const upNext =
    nextPs === null ? null : (
      <p className="ucore__next" data-urgent={expired ? '' : undefined}>
        <span className="ucore__nextlabel">{t('st.upNext')}</span>
        <span className="ucore__nextrole">{l10n(nextPs.label)}</span>
        <span data-numeric="">{formatTime(nextPs.allottedMs)}</span>
      </p>
    );

  let core: JSX.Element;
  if (mode === 'chess' && ps && chessSides) {
    core = (
      <ChessBars
        label={l10n(ps.label)}
        status={statusWord}
        sides={chessSides}
        floor={view.floor}
        awaitingFloor={view.awaitingFloor}
        operatorChooses={firstFloor === 'operator'}
        firstFloorLabel={firstFloor === 'operator' ? '' : sideLabels[firstFloor]}
        swap={swapAllowed}
        onSwap={() => dispatch({ t: 'SWAP' })}
        canGiveFloor={can.floor}
        onGiveFloor={(side) => dispatch({ t: 'GIVE_FLOOR', side })}
        secondsOnly={secondsOnly}
      />
    );
  } else if ((mode === 'speech' || mode === 'shared') && ps) {
    core = (
      <RingCore
        clockId={ps.primaryClockId}
        allottedMs={primary?.allottedMs ?? ps.allottedMs}
        remainingMs={primary?.remainingMs ?? ps.allottedMs}
        band={primary?.band ?? 'normal'}
        fill={primary?.fill ?? 1}
        transport={primary?.transport ?? 'armed'}
        label={l10n(ps.label)}
        status={statusWord}
        name={clockOwner}
        secondsOnly={secondsOnly}
        armed={armed}
      >
        {upNext}
      </RingCore>
    );
  } else {
    // Pre-round and end-of-round: the ring still holds the screen, showing the round's
    // scheduled length rather than going blank.
    const pre = mode === 'pre';
    core = (
      <div className="ucore ucore--idle">
        <div className="ucore__ring">
          <RingTimer fraction={pre ? 1 : 0} state="normal" label={t('a11y.timerRegion')}>
            <span className="ucore__static" data-numeric="">
              {formatTime(plan.totalMs)}
            </span>
          </RingTimer>
        </div>
        <div className="ucore__caption">
          <p className="ucore__label">
            <span>{pre ? t('st.preRound') : t('st.complete')}</span>
          </p>
          {pre ? (
            upNext
          ) : (
            <button
              type="button"
              className="ubtn ubtn--lime"
              onClick={() => navigate(ROUTES.summary)}
            >
              {t('nav.summary')}
            </button>
          )}
        </div>
      </div>
    );
  }

  /* --------------------------------------------------------------------- render */

  return (
    <section className="uconsole" data-mode={mode} aria-label={t('a11y.consoleRegion')}>
      <span
        ref={flashRef}
        className="u-flash"
        aria-hidden="true"
        onAnimationEnd={(e) => {
          delete e.currentTarget.dataset['fire'];
        }}
      />

      <TopBar
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
        onEditor={() => navigate(ROUTES.edit)}
        onHome={() => navigate(ROUTES.launch)}
      />

      <div className="uconsole__main">
        <TeamColumn
          side="A"
          label={sideLabels.A}
          speakers={rosters.A}
          ordinals={ordinals}
          speakingId={view.currentSpeaker?.side === 'A' ? speakingId : null}
          onDeckId={view.onDeck?.side === 'A' ? onDeckId : null}
          spokenIds={spokenIds}
          overlay={overlay}
          urgent={expired}
          floor={floorLevels.A}
          lit={ps === null ? false : ps.liveSides.includes('A')}
        />

        <div className="uconsole__centre">
          {core}

          <Transport
            phase={view.phase}
            transport={view.transport}
            hold={view.hold}
            chess={isChess}
            spaceHandsOff={swapAllowed}
            canStart={canStart}
            canAdjust={can.adjust}
            canReset={view.phase === 'in' && !view.hold}
            on={{
              toggle: () => dispatch({ t: 'TOGGLE' }),
              togglePause: () => dispatch({ t: 'TOGGLE', pauseInChess: true }),
              reset: resetSegment,
              hold: toggleHold,
              adjust,
            }}
          />
        </div>

        <TeamColumn
          side="B"
          label={sideLabels.B}
          speakers={rosters.B}
          ordinals={ordinals}
          speakingId={view.currentSpeaker?.side === 'B' ? speakingId : null}
          onDeckId={view.onDeck?.side === 'B' ? onDeckId : null}
          spokenIds={spokenIds}
          overlay={overlay}
          urgent={expired}
          floor={floorLevels.B}
          lit={ps === null ? false : ps.liveSides.includes('B')}
        />
      </div>

      <Timeline
        ref={timelineRef}
        pips={pips}
        cursor={state.cursor}
        selected={selected}
        onSelect={setSelected}
        onLoad={loadAt}
        onPrev={() => dispatch({ t: 'PREV' })}
        prevDisabled={!can.prev}
        onNext={() => dispatch({ t: 'ADVANCE' })}
        nextDisabled={!can.advance}
      />

      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </section>
  );
}
