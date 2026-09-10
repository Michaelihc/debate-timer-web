/**
 * The optical core: segment label, the big clock, the depletion bar.
 *
 * It owns no numbers of its own. Every frame the engine loop hands it a `Now`, it asks
 * `clockView` what the clock reads, and it writes two DOM nodes. React renders only when
 * something discrete changed, which is why a 60fps clock costs roughly zero renders.
 *
 * PERIPHERY / CORE — this is the core, so clock-state colour lives here and identity
 * colour never does. Nothing in this file touches `--side-*`.
 */

import type { JSX, ReactNode } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import type { CueSpec } from '../domain/config';
import { registerTick } from '../engine/loop';
import type { Band } from '../engine/selectors';
import { clockView } from '../engine/selectors';
import type { ClockId, Transport } from '../engine/state';
import { getSession } from '../engine/store';
import type { DepletionBarHandle, ProtectedWindow } from '../ui/DepletionBar';
import { DepletionBar } from '../ui/DepletionBar';
import type { DigitsHandle } from '../ui/Digits';
import { Digits } from '../ui/Digits';

import './console.css';

export interface CoreClockProps {
  clockId: ClockId;
  allottedMs: number;
  remainingMs: number;
  band: Band;
  transport: Transport;
  cues: readonly CueSpec[];
  /** Protected-time window at each end of the speech, in ms. 0 = none. */
  protectedMs?: number;
  /** The segment's role label — `REBUTTAL · 驳论`. */
  label: string;
  /** The state word: RUNNING / PAUSED / ARMED / HOLD / OVER TIME. Never colour alone. */
  status: string;
  /** Whose clock this is, for the screen-reader announcements. */
  name?: string;
  secondsOnly: boolean;
  /** ARMED is loud: the digits sit back and the bar is full and static. */
  armed?: boolean;
  /** A second clock on screen must not announce over the first. */
  announce?: boolean;
  children?: ReactNode;
}

export function CoreClock({
  clockId,
  allottedMs,
  remainingMs,
  band,
  transport,
  cues,
  protectedMs = 0,
  label,
  status,
  name = '',
  secondsOnly,
  armed = false,
  announce = true,
  children,
}: CoreClockProps): JSX.Element {
  const digits = useRef<DigitsHandle>(null);
  const bar = useRef<DepletionBarHandle>(null);

  const windows = useMemo<ProtectedWindow[]>(() => {
    if (protectedMs <= 0 || allottedMs <= 0) return [];
    return [
      { fromMs: allottedMs, toMs: Math.max(0, allottedMs - protectedMs) },
      { fromMs: Math.min(protectedMs, allottedMs), toMs: 0 },
    ];
  }, [protectedMs, allottedMs]);

  // Per-frame paint. Registration also schedules one immediate repaint, so arming,
  // adjusting or rewinding a stopped clock lands without waiting for a running frame.
  useEffect(() => {
    return registerTick((n) => {
      const s = getSession();
      const view = clockView(s.state, s.plan, clockId, n);
      if (!view) return;
      digits.current?.write(view.remainingMs, { band: view.band, secondsOnly });
      bar.current?.write(view.remainingMs, view.band);
    });
  }, [clockId, secondsOnly]);

  // A discrete change (a new segment, an adjust) repaints in the same commit rather than
  // one frame later, so the digits never flash the outgoing segment's time.
  useEffect(() => {
    digits.current?.write(remainingMs, { band, secondsOnly, silent: true });
    bar.current?.write(remainingMs, band);
  }, [remainingMs, band, secondsOnly, allottedMs]);

  return (
    <div className="core" data-transport={transport} data-band={band} data-armed={armed ? '' : undefined}>
      <div className="core__head">
        <h2 className="core__label t-cap">{label}</h2>
        <span className="core__status t-cap" data-transport={transport} data-band={band}>
          {status}
        </span>
      </div>

      <div className="core__clock">
        <Digits
          ref={digits}
          key={clockId}
          initialMs={remainingMs}
          initialBand={band}
          secondsOnly={secondsOnly}
          scale="console"
          name={name}
          announce={announce}
        />
      </div>

      <DepletionBar
        ref={bar}
        key={`bar-${clockId}-${allottedMs}`}
        allottedMs={allottedMs}
        cues={cues}
        protectedWindows={windows}
        initialRemainingMs={remainingMs}
        initialBand={band}
        variant="console"
      />

      {children}
    </div>
  );
}
