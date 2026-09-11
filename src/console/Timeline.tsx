/**
 * The timeline strip — the original's bottom band, rebuilt.
 *
 * `Timeline` is 650x60 at the 800x600 reference: white squares with `#323232` labels spread
 * along a 648x10 white rail, the current event's square turned `Color.green`, and the `Next
 * Button` at the strip's left end. Opposition speeches read as negative numbers, and an arrow
 * runs between consecutive squares so the direction of the round reads at a glance.
 *
 * Moving between segments lives here, not under the ring: Back sits beside the green ▶▶ and
 * returns to the previous segment at the time it actually stopped at, which is also how a
 * mistaken advance is taken back. Both are enabled exactly when the reducer would move.
 *
 * Everything the console's Ribbon could do, this does: a click SELECTS, a second click (or
 * Enter) LOADS, arrow-key focus walks the strip, and the live square fills to what has
 * ACTUALLY been consumed. A stray click can never restart a leg.
 *
 * On a narrow screen the arrows shrink first, so a normal round still fits. When even that
 * is too wide, the squares scroll on their own, the square the round moves to is brought
 * into view, and an edge that hides more squares fades out, so the strip never simply stops
 * at the side of the screen as if the round ended there.
 *
 * The run order is the operator's — drawn verbatim, with nothing flagged, sorted or deduped.
 */

import type { JSX, KeyboardEvent as ReactKeyboardEvent, Ref } from 'react';
import { Fragment, useEffect, useImperativeHandle, useRef } from 'react';
import { ariaShortcut, shortcutText } from '../app/hotkeys';
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
  /** Back one segment, at its remembered time. */
  onPrev: () => void;
  prevDisabled: boolean;
  /** The green double-chevron at the strip's left end. */
  onNext: () => void;
  nextDisabled: boolean;
  ref?: Ref<TimelineHandle>;
}

/** The fade drawn over an edge that hides squares: `--s-7`, as `.tline__pips` draws it. */
const EDGE_FADE_PX = 32;

/** Which edges of the strip hide squares right now, or null when every square shows. */
function hiddenEdges(box: HTMLElement): 'start' | 'end' | 'both' | null {
  const max = box.scrollWidth - box.clientWidth;
  if (max <= 1) return null;
  const start = box.scrollLeft > 1;
  const end = box.scrollLeft < max - 1;
  return start && end ? 'both' : start ? 'start' : end ? 'end' : null;
}

/**
 * Scroll `box` sideways just enough to centre `pip`, and only if it is out of view. A square
 * under an edge fade counts as out of view: it is there, but it does not read.
 */
function revealPip(box: HTMLElement, pip: HTMLElement): void {
  const boxRect = box.getBoundingClientRect();
  const pipRect = pip.getBoundingClientRect();
  const inset = box.scrollWidth > box.clientWidth ? EDGE_FADE_PX : 0;
  if (pipRect.left >= boxRect.left + inset && pipRect.right <= boxRect.right - inset) return;
  const left =
    box.scrollLeft + (pipRect.left - boxRect.left) - (boxRect.width - pipRect.width) / 2;
  const still =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (typeof box.scrollTo === 'function') {
    box.scrollTo({ left, behavior: still ? 'auto' : 'smooth' });
  } else {
    box.scrollLeft = left;
  }
}

export function Timeline({
  pips,
  cursor,
  selected,
  onSelect,
  onLoad,
  onPrev,
  prevDisabled,
  onNext,
  nextDisabled,
  ref,
}: TimelineProps): JSX.Element {
  const { t } = useLang();
  const fills = useRef<(HTMLSpanElement | null)[]>([]);
  const strip = useRef<HTMLDivElement>(null);

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

  // The round moved: if its square sits past the edge of a narrow strip, bring it back.
  useEffect(() => {
    const box = strip.current;
    const pip = box?.querySelector<HTMLElement>('[aria-current="step"]');
    if (box && pip) revealPip(box, pip);
  }, [cursor, pips.length]);

  // `data-more` names the edges hiding squares, for the stylesheet's fade. It is written
  // straight to the DOM as the strip scrolls or resizes, so scrolling costs no renders.
  useEffect(() => {
    const box = strip.current;
    if (!box) return undefined;
    const update = (): void => {
      const next = hiddenEdges(box);
      if (next === (box.dataset['more'] ?? null)) return;
      if (next === null) delete box.dataset['more'];
      else box.dataset['more'] = next;
    };
    update();
    box.addEventListener('scroll', update, { passive: true });
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    resize?.observe(box);
    return () => {
      box.removeEventListener('scroll', update);
      resize?.disconnect();
    };
  }, [pips.length]);

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
      <div className="tline__nav">
        <button
          type="button"
          className="tline__prev"
          onClick={onPrev}
          disabled={prevDisabled}
          aria-keyshortcuts={ariaShortcut('prev')}
          title={`${t('t.back')} · ${shortcutText('prev')}`}
        >
          <Icon name="prev" size={16} />
          <span className="tline__navlabel">{t('t.back')}</span>
        </button>

        <button
          type="button"
          className="tline__next"
          onClick={onNext}
          disabled={nextDisabled}
          aria-keyshortcuts={ariaShortcut('advance')}
          title={`${t('t.next')} · ${shortcutText('advance')}`}
        >
          <span className="tline__chev" aria-hidden="true">
            <Icon name="next" size={16} />
            <Icon name="next" size={16} />
          </span>
          <span className="tline__navlabel">{t('t.next')}</span>
        </button>
      </div>

      <div className="tline__strip">
        <div
          ref={strip}
          className="tline__pips"
          role="listbox"
          aria-label={t('tl.title')}
          aria-orientation="horizontal"
        >
          {pips.map((pip, i) => {
            const state = i < cursor ? 'done' : i === cursor ? 'current' : 'future';
            return (
              <Fragment key={`${pip.segId}-${i}`}>
                {i === 0 ? null : (
                  // The arrow INTO square i. Once the round has reached i it is behind us.
                  <span
                    className="tline__arrow"
                    data-state={i <= cursor ? 'done' : 'future'}
                    aria-hidden="true"
                  />
                )}
                <div
                  className="tline__pip"
                  data-kind={pip.kind}
                  data-state={state}
                  data-selected={i === selected ? '' : undefined}
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
                </div>
              </Fragment>
            );
          })}
        </div>
        <span className="tline__rail" aria-hidden="true" />
      </div>
    </div>
  );
}
