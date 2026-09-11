/**
 * The `?` overlay. It renders `KEYMAP` directly, so a binding cannot exist without a
 * legend row and a legend row cannot lie about a binding.
 *
 * It speaks the interface's language, like every other screen, and prints each binding
 * once. Esc is a binding like the rest, so it is a row, not a second footer line.
 */

import type { JSX } from 'react';
import type { HotkeyContext, KeyBinding } from '../app/hotkeys';
import { bindingsForGroup, capsOf, displayCaps } from '../app/hotkeys';
import { useLang } from '../i18n/useLang';
import { Overlay } from './Overlay';

import './ui.css';

export interface KeyLegendOverlayProps {
  open: boolean;
  onClose: () => void;
  /** Which context's bindings to print. Defaults to `console`. */
  context?: HotkeyContext;
  /** True inside a free-debate segment: the chess-only rows stop being greyed. */
  chess?: boolean;
}

export function Keycaps({ caps }: { caps: string[] }): JSX.Element {
  return (
    <span className="keycaps">
      {caps.map((cap, i) => (
        <kbd key={`${cap}-${i}`} className="keycap">
          {cap}
        </kbd>
      ))}
    </span>
  );
}

/** The keycaps for one action, for a button tooltip. */
export function ActionKeys({ action }: { action: Parameters<typeof capsOf>[0] }): JSX.Element {
  return <Keycaps caps={capsOf(action)} />;
}

function Row({ binding, chess }: { binding: KeyBinding; chess: boolean }): JSX.Element {
  const { t } = useLang();
  const inert = binding.chessOnly === true && !chess;
  return (
    <li className="legend__row" data-inert={inert ? '' : undefined}>
      {/* ⌘ ⇧ ⌥ on a Mac, Ctrl Shift Alt everywhere else. */}
      <Keycaps caps={displayCaps(binding.caps)} />
      <span className="legend__text t-ctl">{t(binding.label)}</span>
    </li>
  );
}

export function KeyLegendOverlay({
  open,
  onClose,
  context = 'console',
  chess = false,
}: KeyLegendOverlayProps): JSX.Element | null {
  const { t } = useLang();
  const transport = bindingsForGroup(context, 'transport');
  const navigation = bindingsForGroup(context, 'navigation');

  return (
    <Overlay open={open} onClose={onClose} title={t('kb.title')} size="lg">
      <div className="legend">
        {transport.length === 0 ? null : (
          <section className="legend__group">
            <h3 className="t-cap legend__head">{t('kb.transport')}</h3>
            <ul>
              {transport.map((b) => (
                <Row key={b.action} binding={b} chess={chess} />
              ))}
            </ul>
          </section>
        )}
        <section className="legend__group">
          <h3 className="t-cap legend__head">{t('kb.navigation')}</h3>
          <ul>
            {navigation.map((b) => (
              <Row key={b.action} binding={b} chess={chess} />
            ))}
          </ul>
        </section>
      </div>
    </Overlay>
  );
}
