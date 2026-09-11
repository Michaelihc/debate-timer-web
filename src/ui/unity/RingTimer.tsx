/**
 * The Unity app's countdown ring.
 *
 * The original is an `Image` using the `Ellipse 2` sprite with
 * `type: Filled, fillMethod: Radial360, fillOrigin: 2 (Top), clockwise: true`,
 * over a second copy of the same sprite at 26.27% white as the track. Measuring the
 * sprite's alpha gives an outer diameter of 304px with a 36px stroke, i.e. the stroke is
 * 11.84% of the diameter — reproduced here as SVG so it stays crisp at projector size and
 * can be driven by `stroke-dashoffset` instead of a per-frame repaint.
 *
 * Radial360 empties clockwise from the top, so a full ring is a full circle and the arc
 * retreats as time is spent. `-90deg` puts 0 at twelve o'clock.
 */
import { useEffect, useRef } from 'react';
import { RING } from './ringGeometry';
import './unity.css';

const { viewBox: VIEW, radius: R, strokeRatio: STROKE_RATIO, circumference: CIRC } = RING;

export interface RingTimerProps {
  /** 0..1, already clamped by the engine. 1 = full ring. */
  fraction: number;
  /** Drives the fill colour and, past zero, the track colour too. */
  state: 'normal' | 'warn' | 'over';
  /** Rendered inside the ring — the time itself. */
  children?: React.ReactNode;
  label?: string;
}

export function RingTimer({ fraction, state, children, label }: RingTimerProps) {
  const arc = useRef<SVGCircleElement>(null);

  // Written straight to the DOM: the rAF loop updates this every frame and must not
  // re-render React 60 times a second.
  useEffect(() => {
    if (arc.current) arc.current.style.strokeDashoffset = String(CIRC * (1 - clamp01(fraction)));
  }, [fraction]);

  return (
    <div className="uring uring--console" data-state={state}>
      <svg className="uring__svg" viewBox={`0 0 ${VIEW} ${VIEW}`} aria-hidden="true" focusable="false">
        <circle className="uring__track" cx={VIEW / 2} cy={VIEW / 2} r={R} strokeWidth={VIEW * STROKE_RATIO} />
        <circle
          ref={arc}
          className="uring__arc"
          cx={VIEW / 2}
          cy={VIEW / 2}
          r={R}
          strokeWidth={VIEW * STROKE_RATIO}
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - clamp01(fraction))}
        />
      </svg>
      <div className="uring__core">{children}</div>
      {label === undefined ? null : <span className="u-sr">{label}</span>}
    </div>
  );
}

/** Local rather than imported: this file is pure presentation and has no engine deps. */
function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}
