/**
 * `#/stage` — the projector window. Read by a room, from fifteen metres, by people who
 * are not operating anything.
 *
 * It is a FOLLOWER. `engine/channel.ts` opens the link, `engine/rebase.ts` re-bases every
 * epoch anchor the console sends into this document's own monotonic clock (§5.3 — a
 * `startedAtMono` from another document is meaningless, because `performance.timeOrigin`
 * is per-document), and from that rebased anchor this window derives its own 60fps
 * display. It never claims leadership: a two-leader flicker is worse than a frozen wall.
 *
 * Three rules shape every line below:
 *
 *   1. THE THEME DOES NOT APPLY. A projector renders `#000000` as *no light*; anything
 *      above it is a glowing grey rectangle on the wall. The stage is always true black.
 *   2. PERIPHERY / CORE. Identity colour touches the edge bars, the rails and the
 *      nameplate slabs, and nothing else. Clock-state colour touches the digits, the
 *      depletion bar and the overtime frame, and nothing else.
 *   3. ZERO CHROME. No buttons, no cursor after two seconds, no scrollbars, nothing the
 *      audience has to interpret as interactive, because nobody can click it anyway.
 *
 * Every number is read from `engine/selectors.ts`. Nothing here derives a clock.
 */

import type { JSX, RefObject } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { L10n, Lang, SegmentKind, SideId, Speaker } from '../domain/config';
import { plan as buildPlan } from '../domain/plan';
import type { ClockId } from '../engine/state';
import type { Now } from '../engine/chronometer';
import { elapsedMs, now } from '../engine/chronometer';
import type { LinkStatus } from '../engine/channel';
import { startFollower } from '../engine/channel';
import { registerTick } from '../engine/loop';
import type { Band, RoundView } from '../engine/selectors';
import {
  bankRemaining,
  clockView,
  currentPlanSegment,
  roundElapsedMs,
  roundView,
} from '../engine/selectors';
import { getSession, useRound } from '../engine/store';
import type { SegmentPlan } from '../engine/state';
import { chessClockId } from '../domain/plan';
import { formatTime } from '../lib/format';
import type { StringKey } from '../i18n/strings';
import type { TFn } from '../i18n/useLang';
import { translate, useLang } from '../i18n/useLang';
import type { DepletionBarHandle, ProtectedWindow } from '../ui/DepletionBar';
import { DepletionBar } from '../ui/DepletionBar';
import type { DigitsHandle } from '../ui/Digits';
import { Digits } from '../ui/Digits';
import type { RibbonHandle } from '../ui/Ribbon';
import { Ribbon } from '../ui/Ribbon';
import { ribbonFromPlan } from '../ui/ribbonData';

import '../styles/stage.css';

const SIDES: readonly SideId[] = ['A', 'B'];

/** How long the pointer must sit still before the cursor disappears (§3.5). */
const CURSOR_IDLE_MS = 2000;

