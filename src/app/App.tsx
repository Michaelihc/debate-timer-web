/**
 * The shell.
 *
 * It owns exactly five things and nothing else:
 *   1. the route → screen mapping,
 *   2. the document attributes (`data-theme`, `lang`) and the config's side colours,
 *   3. the single engine loop, started once for the life of the document,
 *   4. the audio-arm gesture and the always-visible audio state,
 *   5. the overlays that must survive a route change: the keyboard legend and the
 *      sleep-reconcile prompt.
 *
 * Screens own their own layout, their own transport handlers and their own overlays.
 */

import type { JSX } from 'react';
import { useEffect, useLayoutEffect, useRef } from 'react';

import '../styles/tokens.css';
import '../styles/reset.css';
import '../styles/type.css';
import '../ui/ui.css';

import { autoInk } from '../lib/contrast';
import { now } from '../engine/chronometer';
import { startEngine } from '../engine/loop';
import { clockView } from '../engine/selectors';
import { reconcileCommand } from '../engine/sleep';
import { toggleMuted } from '../engine/sound';
import { dispatch, useRound } from '../engine/store';
import { formatTime } from '../lib/format';
import { useLang } from '../i18n/useLang';
import { Confirm } from '../ui/Confirm';
import { IconSprite } from '../ui/Icons';
import { KeyLegendOverlay } from '../ui/KeyLegendOverlay';
import Launch from '../screens/Launch';
import Console from '../screens/Console';
import Editor from '../screens/Editor';
import Summary from '../screens/Summary';

import {
  bootOnce,
  closeLegend,
  installAudioArm,
  toggleLegend,
  useAudio,
  useBootState,
  useLegendOpen,
  useTheme,
} from './boot';
import type { HotkeyContext } from './hotkeys';
import { setContextResolver, useHotkeys } from './hotkeys';
import type { RouteName } from './router';
import { useRoute } from './router';

const CONTEXT: Record<RouteName, HotkeyContext> = {
  launch: 'launch',
  console: 'console',
  edit: 'editor',
  summary: 'summary',
  share: 'launch',
};

const HEADING: Record<RouteName, 'nav.launch' | 'nav.console' | 'nav.editor' | 'nav.summary'> = {
  launch: 'nav.launch',
  console: 'nav.console',
  edit: 'nav.editor',
  summary: 'nav.summary',
  share: 'nav.launch',
};

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  else void document.documentElement.requestFullscreen().catch(() => undefined);
}

export default function App(): JSX.Element {
  const route = useRoute();
  const boot = useBootState();
  const theme = useTheme();
  const audio = useAudio();
  const { t, l10n, toggleLang } = useLang();
  const session = useRound();
  const legendOpen = useLegendOpen();
  const heading = useRef<HTMLHeadingElement>(null);

  // The engine, the audio gesture and the context resolver are document-scoped and are
  // installed exactly once — StrictMode's double-mount is idempotent for all three.
  useEffect(() => {
    void bootOnce();
    const stopEngine = startEngine();
    const stopArm = installAudioArm();
    return () => {
      stopEngine();
      stopArm();
    };
  }, []);

  const routeRef = useRef(route);
  useLayoutEffect(() => {
    routeRef.current = route;
  });
  useEffect(() => setContextResolver(() => CONTEXT[routeRef.current.name]), []);

  // `data-theme` is the app's only theme switch.
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  // Identity colour, live from the config, on the periphery tokens only.
  useEffect(() => {
    const root = document.documentElement;
    const [a, b] = session.config.sides;
    root.style.setProperty('--side-a', a.color);
    root.style.setProperty('--side-b', b.color);
    root.style.setProperty('--side-a-ink', autoInk(a.color));
    root.style.setProperty('--side-b-ink', autoInk(b.color));
  }, [session.config]);

  // §13.3 — a route change moves focus to the new view's heading.
  useEffect(() => {
    heading.current?.focus();
  }, [route.name]);

  useHotkeys(CONTEXT[route.name], {
    legend: toggleLegend,
    langToggle: () => toggleLang(),
    fullscreen: toggleFullscreen,
    mute: () => {
      toggleMuted();
    },
    escape: legendOpen ? closeLegend : undefined,
  });

  const sleep = session.state.sleepPending;

  return (
    <div className="app" data-route={route.name}>
      <IconSprite />
      <h1 ref={heading} className="sr-only" tabIndex={-1}>
        {t(HEADING[route.name])} · {t('app.name')}
      </h1>

      {boot.ready ? (
        // The one `main` landmark in the document. Screens are `section`s inside it, so a
        // screen-reader user lands on the view itself rather than on the app chrome, and
        // no screen has to remember to declare a landmark of its own.
        <main className="app__screen">
          <Screen name={route.name} />
        </main>
      ) : (
        <div className="app__splash t-ctl">{t('ui.loading')}</div>
      )}

      <KeyLegendOverlay
        open={legendOpen}
        onClose={closeLegend}
        context={CONTEXT[route.name]}
        chess={session.plan.segments[session.state.cursor]?.kind === 'chess'}
      />

      {sleep === null ? null : <SleepPrompt />}

      <span className="sr-only" aria-live="polite">
        {audio.status === 'armed' ? t('au.armed') : audio.status === 'muted' ? t('au.muted') : ''}
      </span>
      <span className="sr-only">{l10n(session.config.title)}</span>
    </div>
  );
}

function Screen({ name }: { name: RouteName }): JSX.Element {
  switch (name) {
    case 'console':
      return <Console />;
    case 'edit':
      return <Editor />;
    case 'summary':
      return <Summary />;
    default:
      return <Launch />;
  }
}

/**
 * §3.11 — the machine slept mid-speech. The round is already on HOLD; the operator picks
 * between two clock values, both printed on their own button, because only they know
 * whether the room kept going.
 */
function SleepPrompt(): JSX.Element | null {
  const { t, l10n } = useLang();
  const session = useRound();
  const gap = session.state.sleepPending;
  if (!gap) return null;

  const n = now();
  const view = clockView(session.state, session.plan, gap.clockId, n);
  const remaining = view?.remainingMs ?? 0;
  const ps = session.plan.segments[session.state.cursor] ?? null;
  const who = ps?.speaker?.name ?? (ps ? l10n(ps.label) : t('st.noSegment'));

  return (
    <Confirm
      open
      title={t('d.sleepTitle')}
      body={t('d.sleepBody', { gap: formatTime(Math.abs(gap.gapMs)), name: who })}
      confirmLabel={t('d.chargeToSpeech', { time: formatTime(remaining - gap.gapMs) })}
      cancelLabel={t('d.discardSleep', { time: formatTime(remaining) })}
      onConfirm={() => dispatch(reconcileCommand(true))}
      onCancel={() => dispatch(reconcileCommand(false))}
    />
  );
}
