/**
 * Free debate · 自由辩论 — two facing clocks, one floor.
 *
 * Each side holds its OWN full allotment (`perSideMs` each, never one pool split in two),
 * and each side's clock keeps counting past zero. The idle side says so three ways at
 * once: smaller, desaturated, and labelled IDLE in words.
 *
 * The SWAP control does not live here. It lives in the transport row, where it appears
 * and disappears with `canSwap()` — hidden, never a dead button.
 *
 * PERIPHERY / CORE: the two nameplate strips carry identity colour; the digits and bars
 * carry clock-state colour. No element carries both.
 */

import type { JSX } from 'react';
import { useEffect, useRef } from 'react';
import type { CueSpec, SideId } from '../domain/config';
import { registerTick } from '../engine/loop';
import type { Band, ClockView } from '../engine/selectors';
import { clockView } from '../engine/selectors';
import { getSession } from '../engine/store';
import { useLang } from '../i18n/useLang';
import type { DepletionBarHandle } from '../ui/DepletionBar';
import { DepletionBar } from '../ui/DepletionBar';
import type { DigitsHandle } from '../ui/Digits';
import { Digits } from '../ui/Digits';

import './console.css';

export interface ChessSideView {
  side: SideId;
  label: string;
  clockId: string;
  allottedMs: number;
  view: ClockView | null;
}

export interface ChessCoreProps {
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
  cues: readonly CueSpec[];
  secondsOnly: boolean;
}

function SideClock({
  entry,
  live,
  idle,
  secondsOnly,
  cues,
  announce,
}: {
  entry: ChessSideView;
  live: boolean;
  idle: boolean;
  secondsOnly: boolean;
  cues: readonly CueSpec[];
  announce: boolean;
}): JSX.Element {
  const { t } = useLang();
  const digits = useRef<DigitsHandle>(null);
  const bar = useRef<DepletionBarHandle>(null);
  const clockId = entry.clockId;
  const remaining = entry.view?.remainingMs ?? entry.allottedMs;
  const band: Band = entry.view?.band ?? 'normal';

  useEffect(() => {
    return registerTick((n) => {
      const s = getSession();
      const view = clockView(s.state, s.plan, clockId, n);
      if (!view) return;
      digits.current?.write(view.remainingMs, { band: view.band, secondsOnly });
      bar.current?.write(view.remainingMs, view.band);
    });
  }, [clockId, secondsOnly]);

  useEffect(() => {
    digits.current?.write(remaining, { band, secondsOnly, silent: true });
    bar.current?.write(remaining, band);
  }, [remaining, band, secondsOnly]);

  return (
    <section className="chess__side" data-side={entry.side} data-idle={idle ? '' : undefined}>
      <h3 className="chess__plate t-cap" data-side={entry.side}>
        {entry.label}
      </h3>
      <div className="chess__digits">
        <Digits
          ref={digits}
          key={clockId}
          initialMs={remaining}
          initialBand={band}
          secondsOnly={secondsOnly}
          scale="console"
          name={entry.label}
          announce={announce}
        />
      </div>
      <DepletionBar
        ref={bar}
        key={`bar-${clockId}`}
        allottedMs={entry.allottedMs}
        cues={cues}
        initialRemainingMs={remaining}
        initialBand={band}
        variant="console"
      />
      <p className="chess__word t-cap">{live ? t('st.running') : t('st.idle')}</p>
    </section>
  );
}

export function ChessCore({
  label,
  status,
  sides,
  floor,
  awaitingFloor,
  operatorChooses,
  firstFloorLabel,
  cues,
  secondsOnly,
}: ChessCoreProps): JSX.Element {
  const { t } = useLang();
  const [a, b] = sides;
  const floorLabel = floor === 'A' ? a.label : floor === 'B' ? b.label : '';

  return (
    <div className="core core--chess" data-band="normal">
      <div className="core__head">
        <h2 className="core__label t-cap">{label}</h2>
        <span className="core__status t-cap">{status}</span>
      </div>

      <div className="chess">
        <SideClock
          entry={a}
          live={a.view?.running === true}
          idle={floor !== 'A'}
          secondsOnly={secondsOnly}
          cues={cues}
          announce={floor === 'A'}
        />
        <SideClock
          entry={b}
          live={b.view?.running === true}
          idle={floor !== 'B'}
          secondsOnly={secondsOnly}
          cues={cues}
          announce={floor === 'B'}
        />
      </div>

      <p className="chess__floor t-ctl">
        {awaitingFloor
          ? operatorChooses
            ? t('st.chooseSide')
            : t('st.takesFloor', { side: firstFloorLabel })
          : t('st.floorA', { side: floorLabel })}
      </p>
    </div>
  );
}