const KIND_KEY: Record<SegmentKind, StringKey> = {
  speech: 'k.speech',
  shared: 'k.shared',
  prep: 'k.prep',
  chess: 'k.free',
  break: 'k.break',
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

/**
 * Protected time is symmetric around a speech: the opening window and the closing window,
 * both expressed in ms REMAINING, which is the axis the cue ladder already uses.
 */
function protectedWindows(allottedMs: number, protectedMs: number): ProtectedWindow[] {
  if (protectedMs <= 0 || allottedMs <= 0) return [];
  const span = Math.min(protectedMs, allottedMs / 2);
  return [
    { fromMs: allottedMs, toMs: allottedMs - span },
    { fromMs: span, toMs: 0 },
  ];
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
  const primaryDigits = useRef<DigitsHandle>(null);
  const secondaryDigits = useRef<DigitsHandle>(null);
  const primaryBar = useRef<DepletionBarHandle>(null);
  const secondaryBar = useRef<DepletionBarHandle>(null);
  const bankA = useRef<HTMLSpanElement>(null);
  const bankB = useRef<HTMLSpanElement>(null);
  const roundOut = useRef<HTMLSpanElement>(null);
  const ribbon = useRef<RibbonHandle>(null);

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
  const cursorRef = useRef(state.cursor);
  cursorRef.current = state.cursor;

  useEffect(
    () =>
      registerTick((n) => {
        paintFrame(n, {
          slots: slotsRef.current,
          cursor: cursorRef.current,
          root: root.current,
          primaryDigits: primaryDigits.current,
          secondaryDigits: secondaryDigits.current,
          primaryBar: primaryBar.current,
          secondaryBar: secondaryBar.current,
          bankA: bankA.current,
          bankB: bankB.current,
          roundOut: roundOut.current,
          ribbon: ribbon.current,
        });
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
  // seconds; these two are the round-level events.
  const say = useRef(t);
  say.current = t;
  const prevHold = useRef<boolean | null>(null);
  useEffect(() => {
    const was = prevHold.current;
    prevHold.current = view.hold;
    if (was === null || was === view.hold) return;
    primaryDigits.current?.say(say.current(view.hold ? 'a11y.roundHeld' : 'a11y.roundReleased'));
  }, [view.hold]);

  const prevFloor = useRef<SideId | null | undefined>(undefined);
  useEffect(() => {
    const was = prevFloor.current;
    prevFloor.current = view.floor;
    if (was === undefined || was === view.floor || view.floor === null) return;
    const side = config.sides.find((s) => s.id === view.floor);
    primaryDigits.current?.say(
      say.current('a11y.floorNow', { side: side ? l10n(side.label) : view.floor }),
    );
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
  const showLost = link === 'lost' && following && variant !== 'idle';

  return (
    <div
      ref={root}
      className="stage"
      data-variant={variant}
      data-band={view.band}
      data-hold={view.hold ? '' : undefined}
      data-cursor="shown"
      role="region"
      aria-label={t('a11y.stageRegion')}
    >
      <span className="stage__edge" data-side="A" data-lit={lit(view, ps, 'A') ? '' : undefined} />
      <span className="stage__edge" data-side="B" data-lit={lit(view, ps, 'B') ? '' : undefined} />
      <span className="stage__frame" aria-hidden="true" />

      <header className="stage__top">
        <span className="stage__topleft s-rail-meta">
          {empty || view.phase !== 'in'
            ? t('app.name')
            : `${t('r.segmentOf', { i: view.cursor + 1, n: view.segmentCount })}${
                ps ? ` · ${t(KIND_KEY[ps.kind])}` : ''
              }`}
        </span>
        <span className="stage__motion s-context">{l10n(config.title)}</span>
        <span className="stage__round s-rail-meta" data-numeric="">
          {t('r.elapsed')}{' '}
          <span ref={roundOut}>{formatTime(view.roundElapsedMs, { showHours: longRound(runPlan.totalMs) })}</span>
          {' / '}
          {formatTime(runPlan.scheduledMs, { showHours: longRound(runPlan.totalMs) })}
        </span>
      </header>

      <span className="stage__rule" aria-hidden="true" />

      <div className="stage__body">
        <Rail
          side="A"
          speakers={config.speakers}
          label={l10n(config.sides[0].label)}
          currentId={ps?.speaker?.id ?? null}
          nextId={view.onDeck?.id ?? null}
          l10n={l10n}
        />

        <div className="stage__core">
          {variant === 'idle' ? (
            <Idle t={t} lost={link === 'lost' && (linked || opened)} />
          ) : variant === 'standby' ? (
            <Standby />
          ) : variant === 'complete' ? (
            <Complete view={view} totalMs={runPlan.scheduledMs} />
          ) : variant === 'chess' && ps ? (
            <Chess
              ps={ps}
              view={view}
              secondsOnly={secondsOnly}
              sideLabels={[l10n(config.sides[0].label), l10n(config.sides[1].label)]}
              out={{
                primaryDigits,
                secondaryDigits,
                primaryBar,
                secondaryBar,
                bankA,
                bankB,
              }}
            />
          ) : ps ? (
            <Single
              ps={ps}
              view={view}
              secondsOnly={secondsOnly}
              l10n={l10n}
              t={t}
              sideLabel={(id) => l10n((id === 'A' ? config.sides[0] : config.sides[1]).label)}
              digitsOut={primaryDigits}
              barOut={primaryBar}
            />
          ) : (
            <Idle t={t} lost={link === 'lost' && (linked || opened)} />
          )}

          {view.onDeck && view.phase === 'in' ? (
            <p className="stage__next s-next" data-urgent={view.onDeckUrgent ? '' : undefined}>
              <span className="stage__caret m-nudge" aria-hidden="true" />
              <span className="stage__nextlabel s-role">{t('st.upNext')}</span>
              <span className="stage__nextname">{view.onDeck.name}</span>
              <span className="stage__nextrole">
                {l10n((view.onDeck.side === 'A' ? config.sides[0] : config.sides[1]).label)}
                {view.onDeck.role ? ` · ${l10n(view.onDeck.role)}` : ''}
              </span>
            </p>
          ) : null}
        </div>

        <Rail
          side="B"
          speakers={config.speakers}
          label={l10n(config.sides[1].label)}
          currentId={ps?.speaker?.id ?? null}
          nextId={view.onDeck?.id ?? null}
          l10n={l10n}
        />
      </div>

      {empty ? null : (
        <footer className="stage__ribbon">
          <Ribbon
            ref={ribbon}
            scale="live"
            segments={ribbonFromPlan(runPlan, state, lang)}
            cursor={view.cursor}
            colors={{ A: config.sides[0].color, B: config.sides[1].color }}
          />
        </footer>
      )}

      {view.hold ? <Hold view={view} secondsOnly={secondsOnly} /> : null}

      {showLost ? (
        <p className="stage__lost s-rail-meta" role="status">
          <span className="stage__lostpip" aria-hidden="true" />
          {t('sg.linkLost')}
        </p>
      ) : null}

      {/* Colour is never the only channel: the state always carries a word. Never an
          operator's word, though — nobody in the room can press Space. */}
      <p className="stage__band s-rail-meta">{bandWord(view, t)}</p>
    </div>
  );
}

/* -------------------------------------------------------------- frame writer */

interface PaintTargets {
  slots: Slots;
  cursor: number;
  root: HTMLElement | null;
  primaryDigits: DigitsHandle | null;
  secondaryDigits: DigitsHandle | null;
  primaryBar: DepletionBarHandle | null;
  secondaryBar: DepletionBarHandle | null;
  bankA: HTMLSpanElement | null;
  bankB: HTMLSpanElement | null;
  roundOut: HTMLSpanElement | null;
  ribbon: RibbonHandle | null;
}

const lastText = new WeakMap<HTMLElement, string>();

function setText(el: HTMLElement | null, text: string): void {
  if (!el || lastText.get(el) === text) return;
  lastText.set(el, text);
  el.textContent = text;
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
      target.primaryBar?.write(v.remainingMs, v.band);
    }
  }

  const secondaryId = target.slots.secondary;
  if (secondaryId) {
    const v = clockView(state, runPlan, secondaryId, n);
    if (v) {
      band = worse(band, v.band);
      target.secondaryDigits?.write(v.remainingMs, { band: v.band, secondsOnly });
      target.secondaryBar?.write(v.remainingMs, v.band);
    }
  }

  if (target.root && target.root.dataset['band'] !== band) target.root.dataset['band'] = band;

  const showHours = longRound(runPlan.totalMs);
  setText(target.roundOut, formatTime(roundElapsedMs(state, n), { showHours }));

  if (target.bankA) setText(target.bankA, formatTime(bankRemaining(state, runPlan, 'A', n)));
  if (target.bankB) setText(target.bankB, formatTime(bankRemaining(state, runPlan, 'B', n)));

  // The live Ribbon block fills to what is ACTUALLY being consumed, this second.
  const current = runPlan.segments[target.cursor];
  if (current && target.ribbon) {
    let used = 0;
    for (const id of current.clockIds) used += elapsedMs(state, id, n);
    target.ribbon.write(target.cursor, used);
  }
}

/* ---------------------------------------------------------------- variants */

/** Speech, shared clock, prep, break — one clock, one core. */
function Single({
  ps,
  view,
  secondsOnly,
  l10n,
  t,
  sideLabel,
  digitsOut,
  barOut,
}: {
  ps: SegmentPlan;
  view: RoundView;
  secondsOnly: boolean;
  l10n: (text: L10n | undefined) => string;
  t: TFn;
  sideLabel: (id: SideId) => string;
  digitsOut: RefObject<DigitsHandle | null>;
  barOut: RefObject<DepletionBarHandle | null>;
}): JSX.Element {
  const clock = view.primary;
  const allotted = clock?.allottedMs ?? ps.allottedMs;
  // Both are structure, not time: memoised so a heartbeat re-render never churns the
  // bar's hatches or its cue marks.
  const windows = useMemo(
    () => protectedWindows(allotted, ps.protectedMs),
    [allotted, ps.protectedMs],
  );
  const markers = useMemo(
    () =>
      ps.cues
        .filter((c) => c.atMs > 0 && c.atMs < allotted)
        .slice(0, 4)
        .map((c) => ({ at: (c.atMs / allotted) * 100, text: formatTime(c.atMs) })),
    [ps.cues, allotted],
  );

  const speaker = ps.speaker;
  const plates: { side: SideId; title: string; sub: string }[] = [];
  if (speaker) {
    // The role line above already names the phase; the slab names the person, so the
    // two never print the same word twice at 96px.
    const role = speaker.role ? l10n(speaker.role) : '';
    plates.push({
      side: speaker.side,
      title: speaker.name,
      sub: role === '' ? sideLabel(speaker.side) : `${sideLabel(speaker.side)} · ${role}`,
    });
  } else {
    for (const side of ps.liveSides) {
      const named = ps.participants.filter((p) => p.side === side);
      plates.push({
        side,
        title: named.length > 0 ? named.map((p) => p.name).join(' · ') : sideLabel(side),
        sub: named.length > 0 ? sideLabel(side) : l10n(ps.label),
      });
    }
  }

  return (
    <>
      <p className="stage__role s-role">{l10n(ps.label)}</p>

      <Digits
        key={ps.primaryClockId}
        ref={digitsOut}
        scale="stage"
        secondsOnly={secondsOnly}
        initialMs={clock?.remainingMs ?? allotted}
        initialBand={clock?.band ?? 'normal'}
        name={speaker?.name ?? l10n(ps.label)}
      />

      <div className="stage__barwrap">
        <DepletionBar
          key={ps.primaryClockId}
          ref={barOut}
          variant="stage"
          allottedMs={allotted}
          cues={ps.cues}
          protectedWindows={windows}
          initialBand={clock?.band ?? 'normal'}
        />
        {markers.length > 0 ? (
          <div className="stage__cues" aria-hidden="true">
            {markers.map((m) => (
              <span key={m.text} className="stage__cue s-rail-meta" style={{ left: `${m.at}%` }}>
                {m.text}
              </span>
            ))}
          </div>
        ) : null}
        {ps.protectedMs > 0 ? (
          <p className="stage__protected s-rail-meta">{t('st.protected')}</p>
        ) : null}
      </div>

      {plates.length > 0 ? (
        <div className="stage__plates">
          {plates.map((p) => (
            <Plate key={`${p.side}-${p.title}`} side={p.side} title={p.title} sub={p.sub} />
          ))}
        </div>
      ) : null}
    </>
  );
}

interface ChessOutputs {
  primaryDigits: RefObject<DigitsHandle | null>;
  secondaryDigits: RefObject<DigitsHandle | null>;
  primaryBar: RefObject<DepletionBarHandle | null>;
  secondaryBar: RefObject<DepletionBarHandle | null>;
  bankA: RefObject<HTMLSpanElement | null>;
  bankB: RefObject<HTMLSpanElement | null>;
}

/** Free debate: two clocks. The idle side stays legible but visibly stands down. */
function Chess({
  ps,
  view,
  secondsOnly,
  sideLabels,
  out,
}: {
  ps: SegmentPlan;
  view: RoundView;
  secondsOnly: boolean;
  sideLabels: [string, string];
  out: ChessOutputs;
}): JSX.Element {
  const { t } = useLang();
  const perSide = ps.segment.kind === 'chess' ? ps.segment.perSideMs : ps.allottedMs;

  return (
    <>
      <p className="stage__role s-role">
        <Bi k="k.free" />
      </p>

      <div className="stage__chess">
        {SIDES.map((side, i) => {
          const clockId = chessClockId(ps.segId, side);
          const clock = view.clocks.find((c) => c.clockId === clockId) ?? null;
          const live = view.floor === side;
          return (
            <section
              key={side}
              className="stage__chesside"
              data-side={side}
              data-live={live ? '' : undefined}
            >
              <Plate side={side} title={sideLabels[i] ?? side} sub="" />
              <Digits
                key={clockId}
                ref={side === 'A' ? out.primaryDigits : out.secondaryDigits}
                scale="chess"
                secondsOnly={secondsOnly}
                initialMs={clock?.remainingMs ?? perSide}
                initialBand={clock?.band ?? 'normal'}
                name={sideLabels[i] ?? side}
                label={`${sideLabels[i] ?? side} · ${t('a11y.timerRegion')}`}
                announce={side === 'A'}
              />
              <DepletionBar
                key={clockId}
                ref={side === 'A' ? out.primaryBar : out.secondaryBar}
                variant="stage"
                allottedMs={perSide}
                cues={ps.cues}
                initialBand={clock?.band ?? 'normal'}
              />
              <p className="stage__bank s-rail-meta" data-numeric="">
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

/** Pre-round title card. The rails already face each other; this is the announcement. */
function Standby(): JSX.Element {
  return (
    <div className="stage__card">
      <p className="stage__cardline">
        <Bi k="st.preRound" />
      </p>
    </div>
  );
}

function Complete({ view, totalMs }: { view: RoundView; totalMs: number }): JSX.Element {
  const { t } = useLang();
  const showHours = longRound(totalMs);
  return (
    <div className="stage__card">
      <p className="stage__cardline">
        <Bi k="st.complete" />
      </p>
      <p className="stage__score s-next" data-numeric="">
        {t('r.elapsed')} {formatTime(view.roundElapsedMs, { showHours })} · {t('r.scheduled')}{' '}
        {formatTime(totalMs, { showHours })}
      </p>
    </div>
  );
}

/**
 * Opened with nothing to show — a stage started before its console, or a leader that has
 * not answered yet. A legible idle card, never a crash and never a blank wall.
 */
function Idle({ t, lost }: { t: TFn; lost: boolean }): JSX.Element {
  return (
    <div className="stage__card">
      <p className="stage__cardline">
        <Bi k={lost ? 'sg.linkLost' : 'sg.waiting'} />
      </p>
      <p className="stage__cardsub s-rail-meta">{t('sg.sameBrowser')}</p>
    </div>
  );
}

/**
 * §5.4 — the round is on HOLD. A full-stage slab, the word, and the frozen clock beneath
 * it, so a room that looks up mid-pause is told the pause is deliberate.
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

/** Identity colour lives here — a nameplate slab is periphery, never core. */
function Plate({ side, title, sub }: { side: SideId; title: string; sub: string }): JSX.Element {
  return (
    <div className="stage__plate" data-side={side}>
      <span className="stage__platename s-name">{title}</span>
      <span className="stage__platerole s-rail-meta">{sub}</span>
    </div>
  );
}

function Rail({
  side,
  speakers,
  label,
  currentId,
  nextId,
  l10n,
}: {
  side: SideId;
  speakers: readonly Speaker[];
  label: string;
  currentId: string | null;
  nextId: string | null;
  l10n: (text: L10n | undefined) => string;
}): JSX.Element {
  const mine = speakers.filter((s) => s.side === side);
  return (
    <aside className="stage__rail" data-side={side}>
      <p className="stage__railhead s-role">{label}</p>
      <ol className="stage__raillist">
        {mine.map((sp, i) => (
          <li
            key={sp.id}
            className="stage__railrow"
            data-state={sp.id === currentId ? 'current' : sp.id === nextId ? 'next' : 'idle'}
          >
            <span className="stage__railnum s-rail-meta" data-numeric="">
              {i + 1}
            </span>
            <span className="stage__railbody">
              <span className="stage__railname s-rail-name">{sp.name}</span>
              <span className="stage__railmeta s-rail-meta" data-numeric="">
                {sp.role ? `${l10n(sp.role)} · ` : ''}
                {formatTime(sp.defaultMs)}
              </span>
            </span>
            <span className="stage__railcaret m-nudge" aria-hidden="true" />
          </li>
        ))}
      </ol>
    </aside>
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

/** §5 — only a round total may roll over to H:MM:SS, and only above an hour. */
function longRound(totalMs: number): boolean {
  return totalMs >= 3_600_000;
}

/** Which floor bar is lit. Speech lights its own side; chess and shared light the floor. */
function lit(view: RoundView, ps: SegmentPlan | null, side: SideId): boolean {
  if (view.hold || view.phase !== 'in' || !ps) return false;
  if (ps.kind === 'chess') return view.floor === side;
  return ps.liveSides.includes(side);
}

