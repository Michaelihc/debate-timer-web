/**
 * One team's rail: floor bar, roster, prep bank.
 *
 * PERIPHERY / CORE — this whole component is periphery. Identity colour lives here (the
 * 10px floor bar, the inverted row of whoever is speaking, the side heading) and clock
 * state colour never does. The bank readout in overtime uses `--danger`, the token for
 * overrun figures on console chrome, not the core's `--state-over`.
 *
 * Side identity is encoded three times over: position (A is the left rail, B the right),
 * the side's own name in words, and the colour. Greyscale loses nothing.
 */

import type { JSX } from 'react';
import { useEffect, useRef } from 'react';
import type { Id, SideId, SpeakerCfg } from '../domain/config';
import { registerTick } from '../engine/loop';
import { bankRemaining } from '../engine/selectors';
import { getSession } from '../engine/store';
import { useLang } from '../i18n/useLang';
import { formatTime } from '../lib/format';

import { SpeakerPlate } from './SpeakerPlate';
import './console.css';

export type FloorLevel = 'on' | 'half' | 'off';

export interface SideRailProps {
  side: SideId;
  /** The side's own name, resolved in the live language. */
  label: string;
  speakers: readonly SpeakerCfg[];
  /** The speaker on the clock right now, if they are on this side. */
  speakingId: Id | null;
  /** The next speaker anywhere ahead in the run order, from `onDeck()`. */
  onDeckId: Id | null;
  /** Everyone who has already had the floor at least once. Never a warning — history. */
  spokenIds: ReadonlySet<Id>;
  floor: FloorLevel;
  /** False while the round is somewhere this side is not on the clock. */
  lit: boolean;
  /** True while this side's bank is the clock that is running. */
  drawing: boolean;
  hasBank: boolean;
  bankMs: number;
  onDrawBank: () => void;
  /** The on-deck caret nudges once the live clock has expired. */
  urgent: boolean;
}

export function SideRail({
  side,
  label,
  speakers,
  speakingId,
  onDeckId,
  spokenIds,
  floor,
  lit,
  drawing,
  hasBank,
  bankMs,
  onDrawBank,
  urgent,
}: SideRailProps): JSX.Element {
  const { t } = useLang();
  const bankEl = useRef<HTMLSpanElement>(null);
  const bankBox = useRef<HTMLButtonElement>(null);

  // The bank ticks like any other clock while it is being drawn, so it is painted by the
  // frame loop rather than by a render.
  useEffect(() => {
    if (!hasBank) return undefined;
    let lastText = '';
    let lastOver = false;
    return registerTick((n) => {
      const s = getSession();
      const ms = bankRemaining(s.state, s.plan, side, n);
      const over = ms < 0;
      const text = formatTime(ms);
      if (text !== lastText) {
        lastText = text;
        if (bankEl.current) bankEl.current.textContent = text;
      }
      if (over !== lastOver) {
        lastOver = over;
        if (bankBox.current) {
          if (over) bankBox.current.dataset['over'] = '';
          else delete bankBox.current.dataset['over'];
        }
      }
    });
  }, [side, hasBank]);

  return (
    <aside className="rail" data-side={side} data-lit={lit ? '' : undefined} aria-label={label}>
      <span className="rail__floor" data-floor={floor} aria-hidden="true" />
      <div className="rail__body">
        <h2 className="rail__head t-cap">{label}</h2>
        {floor === 'on' ? (
          <p className="rail__floorword t-cap">{t('st.floorA', { side: label })}</p>
        ) : null}
        <ul className="rail__list">
          {speakers.map((sp, i) => {
            const state =
              sp.id === speakingId
                ? 'speaking'
                : sp.id === onDeckId
                  ? 'ondeck'
                  : spokenIds.has(sp.id)
                    ? 'spoken'
                    : 'idle';
            return (
              <li key={sp.id} className="rail__row">
                <SpeakerPlate
                  side={side}
                  ordinal={i + 1}
                  name={sp.name}
                  timeMs={sp.defaultMs}
                  state={state}
                  urgent={urgent}
                  mirror={side === 'B'}
                />
              </li>
            );
          })}
        </ul>
        {hasBank ? (
          <button
            ref={bankBox}
            type="button"
            className="rail__bank"
            data-drawing={drawing ? '' : undefined}
            onClick={onDrawBank}
            aria-pressed={drawing}
            aria-label={t('c.drawBank', { side: label })}
            aria-keyshortcuts={side === 'A' ? 'Q' : 'W'}
          >
            <span className="t-cap">{t('st.prepBank')}</span>
            <span ref={bankEl} className="rail__banktime t-meta" data-numeric="">
              {formatTime(bankMs)}
            </span>
          </button>
        ) : null}
      </div>
    </aside>
  );
}
