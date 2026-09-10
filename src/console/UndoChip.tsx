/**
 * §7.14 — an ADVANCE raises a four-second chip that names the segment it landed on and
 * points at undo. Feedback, not a confirmation dialog: the operator is never stopped to
 * answer a question about a move they have already made and can reverse in one keystroke.
 */

import type { JSX } from 'react';
import { useEffect } from 'react';
import { useLang } from '../i18n/useLang';
import { Icon } from '../ui/Icons';

import './console.css';

export const UNDO_CHIP_MS = 4000;

export interface UndoChipProps {
  /** The segment just advanced to, by name. Null hides the chip. */
  name: string | null;
  onUndo: () => void;
  onExpire: () => void;
}

export function UndoChip({ name, onUndo, onExpire }: UndoChipProps): JSX.Element | null {
  useEffect(() => {
    if (name === null) return undefined;
    const id = window.setTimeout(onExpire, UNDO_CHIP_MS);
    return () => {
      window.clearTimeout(id);
    };
    // A second advance restarts the countdown, which is why `name` is a dependency.
  }, [name, onExpire]);

  const { t } = useLang();
  if (name === null) return null;

  return (
    <div className="undochip" role="status">
      <span className="undochip__text t-meta">{t('t.undoAdvance', { name })}</span>
      <button type="button" className="undochip__btn t-cap" onClick={onUndo}>
        <Icon name="undo" size={14} />
        {t('t.undo')}
      </button>
    </div>
  );
}
