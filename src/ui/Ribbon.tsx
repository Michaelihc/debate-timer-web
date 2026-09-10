/**
 * THE Ribbon — the app's structural signature, one component at three scales.
 *
 *   thumb  a preset card's structure line, 8px tall, no labels, not interactive
 *   spine  the editor run-sheet's spine, 12px tall, selection follows the sheet
 *   live   band 3 of the console, 44px tall, tabbable, selectable, loadable
 *
 * Block width is that segment's share of the round, so the picture *is* the format. A
 * finished block fills to what was ACTUALLY consumed, and an overrun spills past the block
 * edge in `--state-over` rather than being clipped to a tidy 100%.
 *
 * In `live` scale a click SELECTS. Enter, or a second click on the already-selected block,
 * LOADS it armed. A stray click can never restart a leg — the single most expensive
 * mis-click a timing operator can make.
 *
 * The run order is the operator's. This component draws the sequence exactly as given:
 * repeats, omissions and out-of-sequence speakers are data, not defects, and nothing here
 * flags, sorts or dedupes them.
 */

import type { JSX, KeyboardEvent as ReactKeyboardEvent, Ref } from 'react';
import { useImperativeHandle, useMemo, useRef } from 'react';
import type { SideId } from '../domain/config';
import { clamp01 } from '../lib/clamp';
import type { RibbonSegment } from './ribbonData';

import './ui.css';

export type { RibbonSegment } from './ribbonData';

export type RibbonScale = 'thumb' | 'spine' | 'live';

export interface RibbonHandle {
  /** Repaint one block's consumption without a React render (the live current block). */
  write(index: number, usedMs: number): void;
}

export interface RibbonProps {
  scale: RibbonScale;
  segments: readonly RibbonSegment[];
  /** The segment the round is on. */
  cursor?: number;
  /** The keyboard/selection cursor in `live` and `spine`. */
  selected?: number | null;
  onSelect?: (index: number) => void;
  /** Enter, or a second click on the selected block. */
  onLoad?: (index: number) => void;
  /** `{ A: '#E69F00', B: '#0072B2' }` — the config's side colours. */
  colors?: Partial<Record<SideId, string>>;
  ariaLabel?: string;
  className?: string;
  ref?: Ref<RibbonHandle>;
}

/** Minimum block width so a 30-second Final Focus is still a hittable target (§13.12). */
const MIN_PX: Record<RibbonScale, number> = { thumb: 3, spine: 8, live: 24 };
function widths(segments: readonly RibbonSegment[]): number[] {
  let total = 0;
  for (const s of segments) total += Math.max(0, s.allottedMs);
  if (total <= 0) return segments.map(() => 100 / Math.max(1, segments.length));
  return segments.map((s) => (Math.max(0, s.allottedMs) / total) * 100);
}

export function Ribbon({
  scale,
  segments,
  cursor = -1,
  selected = null,
  onSelect,
  onLoad,
  colors,
  ariaLabel,
  className,
  ref,
}: RibbonProps): JSX.Element {
  const shares = useMemo(() => widths(segments), [segments]);
  const fills = useRef<(HTMLSpanElement | null)[]>([]);
  const spills = useRef<(HTMLSpanElement | null)[]>([]);
  const interactive = scale !== 'thumb' && (onSelect !== undefined || onLoad !== undefined);

  useImperativeHandle(
    ref,
    (): RibbonHandle => ({
      write(index, usedMs) {
        const seg = segments[index];
        if (!seg) return;
        const allotted = Math.max(0, seg.allottedMs);
        const fill = allotted > 0 ? clamp01(usedMs / allotted) * 100 : usedMs > 0 ? 100 : 0;
        const over = allotted > 0 ? Math.max(0, usedMs - allotted) / allotted : 0;
        const f = fills.current[index];
        if (f) f.style.width = `${fill}%`;
        const s = spills.current[index];
        if (s) s.style.width = `${Math.min(0.5, over) * 100}%`;
      },
    }),
    [segments],
  );

  function activate(index: number): void {
    if (selected === index) onLoad?.(index);
    else onSelect?.(index);
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLElement>, index: number): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      onLoad?.(index);
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      onSelect?.(index);
    }
  }

  return (
    <div
      className={
        className === undefined ? `ribbon ribbon--${scale}` : `ribbon ribbon--${scale} ${className}`
      }
      role={interactive ? 'listbox' : 'presentation'}
      aria-label={interactive ? ariaLabel : undefined}
      aria-orientation={interactive ? 'horizontal' : undefined}
    >
      {segments.map((seg, i) => {
        const share = shares[i] ?? 0;
        const allotted = Math.max(0, seg.allottedMs);
        const used = seg.usedMs ?? 0;
        const fill = allotted > 0 ? clamp01(used / allotted) * 100 : 0;
        const over = allotted > 0 ? Math.max(0, used - allotted) / allotted : 0;
        const edge = seg.side ? colors?.[seg.side] : undefined;
        const isCurrent = i === cursor;
        const isSelected = i === selected;
        const state = i < cursor ? 'done' : isCurrent ? 'current' : 'future';
        return (
          <div
            key={`${seg.segId}-${i}`}
            className="ribbon__block"
            data-kind={seg.kind}
            data-state={state}
            data-selected={isSelected ? '' : undefined}
            style={{
              flexBasis: `${share}%`,
              minWidth: `${MIN_PX[scale]}px`,
              ...(edge === undefined ? {} : { ['--block-edge' as string]: edge }),
            }}
            role={interactive ? 'option' : 'presentation'}
            aria-selected={interactive ? isSelected : undefined}
            aria-current={interactive && isCurrent ? 'step' : undefined}
            aria-label={interactive ? `${i + 1}. ${seg.label}` : undefined}
            tabIndex={interactive ? 0 : undefined}
            onClick={interactive ? () => activate(i) : undefined}
            onFocus={interactive ? () => onSelect?.(i) : undefined}
            onKeyDown={interactive ? (e) => onKeyDown(e, i) : undefined}
          >
            <span className="ribbon__edge" aria-hidden="true" />
            <span
              ref={(el) => {
                fills.current[i] = el;
              }}
              className="ribbon__fill"
              style={{ width: `${fill}%` }}
              aria-hidden="true"
            />
            <span
              ref={(el) => {
                spills.current[i] = el;
              }}
              className="ribbon__spill"
              style={{ width: `${Math.min(0.5, over) * 100}%` }}
              aria-hidden="true"
            />
            {scale === 'thumb' ? null : (
              <span className="ribbon__label" aria-hidden="true">
                <span className="ribbon__label-long">{seg.label}</span>
                <span className="ribbon__label-short">{seg.short}</span>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
