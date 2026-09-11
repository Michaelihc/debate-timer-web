/**
 * The centre of the screen: the original's `Count Down`, a 314.7x248.8 slot at (0, 44)
 * holding a `Radial360` ring with the time inside it.
 *
 * `<RingTimer>` is that ring. This component owns no numbers — every frame the engine loop
 * hands it a `Now`, it asks `clockView` what the clock reads, and it writes three DOM
 * properties: the digits, the arc's dash offset and the ring's state attribute. React
 * renders only when something discrete changed, so a 60fps clock costs no renders.
 *
 * PERIPHERY / CORE — this is the core, so clock-state colour lives here and identity colour
 * never does. Nothing in this file touches `--side-*`.
 */

import type { JSX, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { registerTick } from '../engine/loop';
import type { Band } from '../engine/selectors';
import { clockView } from '../engine/selectors';
import type { ClockId, Transport } from '../engine/state';
import { getSession } from '../engine/store';
import { useLang } from '../i18n/useLang';
import type { DigitsHandle } from '../ui/Digits';
import { Digits } from '../ui/Digits';
import { RING } from '../ui/unity/ringGeometry';
import { RingTimer } from '../ui/unity/RingTimer';

import { ringState } from './ringState';
import './console.css';

export interface RingCoreProps {
  clockId: ClockId;
  allottedMs: number;
  remainingMs: number;
  band: Band;
  /** 0..1 from `clockView`. Never recomputed here. */
  fill: number;
  transport: Transport;
  /** The segment's own name — `驳论 · REBUTTAL`. */
  label: string;
  /** The state word: RUNNING / PAUSED / ARMED / HOLD / OVER TIME. Never colour alone. */
  status: string;
  /** Whose clock this is: the speaker, the side drawing prep, or the room. */
  name: string;
  secondsOnly: boolean;
  /** ARMED is loud: the digits sit back and the ring is full and static. */
  armed?: boolean;
  /** A second clock on screen must not announce over the first. */
  announce?: boolean;
  /** The "up next" line, which sits under the name. */
  children?: ReactNode;
}

export function RingCore({
  clockId,
  allottedMs,
  remainingMs,
  band,
  fill,
  transport,
  label,
  status,
  name,
  secondsOnly,
  armed = false,
  announce = true,
  children,
}: RingCoreProps): JSX.Element {
  const { t } = useLang();
  const host = useRef<HTMLDivElement>(null);
  const digits = useRef<DigitsHandle>(null);

  // Per-frame paint. `registerTick` schedules one immediate repaint on registration, so
  // arming, adjusting or rewinding a stopped clock lands without waiting for a frame.
  useEffect(() => {
    const root = host.current;
    const ringEl = root?.querySelector<HTMLElement>('.uring') ?? null;
    const arcEl = root?.querySelector<SVGCircleElement>('.uring__arc') ?? null;
    let lastState = '';
    return registerTick((n) => {
      const s = getSession();
      const v = clockView(s.state, s.plan, clockId, n);
      if (!v) return;
      digits.current?.write(v.remainingMs, { band: v.band, secondsOnly });
      if (arcEl) arcEl.style.strokeDashoffset = String(RING.circumference * (1 - v.fill));
      const next = ringState(v.band);
      if (ringEl && next !== lastState) {
        lastState = next;
        ringEl.dataset['state'] = next;
      }
    });
  }, [clockId, secondsOnly]);

  // A discrete change (a new segment, an adjust) repaints in the same commit rather than
  // one frame later, so the digits never flash the outgoing segment's time.
  useEffect(() => {
    digits.current?.write(remainingMs, { band, secondsOnly, silent: true });
  }, [remainingMs, band, secondsOnly, allottedMs]);

  return (
    <div
      ref={host}
      className="ucore"
      data-transport={transport}
      data-band={band}
      data-armed={armed ? '' : undefined}
    >
      <div className="ucore__ring">
        <RingTimer fraction={fill} state={ringState(band)} label={t('a11y.timerRegion')}>
          <Digits
            ref={digits}
            key={clockId}
            initialMs={remainingMs}
            initialBand={band}
            secondsOnly={secondsOnly}
            name={name}
            announce={announce}
          />
        </RingTimer>
      </div>

      <div className="ucore__caption">
        {name === '' ? null : <p className="ucore__name">{name}</p>}
        <p className="ucore__label">
          <span>{label}</span>
          <span className="ucore__status" data-transport={transport} data-band={band}>
            {status}
          </span>
        </p>
        {children}
      </div>
    </div>
  );
}
