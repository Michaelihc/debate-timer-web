/**
 * The transport row. Always visible, and every control stays live at and past zero.
 *
 * The original hid START, PAUSE *and* RESUME the instant a clock reached zero, stranding
 * the operator during exactly the grace-period overrun that every format tolerates. Here
 * a clock at zero keeps counting up and every button keeps working: the human decides
 * when a speech is over.
 *
 * BACK is a first-class control sitting next to ADVANCE, not an item in a menu. Going
 * backwards is a normal thing to do at a debate.
 *
 * SWAP is HIDDEN — not disabled — whenever `canSwap()` is false, so the control and its
 * keybinding appear and disappear together and it can never render as a button that
 * silently does nothing.
 */

import type { JSX, ReactNode } from 'react';
import type { SideId } from '../domain/config';
import type { Chord, HotkeyAction } from '../app/hotkeys';
import { bindingOf, capsOf } from '../app/hotkeys';
import type { RoundPhase } from '../engine/selectors';
import type { Transport as TransportState } from '../engine/state';
import { useLang } from '../i18n/useLang';
import { HoldButton } from '../ui/HoldButton';
import type { IconName } from '../ui/Icons';
import { Icon } from '../ui/Icons';
import { Keycaps } from '../ui/KeyLegendOverlay';

import './console.css';

export interface TransportHandlers {
  toggle: () => void;
  togglePause: () => void;
  advance: () => void;
  prev: () => void;
  reset: () => void;
  hold: () => void;
  swap: () => void;
  adjust: (deltaMs: number) => void;
  floor: (side: SideId) => void;
  undo: () => void;
  redo: () => void;
}

export interface TransportProps {
  phase: RoundPhase;
  transport: TransportState;
  hold: boolean;
  chess: boolean;
  /** `canSwap(state, plan)`. False hides the SWAP control outright. */
  swap: boolean;
  /** Space is inert until a side is picked (`firstFloor: 'operator'`). */
  canStart: boolean;
  sideLabels: Record<SideId, string>;
  canPrev: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** 0..1 while R is held on the keyboard, so both routes drive one arc. */
  resetProgress: number;
  on: TransportHandlers;
}

const STEP_MS = 15_000;

const APPLE = /Mac|iPhone|iPad|iPod/i;

/** `aria-keyshortcuts` wants real key names joined by `+`, not the legend's glyphs. */
function ariaShortcut(action: HotkeyAction): string | undefined {
  const chord: Chord | undefined = bindingOf(action)?.chords[0];
  if (!chord) return undefined;
  const parts: string[] = [];
  if (chord.mod === true) {
    const apple =
      typeof navigator !== 'undefined' && APPLE.test(navigator.platform || navigator.userAgent);
    parts.push(apple ? 'Meta' : 'Control');
  }
  if (chord.shift === true) parts.push('Shift');
  if (chord.alt === true) parts.push('Alt');
  parts.push(chord.key === ' ' ? 'Space' : chord.key.length === 1 ? chord.key.toUpperCase() : chord.key);
  return parts.join('+');
}

function Cap({ action }: { action: HotkeyAction }): JSX.Element {
  return <Keycaps caps={capsOf(action)} />;
}

function Key({
  onClick,
  icon,
  label,
  action,
  primary = false,
  disabled = false,
  hint,
}: {
  onClick: () => void;
  icon?: IconName;
  label: string;
  action?: HotkeyAction;
  primary?: boolean;
  disabled?: boolean;
  hint?: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      className={primary ? 'tbtn tbtn--primary' : 'tbtn'}
      onClick={onClick}
      disabled={disabled}
      aria-keyshortcuts={action === undefined ? undefined : ariaShortcut(action)}
    >
      {icon === undefined ? null : <Icon name={icon} size={18} />}
      <span className="tbtn__label">{label}</span>
      {hint ?? (action === undefined ? null : <Cap action={action} />)}
    </button>
  );
}

export function Transport({
  phase,
  transport,
  hold,
  chess,
  swap,
  canStart,
  sideLabels,
  canPrev,
  canUndo,
  canRedo,
  resetProgress,
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

  return (
    <div className="transport" role="group" aria-label={t('nav.console')}>
      <div className="transport__main">
        <Key
          onClick={on.prev}
          icon="prev"
          label={t('t.back')}
          action="prev"
          disabled={!canPrev}
        />

        {chess ? (
          <>
            <Key
              onClick={() => on.floor('A')}
              icon="prev"
              label={t('c.giveFloor', { side: sideLabels.A })}
              action="floorA"
            />
            {/* HIDDEN, not disabled, whenever exactly one side is not running. */}
            {swap ? (
              <Key
                onClick={on.swap}
                icon="swap"
                label={t('t.swap')}
                action="swap"
                hint={<Keycaps caps={[...capsOf('toggle'), ...capsOf('swap')]} />}
                primary
              />
            ) : null}
            <Key
              onClick={() => on.floor('B')}
              icon="next"
              label={t('c.giveFloor', { side: sideLabels.B })}
              action="floorB"
            />
            <Key
              onClick={on.togglePause}
              icon={mainIcon}
              label={mainLabel}
              action="togglePause"
              primary={!swap}
              disabled={!canStart && !hold}
            />
          </>
        ) : (
          <Key
            onClick={hold ? on.hold : on.toggle}
            icon={mainIcon}
            label={mainLabel}
            action={hold ? 'hold' : 'toggle'}
            primary
            disabled={complete || (!canStart && !hold)}
          />
        )}

        <Key
          onClick={on.advance}
          icon="next"
          label={t('t.next')}
          action="advance"
          disabled={complete}
        />
      </div>

      <div className="transport__aux">
        <Key
          onClick={() => on.adjust(-STEP_MS)}
          icon="minus"
          label={t('t.minus15')}
          action="minus15"
        />
        <Key
          onClick={() => on.adjust(STEP_MS)}
          icon="plus"
          label={t('t.plus15')}
          action="plus15"
        />

        <HoldButton
          className="tbtn--hold"
          onConfirm={on.reset}
          description={t('t.resetHold')}
          progress={resetProgress}
          tone="danger"
        >
          <span className="tbtn__label">{t('t.reset')}</span>
          <Cap action="reset" />
        </HoldButton>

        <Key
          onClick={on.hold}
          icon="hold"
          label={hold ? t('t.release') : t('t.hold')}
          action="hold"
        />

        <Key onClick={on.undo} icon="undo" label={t('t.undo')} action="undo" disabled={!canUndo} />
        <Key onClick={on.redo} icon="redo" label={t('t.redo')} action="redo" disabled={!canRedo} />
      </div>
    </div>
  );
}
