/**
 * The confirm dialog, built on `Overlay`.
 *
 * There are exactly three of these in the app (§3.13): leave a live round, apply a preset
 * over a live round, delete a saved sheet. Everything else either happens or is undoable,
 * and a dialog that asks about a reversible action just trains the operator to dismiss
 * dialogs without reading them.
 *
 * Where the choice is between two clock values — the sleep-reconcile prompt — the numbers
 * go ON the buttons. The operator chooses between values, not between words.
 */

import type { JSX, ReactNode } from 'react';
import { useRef } from 'react';
import { useLang } from '../i18n/useLang';
import { HoldButton } from './HoldButton';
import { Overlay } from './Overlay';

import './ui.css';

export interface ConfirmProps {
  open: boolean;
  title: string;
  body?: ReactNode;
  /** Defaults to `d.confirm`. */
  confirmLabel?: string;
  /** Defaults to `d.cancel`. */
  cancelLabel?: string;
  /** A third choice, for "save mine and open theirs". */
  altLabel?: string;
  onAlt?: () => void;
  tone?: 'default' | 'danger';
  /** Require a 600ms hold on the confirm button. */
  hold?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function Confirm({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  altLabel,
  onAlt,
  tone = 'default',
  hold = false,
  onConfirm,
  onCancel,
}: ConfirmProps): JSX.Element | null {
  const { t } = useLang();
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Overlay
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      showClose={false}
      initialFocus={cancelRef}
      className="confirm"
    >
      {body === undefined ? null : <div className="t-ctl confirm__body">{body}</div>}
      <div className="confirm__actions">
        <button type="button" ref={cancelRef} className="btn" onClick={onCancel}>
          {cancelLabel ?? t('d.cancel')}
        </button>
        {altLabel === undefined ? null : (
          <button type="button" className="btn" onClick={onAlt}>
            {altLabel}
          </button>
        )}
        {hold ? (
          <HoldButton
            tone={tone}
            className="btn btn--primary"
            onConfirm={onConfirm}
            description={t('t.resetHold')}
          >
            {confirmLabel ?? t('d.confirm')}
          </HoldButton>
        ) : (
          <button
            type="button"
            className={tone === 'danger' ? 'btn btn--danger' : 'btn btn--primary'}
            onClick={onConfirm}
          >
            {confirmLabel ?? t('d.confirm')}
          </button>
        )}
      </div>
    </Overlay>
  );
}

/* --------------------------------------------------------------- imperative use */
