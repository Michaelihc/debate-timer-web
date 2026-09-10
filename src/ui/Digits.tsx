/**
 * The ticking clock.
 *
 * It mounts once and then never re-renders from time. The rAF loop in `engine/loop.ts`
 * calls `ref.current.write(ms)` sixty times a second and the component writes three text
 * nodes; React is not involved. That is the whole reason the app can hold 60fps digits at
 * roughly zero renders per second.
 *
 * `aria-live` is OFF on the digits — a screen reader announcing every frame, or even every
 * second, is unusable. A separate polite region announces only at boundaries that mean
 * something: each whole minute, every one of the last ten seconds, the moment of expiry,
 * and whatever the console pushes through `say()` (segment armed, floor handed off).
 *
 * PERIPHERY / CORE: the digits are the optical core, so they carry clock-state colour
 * (`data-band`) and never a side's identity colour.
 */

import type { JSX, Ref } from 'react';
import { useEffect, useImperativeHandle, useRef } from 'react';
import type { Band } from '../engine/selectors';
import { formatOvertime, formatTime } from '../lib/format';
import { useLang } from '../i18n/useLang';

import './ui.css';

export interface DigitsWriteOpts {
  /** Clock-state band. Changing it swaps the core colour; nothing else in the app may. */
  band?: Band;
  /** `rules.display === 'seconds'`. */
  secondsOnly?: boolean;
  /** Force H:MM:SS below the one-hour threshold (round totals only). */
  showHours?: boolean;
  /** Suppress the boundary announcement for this write (a scrub, a reset). */
  silent?: boolean;
}

export interface DigitsHandle {
  /** Paint. Negative ms is overtime and renders `+M:SS`. */
  write(remainingMs: number, opts?: DigitsWriteOpts): void;
  /** Announce something the clock cannot infer: segment armed, floor handed off, hold. */
  say(message: string): void;
  /** The root element, for callers that need to measure or flash it. */
  readonly node: HTMLElement | null;
}

export interface DigitsProps {
  /** What the clock shows before the first `write()`. */
  initialMs?: number;
  initialBand?: Band;
  secondsOnly?: boolean;
  showHours?: boolean;
  /** Type scale. `console` uses `--t-clock`; `stage` and `chess` use the stage scale. */
  scale?: 'console' | 'stage' | 'chess';
  /** Who the time belongs to — read out in the announcements. */
  name?: string;
  /** `aria-label` on the `role="timer"`. Defaults to `a11y.timerRegion`. */
  label?: string;
  /** False on a secondary clock, so two clocks never announce over each other. */
  announce?: boolean;
  className?: string;
  ref?: Ref<DigitsHandle>;
}

const FINAL10_S = 10;

/** `2:47` → head `2:`, seconds `47`. The seconds glyph is the only part that blips (M4). */
function split(text: string): { sign: string; head: string; sec: string } {
  const sign = text.startsWith('+') ? '+' : '';
  const body = sign === '' ? text : text.slice(1);
  const cut = body.lastIndexOf(':');
  if (cut < 0) return { sign, head: '', sec: body };
  return { sign, head: body.slice(0, cut + 1), sec: body.slice(cut + 1) };
}

