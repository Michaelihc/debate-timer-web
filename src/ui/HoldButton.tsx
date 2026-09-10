/**
 * Hold-to-confirm (M5). 600ms of a filling arc before a destructive action commits.
 *
 * It is the reason RESET can live on an unmodified key: there is no unmodified single
 * keystroke in this app that does anything irreversible.
 *
 * §13.9 — the hold is announced, not just drawn: the arc's progress is exposed on a
 * `role="progressbar"`, the button carries the "hold to…" description, and a release
 * before the threshold says so out loud instead of silently doing nothing.
 */

import type { JSX, ReactNode } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { HOLD_MS } from '../app/hotkeys';
import { useLang } from '../i18n/useLang';

import './ui.css';

export interface HoldButtonProps {
  onConfirm: () => void;
  children: ReactNode;
  /** Default 600ms — the same threshold the keyboard layer uses. */
  holdMs?: number;
  /** Accessible name, when the children are an icon. */
  label?: string;
  /** The instruction, e.g. `t('t.resetHold')`. Announced on an early release too. */
  description?: string;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  className?: string;
  /** Mirrors the keyboard route: feed it `progress` from `useHotkeys` if you bind one. */
  progress?: number;
  onProgress?: (progress: number) => void;
}

export { HOLD_MS };

export function HoldButton({
  onConfirm,
  children,
  holdMs = HOLD_MS,
  label,
  description,
  disabled = false,
  tone = 'default',
  className,
  progress,
  onProgress,
}: HoldButtonProps): JSX.Element {
  const { t } = useLang();
  const descId = useId();
  const [internal, setInternal] = useState(0);
  const [tooEarly, setTooEarly] = useState(false);
  const raf = useRef(0);
  const timer = useRef(0);
  const holding = useRef(false);

  const value = progress ?? internal;

  useEffect(() => () => stop(), []);

  function stop(): void {
    holding.current = false;
    if (raf.current !== 0) cancelAnimationFrame(raf.current);
    if (timer.current !== 0) clearTimeout(timer.current);
    raf.current = 0;
    timer.current = 0;
  }

  function report(p: number): void {
    setInternal(p);
    onProgress?.(p);
  }

  function begin(): void {
    if (disabled || holding.current) return;
    holding.current = true;
    setTooEarly(false);
    const started = performance.now();
    const tick = (): void => {
      if (!holding.current) return;
      const p = Math.min(1, (performance.now() - started) / holdMs);
      report(p);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    timer.current = window.setTimeout(() => {
      stop();
      report(1);
      onConfirm();
      // Leave the arc full for one beat so the operator sees that it landed.
      timer.current = window.setTimeout(() => report(0), 240);
    }, holdMs);
  }

  function cancel(): void {
    if (!holding.current) return;
    stop();
    report(0);
    setTooEarly(true);
  }

  const pct = Math.round(value * 100);

  return (
    <button
      type="button"
      className={
        className === undefined ? `holdbtn holdbtn--${tone}` : `holdbtn holdbtn--${tone} ${className}`
      }
      data-holding={value > 0 ? '' : undefined}
      disabled={disabled}
      aria-label={label}
      aria-describedby={description === undefined ? undefined : descId}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        begin();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onKeyDown={(e) => {
        if (e.key !== ' ' && e.key !== 'Enter') return;
        e.preventDefault();
        if (!e.repeat) begin();
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') cancel();
      }}
      onBlur={cancel}
    >
      <span className="holdbtn__arc" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="16" height="16">
          <circle className="holdbtn__arc-track" cx="8" cy="8" r="6.25" />
          <circle
            className="holdbtn__arc-fill"
            cx="8"
            cy="8"
            r="6.25"
            style={{ strokeDashoffset: `${(1 - value) * 39.27}` }}
          />
        </svg>
      </span>
      <span className="holdbtn__label">{children}</span>
      {description === undefined ? null : (
        <span id={descId} className="sr-only">
          {description}
        </span>
      )}
      <span
        className="sr-only"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={description ?? label ?? t('t.resetHold')}
      />
      <span className="sr-only" aria-live="polite">
        {tooEarly ? (description ?? t('t.resetHold')) : ''}
      </span>
    </button>
  );
}
