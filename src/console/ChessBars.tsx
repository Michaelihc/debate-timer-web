/**
 * Free debate · 自由辩论 — the original's double timer, rebuilt.
 *
 * Two `TimerController`s at x = ±140, each a `Line 1_0` sprite with
 * `type: Filled, fillMethod: Vertical, fillOrigin: 0 (Bottom)`, 10x100 at scale 2 → a
 * 20x200 bar over a track at 26.27% white, with that side's time below it at y = -116.3.
 * The `Swap` control sits centred between them at (0, 0) and calls `InvertTimer.swap()`.
 *
 * SWAP acts only when EXACTLY ONE side is running, which is the original's design, so the
 * control is HIDDEN — never a dead button — whenever `canSwap()` is false. Its keybinding
 * goes inert in the same breath.
 *
 * Handing the floor to a side is done from under THAT side's own time: "Give floor to
 * Proposition" sits beneath the Proposition bar, "Give floor to Opposition" beneath the
 * Opposition bar. A side's button is hidden whenever giving it the floor would change
 * nothing — above all while its own clock is already running — and the slot shows who has
 * the floor instead.
 *
 * Each side holds its OWN full allotment and keeps counting past zero.
 */

import type { JSX } from 'react';
import { useEffect, useRef } from 'react';
import type { HotkeyAction } from '../app/hotkeys';
import { ariaShortcut, capsOf, shortcutText } from '../app/hotkeys';
import type { SideId } from '../domain/config';
import { registerTick } from '../engine/loop';
import type { ClockView } from '../engine/selectors';
import { clockView } from '../engine/selectors';
import type { ClockId } from '../engine/state';
import { getSession } from '../engine/store';
import { useLang } from '../i18n/useLang';
import type { DigitsHandle } from '../ui/Digits';
import { Digits } from '../ui/Digits';
import { Keycaps } from '../ui/KeyLegendOverlay';

import { ringState } from './ringState';
import './console.css';

export interface ChessSideView {
  side: SideId;
  label: string;
  clockId: ClockId;
  allottedMs: number;
  view: ClockView | null;
}

export interface ChessBarsProps {
  label: string;
  status: string;
  sides: readonly [ChessSideView, ChessSideView];
  floor: SideId | null;
  /** No side has the floor yet: the segment has not been opened. */
  awaitingFloor: boolean;
  /** `firstFloor: 'operator'` — the operator must pick a side before anything starts. */
  operatorChooses: boolean;
  /** The side `firstFloor` names, for the "takes the floor" prompt. */
  firstFloorLabel: string;
  /** `canSwap()`. False hides the SWAP control outright. */
  swap: boolean;
  onSwap: () => void;
  /** Per side: would giving it the floor change anything? False hides its button. */
  canGiveFloor: Record<SideId, boolean>;
  onGiveFloor: (side: SideId) => void;
  secondsOnly: boolean;
}

function SideBar({
  entry,
  live,
  secondsOnly,
  announce,
  canGive,
  onGive,
}: {
  entry: ChessSideView;
  live: boolean;
  secondsOnly: boolean;
  announce: boolean;
  canGive: boolean;
  onGive: () => void;
}): JSX.Element {
  const { t } = useLang();
  const digits = useRef<DigitsHandle>(null);
  const fillEl = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const view = entry.view;
  const band = view?.band ?? 'normal';
  const remaining = view?.remainingMs ?? entry.allottedMs;
  const fill = view?.fill ?? 1;
  const action: HotkeyAction = entry.side === 'A' ? 'floorA' : 'floorB';
  const giveLabel = t('c.giveFloor', { side: entry.label });

  useEffect(() => {
    const el = box.current;
    let lastState = '';
    return registerTick((n) => {
      const s = getSession();
      const v = clockView(s.state, s.plan, entry.clockId, n);
      if (!v) return;
      digits.current?.write(v.remainingMs, { band: v.band, secondsOnly });
      if (fillEl.current) fillEl.current.style.height = `${v.fill * 100}%`;
      const next = ringState(v.band);
      if (el && next !== lastState) {
        lastState = next;
        el.dataset['ring'] = next;
      }
    });
  }, [entry.clockId, secondsOnly]);

  useEffect(() => {
    digits.current?.write(remaining, { band, secondsOnly, silent: true });
  }, [remaining, band, secondsOnly]);

  return (
    <div
      ref={box}
      className="ubar"
      data-side={entry.side}
      data-live={live ? '' : undefined}
      data-ring={ringState(band)}
    >
      <span className="ubar__name">{entry.label}</span>
      <span className="ubar__track" aria-hidden="true">
        <span
          ref={fillEl}
          className="ubar__fill"
          style={{ height: `${fill * 100}%` }}
        />
      </span>
      <Digits
        ref={digits}
        key={entry.clockId}
        initialMs={remaining}
        initialBand={band}
        secondsOnly={secondsOnly}
        name={entry.label}
        announce={announce}
        className="ubar__digits"
      />
      {/* One slot under the time, so the bars never jump between states. */}
      <div className="ubar__slot">
        {live ? (
          <span className="ubar__word">{t('st.floorA', { side: entry.label })}</span>
        ) : canGive ? (
          <button
            type="button"
            className="tbtn ubar__give"
            onClick={onGive}
            aria-keyshortcuts={ariaShortcut(action)}
            title={`${giveLabel} · ${shortcutText(action)}`}
          >
            <span className="tbtn__label">{giveLabel}</span>
            <Keycaps caps={capsOf(action)} />
          </button>
        ) : (
          <span className="ubar__word">{t('st.idle')}</span>
        )}
      </div>
    </div>
  );
}

export function ChessBars({
  label,
  status,
  sides,
  floor,
  awaitingFloor,
  operatorChooses,
  firstFloorLabel,
  swap,
  onSwap,
  canGiveFloor,
  onGiveFloor,
  secondsOnly,
}: ChessBarsProps): JSX.Element {
  const { t } = useLang();
  const [a, b] = sides;

  return (
    <div className="ucore ucore--chess">
      <div className="uchess">
        <SideBar
          entry={a}
          live={a.view?.running === true}
          secondsOnly={secondsOnly}
          announce={floor !== 'B'}
          canGive={canGiveFloor.A}
          onGive={() => onGiveFloor('A')}
        />

        <div className="uchess__mid">
          {/* HIDDEN, not disabled, whenever exactly one side is not running. */}
          {swap ? (
            <button type="button" className="uchess__swap" onClick={onSwap} aria-keyshortcuts="S">
              <span className="uchess__swapicon" aria-hidden="true" />
              <span className="uchess__swaplabel">{t('t.swap')}</span>
            </button>
          ) : null}
        </div>

        <SideBar
          entry={b}
          live={b.view?.running === true}
          secondsOnly={secondsOnly}
          announce={floor === 'B'}
          canGive={canGiveFloor.B}
          onGive={() => onGiveFloor('B')}
        />
      </div>

      <div className="ucore__caption">
        <p className="ucore__label">
          <span>{label}</span>
          <span className="ucore__status">{status}</span>
        </p>
        {awaitingFloor ? (
          <p className="ucore__prompt">
            {operatorChooses ? t('st.chooseSide') : t('st.takesFloor', { side: firstFloorLabel })}
          </p>
        ) : null}
      </div>
    </div>
  );
}