export function Digits({
  initialMs = 0,
  initialBand = 'normal',
  secondsOnly = false,
  showHours = false,
  scale = 'console',
  name = '',
  label,
  announce = true,
  className,
  ref,
}: DigitsProps): JSX.Element {
  const { t } = useLang();
  const root = useRef<HTMLDivElement>(null);
  const signEl = useRef<HTMLSpanElement>(null);
  const headEl = useRef<HTMLSpanElement>(null);
  const secEl = useRef<HTMLSpanElement>(null);
  const liveEl = useRef<HTMLDivElement>(null);
  const alertEl = useRef<HTMLDivElement>(null);

  // Every value the writer compares against lives in a ref: touching state here would
  // re-render, which is the one thing this component exists not to do.
  const lastText = useRef('');
  const lastBand = useRef<Band>(initialBand);
  const lastSec = useRef<number | null>(null);
  const nameRef = useRef(name);
  nameRef.current = name;
  const tRef = useRef(t);
  tRef.current = t;

  // Everything the writer mutates is painted from here, not from JSX. If the initial text
  // were rendered as children, any parent re-render would snap the live clock back to it.
  useEffect(() => {
    const fmt = { secondsOnly, showHours };
    const text = initialMs < 0 ? formatOvertime(initialMs, fmt) : formatTime(initialMs, fmt);
    lastText.current = text;
    const parts = split(text);
    if (signEl.current) signEl.current.textContent = parts.sign;
    if (headEl.current) headEl.current.textContent = parts.head;
    if (secEl.current) secEl.current.textContent = parts.sec;
    if (root.current) root.current.dataset['band'] = lastBand.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only, by design
  }, []);

  useImperativeHandle(
    ref,
    (): DigitsHandle => ({
      write(remainingMs, opts = {}) {
        const over = remainingMs < 0;
        const fmt = { showHours: opts.showHours ?? showHours, secondsOnly: opts.secondsOnly ?? secondsOnly };
        const text = over ? formatOvertime(remainingMs, fmt) : formatTime(remainingMs, fmt);

        if (text !== lastText.current) {
          lastText.current = text;
          const parts = split(text);
          if (signEl.current) signEl.current.textContent = parts.sign;
          if (headEl.current) headEl.current.textContent = parts.head;
          if (secEl.current) secEl.current.textContent = parts.sec;
        }

        const band = opts.band ?? lastBand.current;
        if (band !== lastBand.current) {
          lastBand.current = band;
          if (root.current) root.current.dataset['band'] = band;
        }

        const sec = over ? -Math.floor(-remainingMs / 1000) : Math.ceil(remainingMs / 1000);
        if (sec === lastSec.current) return;
        const previous = lastSec.current;
        lastSec.current = sec;

        // M4 — the final-ten blip is on the seconds glyph alone, once per second.
        if (band === 'final10' && secEl.current) {
          const el = secEl.current;
          el.classList.remove('m-blip');
          void el.offsetWidth;
          el.classList.add('m-blip');
        }

        if (!announce || opts.silent === true || previous === null) return;
        speak(sec, over);
      },
      say(message) {
        if (liveEl.current) liveEl.current.textContent = message;
      },
      get node() {
        return root.current;
      },
    }),
    [announce, secondsOnly, showHours],
  );

  /** Boundaries only: whole minutes above ten seconds, then every second, then expiry. */
  function speak(sec: number, over: boolean): void {
    const say = tRef.current;
    const who = nameRef.current;
    if (over) {
      if (sec === 0 || sec % 60 === 0) {
        const text = say('a11y.over', { time: formatOvertime(sec * 1000), name: who });
        if (alertEl.current) alertEl.current.textContent = text;
      }
      return;
    }
    const atBoundary = sec <= FINAL10_S ? sec >= 0 : sec % 60 === 0;
    if (!atBoundary) return;
    const text = say('a11y.remaining', { time: formatTime(sec * 1000), name: who });
    const target = sec <= FINAL10_S ? alertEl : liveEl;
    if (target.current) target.current.textContent = text;
  }

  return (
    <div
      ref={root}
      className={
        className === undefined
          ? `digits digits--${scale}`
          : `digits digits--${scale} ${className}`
      }
      data-numeric=""
      role="timer"
      aria-live="off"
      aria-label={label ?? t('a11y.timerRegion')}
    >
      <span className="digits__figure" aria-hidden="true">
        <span ref={signEl} className="digits__sign" />
        <span ref={headEl} className="digits__head" />
        <span ref={secEl} className="digits__sec" />
      </span>
      <div ref={liveEl} className="sr-only" aria-live="polite" aria-atomic="true" />
      <div ref={alertEl} className="sr-only" aria-live="assertive" aria-atomic="true" />
    </div>
  );
}
