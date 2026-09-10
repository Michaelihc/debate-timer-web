/**
 * `#/stage` — the projector window, in the Unity app's own layout.
 *
 * A near-black screen. The motion across the top. The two teams facing each other as rows
 * of tinted person figures — proposition left, opposition right — the speaking one holding
 * a speech bubble, the next one an arrow that bobs once its predecessor's clock expires, a
 * clipboard on every figure during prep and a group icon during free debate. A large
 * radial countdown ring in the middle with the time in its centre, and a strip of small
 * square timeline pips over a white rail along the bottom.
 *
 * It is a FOLLOWER. `engine/channel.ts` opens the link, `engine/rebase.ts` re-bases every
 * epoch anchor the console sends into this document's own monotonic clock (`startedAtMono`
 * from another document is meaningless, because `performance.timeOrigin` is per-document),
 * and from that rebased anchor this window derives its own 60fps display. It never claims
 * leadership: a two-leader flicker is worse than a frozen wall.
 *
 * Three rules shape every line below:
 *
 *   1. THE THEME DOES NOT APPLY. A projector renders `#000000` as *no light*; anything
 *      above it is a glowing grey rectangle on the wall. The stage is always true black,
 *      and `stage.css` re-pins the projector state ramp on its own root.
 *   2. PERIPHERY / CORE. Identity colour tints the debater figures and their names, and
 *      nothing else. Clock-state colour paints the ring, the digits, the free-debate bars
 *      and the overtime frame, and nothing else.
 *   3. ZERO CHROME. No buttons, no cursor after two seconds, no scrollbars, nothing the
 *      audience has to interpret as interactive, because nobody can click it anyway.
 *
 * Every number is read from `engine/selectors.ts`. Nothing here derives a clock.
 */

import type { CSSProperties, JSX, RefObject } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { Id, Lang, SegmentKind, SideId, Speaker } from '../domain/config';
import { chessClockId, plan as buildPlan } from '../domain/plan';
import type { ClockId, SegmentPlan } from '../engine/state';
import type { Now } from '../engine/chronometer';
import { now } from '../engine/chronometer';
import type { LinkStatus } from '../engine/channel';
import { startFollower } from '../engine/channel';
import { onCue, registerTick } from '../engine/loop';
import type { Band, RoundView } from '../engine/selectors';
import {
  bankRemaining,
  clockView,
  currentPlanSegment,
  roundElapsedMs,
  roundView,
  spokenSpeakerIds,
} from '../engine/selectors';
import { getSession, useRound } from '../engine/store';
import { formatTime } from '../lib/format';
import type { StringKey } from '../i18n/strings';
import type { TFn } from '../i18n/useLang';
import { translate, useLang } from '../i18n/useLang';
import type { DigitsHandle } from '../ui/Digits';
import { Digits } from '../ui/Digits';
import type { DebaterOverlay, DebaterState } from '../ui/unity/Debater';
import { Debater } from '../ui/unity/Debater';
import { RING } from '../ui/unity/ringGeometry';
import { RingTimer } from '../ui/unity/RingTimer';

import '../styles/stage.css';

const SIDES: readonly SideId[] = ['A', 'B'];

/** How long the pointer must sit still before the cursor disappears. */
const CURSOR_IDLE_MS = 2000;

const KIND_KEY: Record<SegmentKind, StringKey> = {
  speech: 'k.speech',
  shared: 'k.shared',
  prep: 'k.prep',
  chess: 'k.free',
  break: 'k.break',
};

/**
 * `AnimationController` shows the clipboard on every figure through prep and the group
 * icon on every figure through free debate, regardless of whose turn it is.
 */
const OVERLAY: Record<SegmentKind, DebaterOverlay> = {
  speech: 'none',
  shared: 'none',
  prep: 'prep',
  chess: 'free',
  break: 'none',
};

const BAND_KEY: Record<Band, StringKey | null> = {
  normal: null,
  warning: 'st.warning',
  final10: 'st.warning',
  over: 'st.over',
};

/** Which slot each clock of the current segment paints into. */
interface Slots {
  primary: ClockId | null;
  secondary: ClockId | null;
}

