/**
 * The timeline strip — the original's bottom band, rebuilt.
 *
 * `Timeline` is 650x60 at the 800x600 reference, holding a `HorizontalLayoutGroup` of
 * 31.3x30.7 squares with 2px spacing, each a white face with a `#323232` label and a small
 * tick mark below it, sitting above a 648x10 white rail. The current event's square turns
 * `Color.green`. The `Next Button` lives at the strip's left end.
 *
 * Everything the console's Ribbon could do, this does: a click SELECTS, a second click (or
 * Enter) LOADS, arrow-key focus walks the strip, and the live square fills to what has
 * ACTUALLY been consumed. A stray click can never restart a leg.
 *
 * The run order is the operator's — drawn verbatim, with nothing flagged, sorted or deduped.
 */

import type { JSX, KeyboardEvent as ReactKeyboardEvent, Ref } from 'react';
import { useImperativeHandle, useRef } from 'react';
import type { SideId } from '../domain/config';
import { useLang } from '../i18n/useLang';
import { clamp01 } from '../lib/clamp';
import { formatTime } from '../lib/format';
import { Icon } from '../ui/Icons';

import type { Pip } from './timelineData';
import './console.css';

export interface TimelineHandle {
  /** Repaint one square's consumption without a React render. */
  write(index: number, usedMs: number): void;
}

export interface TimelineProps {
  pips: readonly Pip[];
  /** The segment the round is on. */
  cursor: number;
  /** The keyboard / selection cursor. */
  selected: number;
  onSelect: (index: number) => void;
  onLoad: (index: number) => void;
  /** The green double-chevron at the strip's left end. */
  onNext: () => void;
  nextDisabled: boolean;
  colors: Partial<Record<SideId, string>>;
  ref?: Ref<TimelineHandle>;
}

export function Timeline({
  pips,
  cursor,
  selected,
  onSelect,
  onLoad,
  onNext,
  nextDisabled,
  colors,
  ref,
}: TimelineProps): JSX.Element {
  const { t } = useLang();
  const fills = useRef<(HTMLSpanElement | null)[]>([]);

  useImperativeHandle(
    ref,
    (): TimelineHandle => ({
      write(index, usedMs) {
        const pip = pips[index];
        const el = fills.current[index];
        if (!pip || !el) return;
        const allotted = Math.max(0, pip.allottedMs);
        const used = allotted > 0 ? clamp01(usedMs / allotted) : usedMs > 0 ? 1 : 0;
        el.style.height = `${used * 100}%`;
      },
    }),
    [pips],
  );

  function activate(index: number): void {
    if (selected === index) onLoad(index);
    else onSelect(index);
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLElement>, index: number): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      onLoad(index);
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      onSelect(index);
    }
  }

  return (
    <div className="tline">
      <button
        type="button"
        className="tline__next"
        onClick={onNext}
        disabled={nextDisabled}
        aria-keyshortcuts="N"
      >
        <span className="tline__chev" aria-hidden="true">
          <Icon name="next" size={16} />
          <Icon name="next" size={16} />
        </span>
        <span className="tline__nextlabel">{t('t.next')}</span>
      </button>

      <div className="tline__strip">
        <div
          className="tline__pips"
          role="listbox"
          aria-label={t('tl.title')}
          aria-orientation="horizontal"
        >
          {pips.map((pip, i) => {
            const state = i < cursor ? 'done' : i === cursor ? 'current' : 'future';
            const edge = pip.side === null ? undefined : colors[pip.side];
            return (
              <div
                key={`${pip.segId}-${i}`}
                className="tline__pip"
                data-kind={pip.kind}
                data-state={state}
                data-selected={i === selected ? '' : undefined}
                style={edge === undefined ? undefined : { ['--pip-edge' as string]: edge }}
                role="option"
                aria-selected={i === selected}
                aria-current={i === cursor ? 'step' : undefined}
                aria-label={`${i + 1}. ${pip.label} ${formatTime(pip.allottedMs)}`}
                title={`${pip.label} · ${formatTime(pip.allottedMs)}`}
                tabIndex={0}
                onClick={() => {
                  activate(i);
                }}
                onFocus={() => {
                  onSelect(i);
                }}
                onKeyDown={(e) => {
                  onKeyDown(e, i);
                }}
              >
                <span
                  ref={(el) => {
                    fills.current[i] = el;
                  }}
                  className="tline__fill"
                  aria-hidden="true"
                />
                <span className="tline__mark" aria-hidden="true">
                  {pip.mark}
                </span>
                <span className="tline__tick" aria-hidden="true" />
              </div>
            );
          })}
        </div>
        <span className="tline__rail" aria-hidden="true" />
      </div>
    </div>
  );
}
