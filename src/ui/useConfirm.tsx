/**
 * `const { ask, dialog } = useConfirm();` — the promise-shaped wrapper around `Confirm`.
 *
 * It lives apart from `Confirm.tsx` so that file exports components and nothing else.
 */

import type { JSX, ReactNode } from 'react';
import { useCallback, useRef, useState } from 'react';
import { Confirm } from './Confirm';

export interface ConfirmRequest {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  hold?: boolean;
}

export interface ConfirmApi {
  /** Resolves true on confirm, false on cancel or Esc. */
  ask: (request: ConfirmRequest) => Promise<boolean>;
  /** Render this somewhere inside the screen. */
  dialog: JSX.Element | null;
}

/**
 * `const { ask, dialog } = useConfirm();` then `if (await ask({ title })) …`.
 * One dialog per screen; the promise is the whole API.
 */
export function useConfirm(): ConfirmApi {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const ask = useCallback((next: ConfirmRequest): Promise<boolean> => {
    resolver.current?.(false);
    setRequest(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((ok: boolean): void => {
    const resolve = resolver.current;
    resolver.current = null;
    setRequest(null);
    resolve?.(ok);
  }, []);

  const dialog =
    request === null ? null : (
      <Confirm
        open
        title={request.title}
        body={request.body}
        confirmLabel={request.confirmLabel}
        cancelLabel={request.cancelLabel}
        tone={request.tone}
        hold={request.hold}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    );

  return { ask, dialog };
}
