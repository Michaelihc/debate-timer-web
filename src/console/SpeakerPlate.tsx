/**
 * A person, named.
 *
 * Two renderings of one idea: a rail row and the core nameplate slab. Both print the
 * NAME and the role — never a bare roster index. Under pressure an operator must not
 * have to translate "-3" into a human being, which is exactly what the original's
 * `speakerIndex` chrome made them do.
 *
 * PERIPHERY / CORE: a plate is periphery, so it may carry the side's identity colour and
 * never carries a clock-state colour.
 */

import type { JSX } from 'react';
import type { SideId } from '../domain/config';
import { useLang } from '../i18n/useLang';
import { formatTime } from '../lib/format';
import { Icon } from '../ui/Icons';

import './console.css';

export type PlateState = 'idle' | 'spoken' | 'speaking' | 'ondeck';

export interface SpeakerPlateProps {
  side: SideId;
  /** Position in that side's roster, 1-based. Always shown WITH the name, never alone. */
  ordinal?: number;
  name: string;
  role?: string;
  timeMs?: number;
  state?: PlateState;
  /** `rail` is a roster row; `plate` is the slab under the core clock. */
  variant?: 'rail' | 'plate';
  /** The live clock has expired: the on-deck caret nudges (M6). */
  urgent?: boolean;
  /** Mirror the row for the right-hand rail. */
  mirror?: boolean;
}

export function SpeakerPlate({
  side,
  ordinal,
  name,
  role,
  timeMs,
  state = 'idle',
  variant = 'rail',
  urgent = false,
  mirror = false,
}: SpeakerPlateProps): JSX.Element {
  const { t } = useLang();

  const word =
    state === 'speaking'
      ? t('c.speaking')
      : state === 'ondeck'
        ? t('st.onDeck')
        : state === 'spoken'
          ? t('c.spoken')
          : '';

  return (
    <div
      className={`plate plate--${variant}`}
      data-side={side}
      data-state={state}
      data-mirror={mirror ? '' : undefined}
    >
      <span className="plate__mark" aria-hidden="true">
        {state === 'spoken' ? <Icon name="check" size={14} /> : null}
        {state === 'ondeck' ? (
          <Icon name="caret" size={14} className={urgent ? 'm-nudge' : undefined} />
        ) : null}
      </span>
      {ordinal === undefined ? null : (
        <span className="plate__ord t-cap" aria-hidden="true">
          {ordinal}
        </span>
      )}
      <span className="plate__name">{name}</span>
      {role === undefined || role === '' ? null : <span className="plate__role t-cap">{role}</span>}
      {timeMs === undefined ? null : (
        <span className="plate__time t-meta" data-numeric="">
          {formatTime(timeMs)}
        </span>
      )}
      {word === '' ? null : <span className="sr-only">{word}</span>}
    </div>
  );
}
