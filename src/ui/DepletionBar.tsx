/**
 * The depletion bar: track, fill, cue ticks, minute graticules, protected-time hatch.
 *
 * Like `Digits`, it is written to by the rAF loop through a ref and does not re-render
 * from time — only from a new segment. Overrun does not clamp: the fill empties and a
 * spill block grows out past the right edge of the track in `--state-over`, so a speech
 * that ran long is visibly *outside* its own block rather than sitting at a tidy zero.
 *
 * PERIPHERY / CORE: this is core, so its fill takes clock-state colour only.
 */

import type { JSX, Ref } from 'react';
import { useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import type { CueSpec } from '../domain/config';
import type { Band } from '../engine/selectors';
import { clamp01 } from '../lib/clamp';
import { fillFraction } from '../lib/format';

import './ui.css';

/** A protected window, in ms REMAINING — the same axis the cue ladder uses. */
export interface ProtectedWindow {
  /** Higher remaining value: where the window opens. */
  fromMs: number;
  /** Lower remaining value: where it closes. */
  toMs: number;
}

export interface DepletionBarHandle {
  write(remainingMs: number, band?: Band): void;
  readonly node: HTMLElement | null;
}

export interface DepletionBarProps {
  allottedMs: number;
  /** Cue thresholds get a 2px tick each. */
  cues?: readonly CueSpec[];
  protectedWindows?: readonly ProtectedWindow[];
  initialRemainingMs?: number;
  initialBand?: Band;
  /** 1px hairline at every whole minute. Off below two minutes automatically. */
  graticules?: boolean;
  /** `stage` uses the stage palette and a thicker rule. */
  variant?: 'console' | 'stage';
  /** Overrun beyond this fraction of the allotment stops growing. */
  spillCap?: number;
  className?: string;
  ref?: Ref<DepletionBarHandle>;
}

const MINUTE = 60_000;

export function DepletionBar({
  allottedMs,
  cues = [],
  protectedWindows = [],
  initialRemainingMs,
  initialBand = 'normal',
  graticules = true,
  variant = 'console',
  spillCap = 0.35,
  className,
  ref,
}: DepletionBarProps): JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const fillEl = useRef<HTMLDivElement>(null);
  const spillEl = useRef<HTMLDivElement>(null);
  const lastBand = useRef<Band>(initialBand);
  const lastFill = useRef(-1);
  const lastSpill = useRef(-1);

  /** Position on the bar, left→right, of a REMAINING value. */
  const at = useMemo(() => {
    return (remaining: number): number =>
      allottedMs > 0 ? clamp01(remaining / allottedMs) * 100 : 0;
  }, [allottedMs]);

  const ticks = useMemo(
    () => cues.filter((c) => c.atMs > 0 && c.atMs < allottedMs).map((c) => ({ at: at(c.atMs), tone: c.tone })),
    [cues, allottedMs, at],
  );

  const lines = useMemo(() => {
    if (!graticules || allottedMs < 2 * MINUTE) return [] as number[];
    const out: number[] = [];
    for (let ms = MINUTE; ms < allottedMs; ms += MINUTE) out.push(at(ms));
    return out;
  }, [graticules, allottedMs, at]);

  const hatches = useMemo(
    () =>
      protectedWindows
        .map((w) => {
          const hi = Math.max(w.fromMs, w.toMs);
          const lo = Math.min(w.fromMs, w.toMs);
          return { left: at(lo), width: Math.max(0, at(hi) - at(lo)) };
        })
        .filter((h) => h.width > 0),
    [protectedWindows, at],
  );

  const paint = useMemo(() => {
    return (remainingMs: number, band?: Band): void => {
      const next = band ?? lastBand.current;
      if (next !== lastBand.current) {
        lastBand.current = next;
        if (root.current) root.current.dataset['band'] = next;
      }
      const fill = Math.round(fillFraction(remainingMs, allottedMs) * 10000) / 100;
      if (fill !== lastFill.current) {
        lastFill.current = fill;
        if (fillEl.current) fillEl.current.style.width = `${fill}%`;
      }
      const over = remainingMs < 0 && allottedMs > 0 ? -remainingMs / allottedMs : 0;
      const spill = Math.round(Math.min(spillCap, over) * 10000) / 100;
      if (spill !== lastSpill.current) {
        lastSpill.current = spill;
        if (spillEl.current) spillEl.current.style.width = `${spill}%`;
      }
    };
  }, [allottedMs, spillCap]);

  useEffect(() => {
    paint(initialRemainingMs ?? allottedMs, lastBand.current);
    // Mount and re-plan only: the loop owns every frame after this.
  }, [paint, initialRemainingMs, allottedMs]);

  useImperativeHandle(
    ref,
    (): DepletionBarHandle => ({
      write: paint,
      get node() {
        return root.current;
      },
    }),
    [paint],
  );

  return (
    <div
      ref={root}
      className={
        className === undefined
          ? `dbar dbar--${variant}`
          : `dbar dbar--${variant} ${className}`
      }
      role="presentation"
    >
      <div className="dbar__track">
        {hatches.map((h) => (
          <span
            key={`h${h.left}`}
            className="dbar__hatch"
            style={{ left: `${h.left}%`, width: `${h.width}%` }}
          />
        ))}
        {lines.map((x) => (
          <span key={`g${x}`} className="dbar__grat" style={{ left: `${x}%` }} />
        ))}
        <div ref={fillEl} className="dbar__fill" />
        {ticks.map((tk) => (
          <span
            key={`t${tk.at}`}
            className="dbar__tick"
            data-tone={tk.tone}
            style={{ left: `${tk.at}%` }}
          />
        ))}
      </div>
      <div ref={spillEl} className="dbar__spill" />
    </div>
  );
}
