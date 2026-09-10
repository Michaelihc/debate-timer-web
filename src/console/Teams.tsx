/**
 * One team, facing the other across the screen.
 *
 * This is the original's `Speakers Pro` / `Speakers Con` anchor at (-300, 125) / (+300, 125):
 * a row of `Speaker.prefab` figures tinted with the side colour, each carrying its number,
 * the con side mirrored so the two teams look at each other. `<Debater>` is that prefab.
 *
 * The phase overlays are per-PHASE, not per-speaker, exactly as `AnimationController` does
 * it: during prep every figure holds a clipboard, during free debate every figure shows the
 * group icon, and both suppress the speech bubble and the next arrow.
 *
 * The prep bank stays here as a real control — the original had no such thing, and losing
 * it to a repaint would cost the operator a capability.
 */

import type { JSX } from 'react';
import { useEffect, useRef } from 'react';
import type { Id, SideId, SpeakerCfg } from '../domain/config';
import { registerTick } from '../engine/loop';
import { bankRemaining } from '../engine/selectors';
import { getSession } from '../engine/store';
import { useLang } from '../i18n/useLang';
import { formatTime } from '../lib/format';
import type { DebaterOverlay, DebaterState } from '../ui/unity/Debater';
import { Debater } from '../ui/unity/Debater';

import './console.css';

/** How lit this side's floor bar is: running, holding, or nothing. */
export type FloorLevel = 'on' | 'half' | 'off';

export interface TeamColumnProps {
  side: SideId;
  /** The side's own name, resolved in the live language. */
  label: string;
  speakers: readonly SpeakerCfg[];
  /** Their roster numbers, 1-based within this side. */
  ordinals: Record<Id, number>;
  /** The speaker on the clock right now, if they are on this side. */
  speakingId: Id | null;
  /** The next speaker anywhere ahead in the run order. */
  onDeckId: Id | null;
  /** Everyone who has already had the floor at least once. History, never a warning. */
  spokenIds: ReadonlySet<Id>;
  /** Applied to EVERY figure, as the original does. */
  overlay: DebaterOverlay;
  /** The live clock has expired: the next arrow starts its 1s bob (NextFlash.anim). */
  urgent: boolean;
  floor: FloorLevel;
  /** False while the round is somewhere this side is not on the clock. */
  lit: boolean;
  hasBank: boolean;
  bankMs: number;
  drawing: boolean;
  onDrawBank: () => void;
}

export function TeamColumn({
  side,
  label,
  speakers,
  ordinals,
  speakingId,
  onDeckId,
  spokenIds,
  overlay,
  urgent,
  floor,
  lit,
  hasBank,
  bankMs,
  drawing,
  onDrawBank,
}: TeamColumnProps): JSX.Element {
  const { t } = useLang();
  const bankEl = useRef<HTMLSpanElement>(null);
  const bankBox = useRef<HTMLButtonElement>(null);

  // The bank ticks like any other clock while it is drawn, so the frame loop paints it.
  useEffect(() => {
    if (!hasBank) return undefined;
    let lastText = '';
    let lastOver = false;
    return registerTick((n) => {
      const s = getSession();
      const ms = bankRemaining(s.state, s.plan, side, n);
      const text = formatTime(ms);
      if (text !== lastText) {
        lastText = text;
        if (bankEl.current) bankEl.current.textContent = text;
      }
      const over = ms < 0;
      if (over !== lastOver) {
        lastOver = over;
        const box = bankBox.current;
        if (box) {
          if (over) box.dataset['over'] = '';
          else delete box.dataset['over'];
        }
      }
    });
  }, [side, hasBank]);

  return (
    <section className="uteam" data-side={side} data-lit={lit ? '' : undefined} aria-label={label}>
      <h2 className="uteam__name">{label}</h2>
      <span className="uteam__floor" data-floor={floor} aria-hidden="true" />

      <ul className="uteam__figs" aria-label={t('c.roster', { side: label })}>
        {speakers.map((sp) => {
          const state: DebaterState =
            sp.id === speakingId
              ? 'speaking'
              : sp.id === onDeckId
                ? 'next'
                : spokenIds.has(sp.id)
                  ? 'done'
                  : 'idle';
          return (
            <li key={sp.id} className="uteam__fig">
              <Debater
                side={side}
                index={ordinals[sp.id] ?? 0}
                name={sp.name}
                state={state}
                overlay={overlay}
                urgent={urgent && state === 'next'}
              />
            </li>
          );
        })}
      </ul>

      {hasBank ? (
        <button
          ref={bankBox}
          type="button"
          className="uteam__bank"
          data-drawing={drawing ? '' : undefined}
          onClick={onDrawBank}
          aria-pressed={drawing}
          aria-label={t('c.drawBank', { side: label })}
          aria-keyshortcuts={side === 'A' ? 'Q' : 'W'}
        >
          <span className="uteam__banklabel">{t('st.prepBank')}</span>
          <span ref={bankEl} className="uteam__banktime" data-numeric="">
            {formatTime(bankMs)}
          </span>
        </button>
      ) : null}
    </section>
  );
}
