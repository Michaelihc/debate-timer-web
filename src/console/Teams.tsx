/**
 * One team, facing the other across the screen.
 *
 * This is the original's `Speakers Pro` / `Speakers Con` anchor at (-300, 125) / (+300, 125):
 * a VerticalLayoutGroup column of `Speaker.prefab` figures tinted with the side colour, each
 * carrying its number, the con side mirrored so the two teams look at each other.
 * `<Debater>` is that prefab.
 *
 * The phase overlays are per-PHASE, not per-speaker, exactly as `AnimationController` does
 * it: during prep every figure holds a clipboard, during free debate every figure shows the
 * group icon, and both suppress the speech bubble and the next arrow.
 *
 * No names are printed beside the figures — the colour and the number already say who each
 * one is. The side's own name heads the column.
 */

import type { JSX } from 'react';
import type { Id, SideId, SpeakerCfg } from '../domain/config';
import { useLang } from '../i18n/useLang';
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
  /** The live clock has expired: the next figure steps up and its arrow bobs. */
  urgent: boolean;
  floor: FloorLevel;
  /** False while the round is somewhere this side is not on the clock. */
  lit: boolean;
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
}: TeamColumnProps): JSX.Element {
  const { t } = useLang();
  const stateWord: Record<DebaterState, string | null> = {
    speaking: t('c.speaking'),
    next: t('st.onDeck'),
    done: t('c.spoken'),
    idle: null,
  };

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
          const word = stateWord[state];
          return (
            <li key={sp.id} className="uteam__fig">
              <Debater
                side={side}
                index={ordinals[sp.id] ?? 0}
                srLabel={word === null ? sp.name : `${sp.name}, ${word}`}
                state={state}
                overlay={overlay}
                urgent={urgent && state === 'next'}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
