/**
 * One neutral clock: cross-examination, crossfire, grand crossfire, prep, a break.
 *
 * Every participating speaker's plate is lit at once — grand crossfire lights all four —
 * because during a shared clock nobody "has" the time and the operator needs to see who
 * is entitled to speak, not who is on a countdown.
 */

import type { JSX } from 'react';
import type { CueSpec, SideId, SpeakerCfg } from '../domain/config';
import type { Band } from '../engine/selectors';
import type { ClockId, Transport } from '../engine/state';
import { useLang } from '../i18n/useLang';

import { CoreClock } from './CoreClock';
import { SpeakerPlate } from './SpeakerPlate';
import './console.css';

export interface SharedCoreProps {
  clockId: ClockId;
  allottedMs: number;
  remainingMs: number;
  band: Band;
  transport: Transport;
  cues: readonly CueSpec[];
  label: string;
  status: string;
  secondsOnly: boolean;
  armed: boolean;
  /** Everyone the segment names, in roster order. Empty for prep and breaks. */
  participants: readonly SpeakerCfg[];
  /** Sides on the clock, for a prep or break block that names no speakers. */
  sides: readonly SideId[];
  sideLabels: Record<SideId, string>;
  /** Resolved role text per speaker id, in the live language. */
  roleOf: (speaker: SpeakerCfg) => string;
}

export function SharedCore({
  clockId,
  allottedMs,
  remainingMs,
  band,
  transport,
  cues,
  label,
  status,
  secondsOnly,
  armed,
  participants,
  sides,
  sideLabels,
  roleOf,
}: SharedCoreProps): JSX.Element {
  const { t } = useLang();

  return (
    <CoreClock
      clockId={clockId}
      allottedMs={allottedMs}
      remainingMs={remainingMs}
      band={band}
      transport={transport}
      cues={cues}
      label={label}
      status={status}
      secondsOnly={secondsOnly}
      armed={armed}
    >
      {participants.length > 0 ? (
        <div className="core__plates" aria-label={t('ed.participants')}>
          {participants.map((sp) => (
            <SpeakerPlate
              key={sp.id}
              side={sp.side}
              name={sp.name}
              role={roleOf(sp)}
              state="speaking"
              variant="plate"
            />
          ))}
        </div>
      ) : (
        <div className="core__plates" aria-label={t('ed.liveSides')}>
          {sides.length === 0 ? (
            <p className="core__neutral t-ctl">{label}</p>
          ) : (
            sides.map((side) => (
              <SpeakerPlate
                key={side}
                side={side}
                name={sideLabels[side]}
                role={label}
                state="speaking"
                variant="plate"
              />
            ))
          )}
        </div>
      )}
    </CoreClock>
  );
}
