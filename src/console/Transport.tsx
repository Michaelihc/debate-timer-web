/**
 * The timer controls under the ring — and only the timer controls.
 *
 * The Unity scene puts exactly two buttons here, a blue Pause and a coral Reset, and this
 * row keeps that pair as its loud half. Under it sit the ±15s nudges and, quieter still,
 * Pause round. Moving between segments is not a timer control: Back and Next live on the
 * timeline strip, beside the green ▶▶ the original had there.
 *
 * An enabled button always does what its label says. ±15s is live exactly when there is a
 * clock to nudge and the round is not held (the console asks the reducer); Reset is live
 * whenever a segment is loaded and the round is not held. A clock at or past zero changes
 * none of that: the human decides when a speech is over.
 *
 * Reset is one click, like the original's Reset button: no press-and-hold, no confirm.
 *
 * SWAP and the give-floor buttons are not here. They live with the free-debate bars they
 * act on, and are HIDDEN — not disabled — whenever they could not act.
 */

import type { JSX } from 'react';
import type { HotkeyAction } from '../app/hotkeys';
import { ariaShortcut, capsOf, shortcutText } from '../app/hotkeys';
import type { RoundPhase } from '../engine/selectors';
import type { Transport as TransportState } from '../engine/state';
import { useLang } from '../i18n/useLang';
import type { IconName } from '../ui/Icons';
import { Icon } from '../ui/Icons';
import { Keycaps } from '../ui/KeyLegendOverlay';

import './console.css';

export interface TransportHandlers {
  /** Start, pause or resume: Space, in every kind of segment. */
  toggle: () => void;
  reset: () => void;
  hold: () => void;
  adjust: (deltaMs: number) => void;
}

export interface TransportProps {
  phase: RoundPhase;
  transport: TransportState;
  hold: boolean;
  /** Space is inert until a side is picked (`firstFloor: 'operator'`). */
  canStart: boolean;
  /** There is a clock for ±15s to act on, and the round is not held. */
  canAdjust: boolean;
  /** A segment is loaded and the round is not held. */
  canReset: boolean;
  on: TransportHandlers;
}

const STEP_MS = 15_000;

type Tone = 'primary' | 'reset' | 'step' | 'quiet';

function Key({
  onClick,
  icon,
  label,
  action,
  tone,
  caps = false,
  disabled = false,
}: {
  onClick: () => void;
  icon: IconName;
  label: string;
  action: HotkeyAction;
  tone: Tone;
  /** Print the keycaps on the face. Only the loud pair does. */
  caps?: boolean;
  disabled?: boolean;
}): JSX.Element {
  const small = tone === 'step' || tone === 'quiet';
  return (
    <button
      type="button"
      className={`tbtn tbtn--${tone}`}
      onClick={onClick}
      disabled={disabled}
      aria-keyshortcuts={ariaShortcut(action)}
      title={`${label} · ${shortcutText(action)}`}
    >
      <Icon name={icon} size={small ? 14 : 18} />
      <span className="tbtn__label">{label}</span>
      {caps ? <Keycaps caps={capsOf(action)} /> : null}
    </button>
  );
}

export function Transport({
  phase,
  transport,
  hold,
  canStart,
  canAdjust,
  canReset,
  on,
}: TransportProps): JSX.Element {
  const { t } = useLang();
  const running = transport === 'running';
  const complete = phase === 'complete';

  const mainLabel = hold
    ? t('t.release')
    : phase === 'pre'
      ? t('t.startRound')
      : running
        ? t('t.pause')
        : transport === 'paused'
          ? t('t.resume')
          : t('t.start');

  const mainIcon: IconName = hold ? 'hold' : running ? 'pause' : 'play';
  // While held the one thing the round accepts is its release, so that is what the
  // primary button does, in free debate too.
  const onMain = hold ? on.hold : on.toggle;
  // The keycap on the button is the key that does what the button does right now.
  const mainKeys: HotkeyAction = hold ? 'hold' : 'toggle';

  return (
    <div className="transport" role="group" aria-label={t('nav.console')}>
      <div className="transport__main">
        <Key
          onClick={onMain}
          icon={mainIcon}
          label={mainLabel}
          action={mainKeys}
          tone="primary"
          caps
          disabled={!hold && (complete || !canStart)}
        />
        <Key
          onClick={on.reset}
          icon="reset"
          label={t('t.reset')}
          action="reset"
          tone="reset"
          caps
          disabled={!canReset}
        />
      </div>

      <div className="transport__aux">
        <Key
          onClick={() => on.adjust(-STEP_MS)}
          icon="minus"
          label={t('t.minus15')}
          action="minus15"
          tone="step"
          disabled={!canAdjust}
        />
        <Key
          onClick={() => on.adjust(STEP_MS)}
          icon="plus"
          label={t('t.plus15')}
          action="plus15"
          tone="step"
          disabled={!canAdjust}
        />
        {/* While the round is held, the primary button above is the one that resumes it;
            a second button with the same words would only ask which one to press. */}
        {hold ? null : (
          <>
            <span className="transport__rule" aria-hidden="true" />
            <Key onClick={on.hold} icon="hold" label={t('t.hold')} action="hold" tone="quiet" />
          </>
        )}
      </div>
    </div>
  );
}