const NO_SLOTS: Slots = { primary: null, secondary: null };

const BAND_RANK: Record<Band, number> = { normal: 0, warning: 1, final10: 2, over: 3 };

function worse(a: Band, b: Band): Band {
  return BAND_RANK[b] > BAND_RANK[a] ? b : a;
}

function slotsOf(ps: SegmentPlan | null): Slots {
  if (!ps) return NO_SLOTS;
  // Free debate is the only segment with two clocks, and both are always on screen —
  // the floor decides which one RUNS, never which one is shown.
  if (ps.kind === 'chess') {
    return { primary: chessClockId(ps.segId, 'A'), secondary: chessClockId(ps.segId, 'B') };
  }
  return { primary: ps.primaryClockId, secondary: null };
}

/** The ring's three fill colours; the original has one warning tier, not two. */
function ringState(band: Band): 'normal' | 'warn' | 'over' {
  return band === 'over' ? 'over' : band === 'normal' ? 'normal' : 'warn';
}

/* ------------------------------------------------------------------- screen */

export default function Stage(): JSX.Element {
  const { t, lang, l10n } = useLang();
  const session = useRound();
  const { config, plan: runPlan, state } = session;

  const [link, setLink] = useState<LinkStatus>('waiting');
  const [linked, setLinked] = useState(false);
  // Frozen at mount: a window the console opened keeps this true even after the console
  // closes and the browser nulls `opener` — which is the exact moment the room most needs
  // to be told the wall has stopped hearing from anyone. A stage reached by navigating
  // this tab to `#/stage` has no leader to lose and never claims one is missing.
  const [opened] = useState(() => typeof window !== 'undefined' && window.opener !== null);

  const root = useRef<HTMLDivElement>(null);
  const flash = useRef<HTMLSpanElement>(null);
  const ringWrap = useRef<HTMLDivElement>(null);
  const primaryDigits = useRef<DigitsHandle>(null);
  const secondaryDigits = useRef<DigitsHandle>(null);
  const barA = useRef<HTMLSpanElement>(null);
  const barB = useRef<HTMLSpanElement>(null);
  const bankA = useRef<HTMLSpanElement>(null);
  const bankB = useRef<HTMLSpanElement>(null);
  const roundOut = useRef<HTMLSpanElement>(null);
  const live = useRef<HTMLParagraphElement>(null);

  // The link, opened once for the life of the window. `startFollower` re-bases every
  // anchor it receives and folds the frame into the store; this screen only paints it.
  useEffect(() => {
    return startFollower({
      buildPlan: (incoming) => buildPlan(incoming),
      onStatus: setLink,
      onFrame: () => setLinked(true),
    });
  }, []);

  const view = roundView(state, runPlan, now());
  const ps = currentPlanSegment(state, runPlan);
  const slots = slotsOf(ps);
  const secondsOnly = runPlan.display === 'seconds';

  // The rAF loop writes through these refs, so nothing below re-renders from time.
  const slotsRef = useRef<Slots>(slots);
  slotsRef.current = slots;

  useEffect(
    () =>
      registerTick((n) => {
        paintFrame(n, {
          slots: slotsRef.current,
          root: root.current,
          ringWrap: ringWrap.current,
          primaryDigits: primaryDigits.current,
          secondaryDigits: secondaryDigits.current,
          barA: barA.current,
          barB: barB.current,
          bankA: bankA.current,
          bankB: bankB.current,
          roundOut: roundOut.current,
        });
      }),
    [],
  );

  // flash.anim — the one-shot red screen pulse the original plays on a warning cue. The
  // room sees it; the operator's console plays its own.
  useEffect(
    () =>
      onCue(() => {
        const el = flash.current;
        if (!el) return;
        delete el.dataset['fire'];
        void el.offsetWidth;
        el.dataset['fire'] = '';
      }),
    [],
  );

  // Zero cursor. It comes back the moment the pointer moves, so an operator who does walk
  // over to the projector machine is not left poking at an invisible mouse.
  useEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sleep = (): void => {
      el.dataset['cursor'] = 'hidden';
    };
    const wake = (): void => {
      el.dataset['cursor'] = 'shown';
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(sleep, CURSOR_IDLE_MS);
    };
    wake();
    window.addEventListener('pointermove', wake, { passive: true });
    window.addEventListener('pointerdown', wake, { passive: true });
    return () => {
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
    };
  }, []);

  // Spoken boundaries the clock cannot infer. The digits own minutes and the last ten
  // seconds; these two are the round-level events, and they must survive a variant with
  // no digits mounted at all.
  const say = useRef(t);
  say.current = t;
  const prevHold = useRef<boolean | null>(null);
  useEffect(() => {
    const was = prevHold.current;
    prevHold.current = view.hold;
    if (was === null || was === view.hold) return;
    if (live.current) {
      live.current.textContent = say.current(view.hold ? 'a11y.roundHeld' : 'a11y.roundReleased');
    }
  }, [view.hold]);

  const prevFloor = useRef<SideId | null | undefined>(undefined);
  useEffect(() => {
    const was = prevFloor.current;
    prevFloor.current = view.floor;
    if (was === undefined || was === view.floor || view.floor === null) return;
    const side = config.sides.find((s) => s.id === view.floor);
    if (live.current) {
      live.current.textContent = say.current('a11y.floorNow', {
        side: side ? l10n(side.label) : view.floor,
      });
    }
    // `l10n` is stable per language and only the floor is a real dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.floor]);

  const empty = runPlan.segments.length === 0;
  const variant = empty
    ? 'idle'
    : view.phase === 'pre'
      ? 'standby'
      : view.phase === 'complete'
        ? 'complete'
        : (ps?.kind ?? 'idle');

  const following = linked || opened;
  const lost = link === 'lost' && following;
  const showLost = lost && variant !== 'idle';

  // Roster presentation, not engine state: the figure numbers, and which figures have
  // already had every turn the run order gives them.
  const numbers = useMemo(() => sideNumbers(config.speakers), [config.speakers]);
  // The taller roster decides how tall a figure may be, so a six-speaker side shrinks its
  // people rather than running off the bottom of the wall.
  const rows = useMemo(() => rowsVar(config.speakers), [config.speakers]);
  const spoken = useMemo(() => spokenSpeakerIds(state, runPlan), [state, runPlan]);
  const speaking = useMemo(() => speakingIds(ps), [ps]);
  const overlay = ps ? OVERLAY[ps.kind] : 'none';
  const showHours = longRound(runPlan.totalMs);

  return (
    <div
      ref={root}
      className="stage"
      style={rows}
      data-variant={variant}
      data-band={view.band}
      data-hold={view.hold ? '' : undefined}
      data-link={lost ? 'lost' : undefined}
      data-cursor="shown"
      role="region"
      aria-label={t('a11y.stageRegion')}
    >
      <span className="stage__frame" aria-hidden="true" />

      <header className="stage__top">
        <span className="stage__meta" data-numeric="">
          {empty || view.phase !== 'in'
            ? t('app.name')
            : `${t('r.segmentOf', { i: view.cursor + 1, n: view.segmentCount })}${
                ps ? ` · ${t(KIND_KEY[ps.kind])}` : ''
              }`}
          {bandWord(view, t) ? (
            <>
              {' · '}
              <span className="stage__statusword" data-band={view.band}>
                {bandWord(view, t)}
              </span>
            </>
          ) : null}
        </span>
        {/* Topic — the one thing the original prints large at the top of the canvas. */}
        <h2 className="stage__title">{l10n(config.title)}</h2>
        <span className="stage__meta stage__meta--end" data-numeric="">
          {t('r.elapsed')}{' '}
          <span ref={roundOut}>{formatTime(view.roundElapsedMs, { showHours })}</span>
          {' / '}
          {formatTime(runPlan.scheduledMs, { showHours })}
        </span>
      </header>

      <div className="stage__body">
        <Team
          side="A"
          label={l10n(config.sides[0].label)}
          speakers={config.speakers}
          numbers={numbers}
          speaking={speaking}
          spoken={spoken}
          nextId={view.onDeck?.id ?? null}
          urgent={view.onDeckUrgent}
          overlay={overlay}
        />

        <div className="stage__core">
          {variant === 'idle' || variant === 'standby' || variant === 'complete' ? (
            <Card
              k={
                variant === 'complete'
                  ? 'st.complete'
                  : variant === 'standby'
                    ? 'st.preRound'
                    : lost
                      ? 'sg.linkLost'
                      : 'sg.waiting'
              }
              sub={variant === 'idle' ? t('sg.sameBrowser') : null}
            />
          ) : variant === 'chess' && ps ? (
            <Chess
              ps={ps}
              view={view}
              secondsOnly={secondsOnly}
              t={t}
              sideLabels={[l10n(config.sides[0].label), l10n(config.sides[1].label)]}
              out={{ primaryDigits, secondaryDigits, barA, barB, bankA, bankB }}
            />
          ) : ps ? (
            <Single
              ps={ps}
              view={view}
              secondsOnly={secondsOnly}
              label={l10n(ps.label)}
              wrapOut={ringWrap}
              digitsOut={primaryDigits}
            />
          ) : (
            <Card k={lost ? 'sg.linkLost' : 'sg.waiting'} sub={null} />
          )}
        </div>

        <Team
          side="B"
          label={l10n(config.sides[1].label)}
          speakers={config.speakers}
          numbers={numbers}
          speaking={speaking}
          spoken={spoken}
          nextId={view.onDeck?.id ?? null}
          urgent={view.onDeckUrgent}
          overlay={overlay}
        />
      </div>

      <Timeline plan={runPlan} cursor={view.cursor} numbers={numbers} t={t} lang={lang} />

      {view.hold ? <Hold view={view} secondsOnly={secondsOnly} /> : null}

      {showLost ? (
        <p className="stage__lost" role="status">
          <span className="stage__lostpip" aria-hidden="true" />
          {t('sg.linkLost')}
        </p>
      ) : null}


      {/* flash.anim, mounted last so it sits over everything the room is watching. */}
      <span ref={flash} className="u-flash" aria-hidden="true" />

      {/* The boundaries the clock cannot infer, for anyone listening rather than looking. */}
      <p ref={live} className="sr-only" aria-live="polite" aria-atomic="true" />
    </div>
  );
}

/* -------------------------------------------------------------- frame writer */

interface PaintTargets {
  slots: Slots;
  root: HTMLElement | null;
  ringWrap: HTMLElement | null;
  primaryDigits: DigitsHandle | null;
  secondaryDigits: DigitsHandle | null;
  barA: HTMLElement | null;
  barB: HTMLElement | null;
  bankA: HTMLSpanElement | null;
  bankB: HTMLSpanElement | null;
  roundOut: HTMLSpanElement | null;
}

const lastText = new WeakMap<HTMLElement, string>();

function setText(el: HTMLElement | null, text: string): void {
  if (!el || lastText.get(el) === text) return;
  lastText.set(el, text);
  el.textContent = text;
}

interface RingParts {
  ring: HTMLElement | null;
  arc: SVGCircleElement | null;
}

// Resolved once per mounted ring rather than queried sixty times a second. The
// `isConnected` check is what makes a variant change re-resolve instead of writing to a
// detached node.
const ringCache = new WeakMap<HTMLElement, RingParts>();

function ringPartsOf(wrap: HTMLElement | null): RingParts | null {
  if (!wrap) return null;
  const cached = ringCache.get(wrap);
  if (cached && cached.ring?.isConnected === true) return cached;
  const parts: RingParts = {
    ring: wrap.querySelector<HTMLElement>('.uring'),
    arc: wrap.querySelector<SVGCircleElement>('.uring__arc'),
  };
  ringCache.set(wrap, parts);
  return parts;
}

/** The ring empties clockwise from the top: a full ring is a full circle. */
function writeRing(parts: RingParts | null, fill: number, band: Band): void {
  if (!parts) return;
  if (parts.arc) {
    parts.arc.style.strokeDashoffset = String(RING.circumference * (1 - fill));
  }
  const state = ringState(band);
  if (parts.ring && parts.ring.dataset['state'] !== state) parts.ring.dataset['state'] = state;
}

/** Vertical fill, bottom origin — `fillMethod: Vertical, fillOrigin: 0`. */
function writeBar(bar: HTMLElement | null, fill: number, band: Band): void {
  if (!bar) return;
  if (bar.dataset['band'] !== band) bar.dataset['band'] = band;
  const el = bar.firstElementChild;
  if (el instanceof HTMLElement) el.style.transform = `scaleY(${fill})`;
}

/**
 * One pass per animation frame. It reads the session directly rather than closing over a
 * render's values, so a stale closure can never freeze the wall display.
 */
function paintFrame(n: Now, target: PaintTargets): void {
  const { state, plan: runPlan } = getSession();
  const secondsOnly = runPlan.display === 'seconds';
  let band: Band = 'normal';

  const primaryId = target.slots.primary;
  if (primaryId) {
    const v = clockView(state, runPlan, primaryId, n);
    if (v) {
      band = worse(band, v.band);
      target.primaryDigits?.write(v.remainingMs, { band: v.band, secondsOnly });
      writeRing(ringPartsOf(target.ringWrap), v.fill, v.band);
      writeBar(target.barA, v.fill, v.band);
    }
  }

  const secondaryId = target.slots.secondary;
  if (secondaryId) {
    const v = clockView(state, runPlan, secondaryId, n);
    if (v) {
      band = worse(band, v.band);
      target.secondaryDigits?.write(v.remainingMs, { band: v.band, secondsOnly });
      writeBar(target.barB, v.fill, v.band);
    }
  }

  if (target.root && target.root.dataset['band'] !== band) target.root.dataset['band'] = band;

  const showHours = longRound(runPlan.totalMs);
  setText(target.roundOut, formatTime(roundElapsedMs(state, n), { showHours }));

  if (target.bankA) setText(target.bankA, formatTime(bankRemaining(state, runPlan, 'A', n)));
  if (target.bankB) setText(target.bankB, formatTime(bankRemaining(state, runPlan, 'B', n)));
}

/* ---------------------------------------------------------------- variants */

/** Speech, shared clock, prep, break — one clock, one ring, the time in its centre. */
function Single({
  ps,
  view,
  secondsOnly,
  label,
  wrapOut,
  digitsOut,
}: {
  ps: SegmentPlan;
  view: RoundView;
  secondsOnly: boolean;
  label: string;
  wrapOut: RefObject<HTMLDivElement | null>;
  digitsOut: RefObject<DigitsHandle | null>;
}): JSX.Element {
  const clock = view.primary;
  const allotted = clock?.allottedMs ?? ps.allottedMs;
  return (
    <>
      <p className="stage__label">{label}</p>
      <div ref={wrapOut} className="stage__ringwrap">
        <RingTimer
          variant="stage"
          fraction={clock?.fill ?? 1}
          state={ringState(clock?.band ?? 'normal')}
        >
          <Digits
            key={ps.primaryClockId}
            ref={digitsOut}
            scale="stage"
            secondsOnly={secondsOnly}
            initialMs={clock?.remainingMs ?? allotted}
            initialBand={clock?.band ?? 'normal'}
            name={ps.speaker?.name ?? label}
          />
        </RingTimer>
      </div>
    </>
  );
}

interface ChessOutputs {
  primaryDigits: RefObject<DigitsHandle | null>;
  secondaryDigits: RefObject<DigitsHandle | null>;
  barA: RefObject<HTMLSpanElement | null>;
  barB: RefObject<HTMLSpanElement | null>;
  bankA: RefObject<HTMLSpanElement | null>;
  bankB: RefObject<HTMLSpanElement | null>;
}

/**
 * Free debate: the original's two vertical bars, each filling from the bottom, with its
 * side's time below it. The idle side stays legible but visibly stands down. No SWAP
 * control here — the stage carries no controls at all.
 */
function Chess({
  ps,
  view,
  secondsOnly,
  sideLabels,
  t,
  out,
}: {
  ps: SegmentPlan;
  view: RoundView;
  secondsOnly: boolean;
  sideLabels: [string, string];
  t: TFn;
  out: ChessOutputs;
}): JSX.Element {
  const perSide = ps.segment.kind === 'chess' ? ps.segment.perSideMs : ps.allottedMs;
  return (
    <>
      <p className="stage__label">
        <Bi k="k.free" />
      </p>
      <div className="stage__chess">
        {SIDES.map((side, i) => {
          const clockId = chessClockId(ps.segId, side);
          const clock = view.clocks.find((c) => c.clockId === clockId) ?? null;
          const name = sideLabels[i] ?? side;
          return (
            <section
              key={side}
              className="stage__chesside"
              data-side={side}
              data-live={view.floor === side ? '' : undefined}
            >
              <span
                ref={side === 'A' ? out.barA : out.barB}
                className="stage__vbar"
                data-band={clock?.band ?? 'normal'}
                aria-hidden="true"
              >
                <span className="stage__vfill" />
              </span>
              <Digits
                key={clockId}
                ref={side === 'A' ? out.primaryDigits : out.secondaryDigits}
                scale="chess"
                secondsOnly={secondsOnly}
                initialMs={clock?.remainingMs ?? perSide}
                initialBand={clock?.band ?? 'normal'}
                name={name}
                label={`${name} · ${t('a11y.timerRegion')}`}
                announce={side === 'A'}
              />
              <p className="stage__sidename">{name}</p>
              <p className="stage__bank" data-numeric="">
                {t('st.prepBank')}{' '}
                <span ref={side === 'A' ? out.bankA : out.bankB}>
                  {formatTime(view.bank[side])}
                </span>
              </p>
            </section>
          );
        })}
      </div>
    </>
  );
}

/** Pre-round, end of round, waiting for a console, or a link that has gone quiet. */
function Card({ k, sub }: { k: StringKey; sub: string | null }): JSX.Element {
  return (
    <div className="stage__card">
      <p className="stage__cardline">
        <Bi k={k} />
      </p>
      {sub === null ? null : <p className="stage__cardsub">{sub}</p>}
    </div>
  );
}

/**
 * The round is on HOLD. A full-stage slab, the word, and the frozen clock beneath it, so a
 * room that looks up mid-pause is told the pause is deliberate.
 */
function Hold({ view, secondsOnly }: { view: RoundView; secondsOnly: boolean }): JSX.Element {
  const frozen = view.primary?.remainingMs ?? view.clocks[0]?.remainingMs ?? 0;
  return (
    <div className="stage__hold" role="status">
      <p className="stage__holdword">
        <Bi k="st.held" />
      </p>
      <p className="stage__holdclock" data-numeric="">
        {formatTime(frozen, { secondsOnly })}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------- pieces */

/** One side's roster, as the figures the original draws facing the other team. */
function Team({
  side,
  label,
  speakers,
  numbers,
  speaking,
  spoken,
  nextId,
  urgent,
  overlay,
}: {
  side: SideId;
  label: string;
  speakers: readonly Speaker[];
  numbers: ReadonlyMap<Id, number>;
  speaking: ReadonlySet<Id>;
  spoken: ReadonlySet<Id>;
  nextId: Id | null;
  urgent: boolean;
  overlay: DebaterOverlay;
}): JSX.Element {
  const mine = speakers.filter((s) => s.side === side);
  return (
    <div className="stage__team" data-side={side}>
      <p className="stage__teamhead">{label}</p>
      <div className="stage__figures">
        {mine.map((sp, i) => {
          const state: DebaterState = speaking.has(sp.id)
            ? 'speaking'
            : sp.id === nextId
              ? 'next'
              : spoken.has(sp.id)
                ? 'done'
                : 'idle';
          return (
            <Debater
              key={sp.id}
              side={side}
              index={numbers.get(sp.id) ?? i + 1}
              name={sp.name}
              state={state}
              overlay={overlay}
              urgent={state === 'next' && urgent}
              size="stage"
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * The timeline: one square pip per event in the run order, each with a tick down to the
 * white rail, the current one green. The order is the operator's — this walks
 * `plan.segments` verbatim and neither sorts, dedupes nor completes it.
 */
function Timeline({
  plan,
  cursor,
  numbers,
  t,
  lang,
}: {
  plan: { segments: readonly SegmentPlan[] };
  cursor: number;
  numbers: ReadonlyMap<Id, number>;
  t: TFn;
  lang: Lang;
}): JSX.Element | null {
  if (plan.segments.length === 0) return null;
  return (
    <div className="stage__timeline">
      <ol className="stage__pips" aria-hidden="true">
        {plan.segments.map((ps, i) => (
          <li
            key={ps.segId}
            className="stage__pip"
            lang={lang}
            data-state={i === cursor ? 'current' : i < cursor ? 'done' : 'idle'}
          >
            {pipLabel(ps, numbers, t)}
          </li>
        ))}
      </ol>
      <span className="stage__rail" aria-hidden="true" />
    </div>
  );
}

/**
 * The stage's display words carry both languages at once. A venue running a Chinese round
 * with English-speaking judges (or the reverse) is the normal case, not the exception, and
 * the wall is the one surface that cannot be toggled by whoever is reading it.
 */
function Bi({ k }: { k: StringKey }): JSX.Element {
  const { lang } = useLang();
  const other: Lang = lang === 'en' ? 'zh' : 'en';
  return (
    <>
      <span lang={lang}>{translate(lang, k)}</span>
      <span className="stage__alt" lang={other}>
        {translate(other, k)}
      </span>
    </>
  );
}

/* -------------------------------------------------------------------- utils */

/** `--rows` — how many figures the taller side has to stack. Never zero. */
function rowsVar(speakers: readonly Speaker[]): CSSProperties {
  let a = 0;
  let b = 0;
  for (const sp of speakers) {
    if (sp.side === 'A') a += 1;
    else b += 1;
  }
  return { '--rows': String(Math.max(1, a, b)) } as CSSProperties;
}

/** The figure numbers: each side counts from 1, in roster order. */
function sideNumbers(speakers: readonly Speaker[]): Map<Id, number> {
  const seen: Record<SideId, number> = { A: 0, B: 0 };
  const out = new Map<Id, number>();
  for (const sp of speakers) {
    seen[sp.side] += 1;
    out.set(sp.id, seen[sp.side]);
  }
  return out;
}

/** Who is holding the floor: the speech's speaker, or a shared clock's participants. */
function speakingIds(ps: SegmentPlan | null): Set<Id> {
  const out = new Set<Id>();
  if (!ps) return out;
  if (ps.speaker) out.add(ps.speaker.id);
  else if (ps.kind === 'shared') for (const p of ps.participants) out.add(p.id);
  return out;
}

/**
 * `P` for prep, `F` for free debate, else the speaker's number — the original's own
 * timeline-button label, taken from the translated phase word so it reads 备 / 自 in
 * Chinese without a second string table.
 */
function pipLabel(ps: SegmentPlan, numbers: ReadonlyMap<Id, number>, t: TFn): string {
  if (ps.kind === 'speech' && ps.speaker) return String(numbers.get(ps.speaker.id) ?? ps.index + 1);
  if (ps.kind === 'speech') return String(ps.index + 1);
  return Array.from(t(KIND_KEY[ps.kind]))[0] ?? String(ps.index + 1);
}

/**
 * The word beside the colour. HOLD and the cue bands outrank the transport, and `armed`
 * prints nothing at all: it is a fact about the operator's keyboard, not about the round.
 */
function bandWord(view: RoundView, t: TFn): string {
  if (view.hold) return t('st.held');
  const key = BAND_KEY[view.band];
  if (key) return t(key);
  if (view.phase !== 'in') return '';
  if (view.transport === 'running') return t('st.running');
  if (view.transport === 'paused') return t('st.paused');
  return '';
}

/** Only a round total may roll over to H:MM:SS, and only above an hour. */
function longRound(totalMs: number): boolean {
  return totalMs >= 3_600_000;
}
