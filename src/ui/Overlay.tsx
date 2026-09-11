/**
 * The overlay primitive: a portal, a focus trap, Esc to dismiss, focus returned to the
 * control that opened it (§13.3).
 *
 * Overlays stack, and Esc only ever closes the TOP one — a module-level stack, not a
 * per-overlay listener, is what makes that true when the share sheet is open over the
 * editor over the console.
 */

import type { JSX, ReactNode, RefObject } from 'react';
import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLang } from '../i18n/useLang';
import { Icon } from './Icons';
import { isTopOverlay, pushOverlay, removeOverlay } from './overlayStack';

import './ui.css';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface OverlayProps {
  open: boolean;
  onClose: () => void;
  /** Rendered as the dialog's heading and used as its accessible name. */
  title?: string;
  /** Use instead of `title` when the heading is drawn by the children. */
  labelledBy?: string;
  describedBy?: string;
  size?: 'sm' | 'md' | 'lg' | 'full';
  /** Default true. */
  closeOnBackdrop?: boolean;
  /** Default true; a legend that closes on any key sets it and handles its own keys. */
  showClose?: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
}

export function Overlay({
  open,
  onClose,
  title,
  labelledBy,
  describedBy,
  size = 'md',
  closeOnBackdrop = true,
  showClose = true,
  initialFocus,
  className,
  children,
}: OverlayProps): JSX.Element | null {
  const { t } = useLang();
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const headingId = useId();
  const onCloseRef = useRef(onClose);
  // Committed, not written during render — an abandoned render must not install a stale
  // (or never-mounted) close handler for the Esc listener below to reach.
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const token = Symbol('overlay');
    pushOverlay(token);
    restoreTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusFirst = (): void => {
      const target =
        initialFocus?.current ??
        panel.current?.querySelector<HTMLElement>(FOCUSABLE) ??
        panel.current;
      target?.focus();
    };
    const frame = requestAnimationFrame(focusFirst);

    const onKeyDown = (e: KeyboardEvent): void => {
      if (!isTopOverlay(token)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const nodes = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (nodes.length === 0) {
        e.preventDefault();
        panel.current.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown, true);
      removeOverlay(token);
      restoreTo.current?.focus();
    };
  }, [open, initialFocus]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="overlay"
      onPointerDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className={
          className === undefined ? `overlay__panel overlay__panel--${size}` : `overlay__panel overlay__panel--${size} ${className}`
        }
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy ?? (title === undefined ? undefined : headingId)}
        aria-describedby={describedBy}
        tabIndex={-1}
      >
        {title === undefined ? null : (
          <div className="overlay__head">
            <h2 id={headingId} className="t-read overlay__title">
              {title}
            </h2>
            {showClose ? (
              <button type="button" className="overlay__close" onClick={onClose}>
                <Icon name="close" title={t('ed.close')} />
              </button>
            ) : null}
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
