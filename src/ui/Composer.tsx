/**
 * Adding to the run order: one plainly labelled button per thing that can be added.
 *
 * Every speaker on the roster, then the four phases — preparation, free debate, a shared
 * clock, a break. A click appends one segment to the END of the order and does nothing
 * else. Nothing here reorders, completes, suggests or deduplicates: pressing 正一 three
 * times is three speeches by the same debater, and that is a run order the operator may
 * well mean to build.
 */

import type { JSX, Ref } from 'react';
import { useId } from 'react';
import type { Id, RoundConfig, SegmentKind, SideId } from '../domain/config';
import { KIND_LABELS } from '../domain/plan';
import { formatTime } from '../lib/format';
import { useLang } from '../i18n/useLang';

import '../screens/editor.css';

export type ComposerPick =
  | { kind: 'speech'; speakerId: Id }
  | { kind: 'prep' }
  | { kind: 'chess' }
  | { kind: 'shared' }
  | { kind: 'break' };

export interface ComposerProps {
  config: RoundConfig;
  onAppend: (pick: ComposerPick) => void;
  secondsOnly: boolean;
  /** Receives the first button, so ⌘K has somewhere to land. */
  firstRef?: Ref<HTMLButtonElement>;
}

type Phase = Exclude<SegmentKind, 'speech'>;

const PHASES: readonly Phase[] = ['prep', 'chess', 'shared', 'break'];

function phasePick(kind: Phase): ComposerPick {
  switch (kind) {
    case 'prep':
      return { kind: 'prep' };
    case 'chess':
      return { kind: 'chess' };
    case 'shared':
      return { kind: 'shared' };
    case 'break':
      return { kind: 'break' };
  }
}

export function Composer({ config, onAppend, secondsOnly, firstRef }: ComposerProps): JSX.Element {
  const { t, lang, l10n } = useLang();
  const headId = useId();

  const seen: Record<SideId, number> = { A: 0, B: 0 };
  const speakers = config.speakers.map((speaker) => {
    const side = speaker.side === 'A' ? config.sides[0] : config.sides[1];
    seen[speaker.side] += 1;
    const name = speaker.name.trim();
    return {
      speaker,
      color: side.color,
      // An unnamed speaker is still addressable: "Proposition 3", never a blank button.
      text: name === '' ? `${l10n(side.label)} ${seen[speaker.side]}` : name,
      detail: [l10n(speaker.role), formatTime(speaker.defaultMs, { secondsOnly })]
        .filter((part) => part !== '')
        .join(' · '),
    };
  });

  return (
    <div className="adder" role="group" aria-labelledby={headId}>
      <span id={headId} className="adder__label t-meta">
        {t('ed.addTo')}
      </span>
      <ul className="adder__list">
        {speakers.map(({ speaker, color, text, detail }, i) => (
          <li
            key={speaker.id}
            className={
              i > 0 && speaker.side !== speakers[i - 1]?.speaker.side ? 'adder__item adder__item--gap' : 'adder__item'
            }
          >
            <button
              ref={i === 0 ? firstRef : undefined}
              type="button"
              className="adder__btn"
              style={{ borderLeftColor: color }}
              title={detail}
              onClick={() => onAppend({ kind: 'speech', speakerId: speaker.id })}
            >
              {text}
            </button>
          </li>
        ))}
        {PHASES.map((kind, i) => (
          <li
            key={kind}
            className={i === 0 && speakers.length > 0 ? 'adder__item adder__item--phases' : 'adder__item'}
          >
            <button
              ref={i === 0 && speakers.length === 0 ? firstRef : undefined}
              type="button"
              className="adder__btn adder__btn--phase"
              onClick={() => onAppend(phasePick(kind))}
            >
              {KIND_LABELS[kind][lang]}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
