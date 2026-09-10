/**
 * The `?` overlay. It renders `KEYMAP` directly, so a binding cannot exist without a
 * legend row and a legend row cannot lie about a binding.
 *
 * Bilingual by design, not by toggle: at a Chinese tournament the operator's colleague
 * reading over their shoulder may not share the UI language, and this is the one screen
 * where showing both costs nothing.
 */

import type { JSX } from 'react';
import type { HotkeyContext, KeyBinding } from '../app/hotkeys';
import { bindingsForGroup, capsOf } from '../app/hotkeys';
import { translate, useLang } from '../i18n/useLang';
import { Overlay } from './Overlay';

import './ui.css';

export interface KeyLegendOverlayProps {
  open: boolean;
  onClose: () => void;
  /** Which context's bindings to print. Defaults to `console`. */
  context?: HotkeyContext;
  /** True inside a free-debate segment: the chess-only rows stop being greyed. */
  chess?: boolean;
  /** Dim the surface behind to 20% — the stage does. */
  dim?: boolean;
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

/** The keycaps for one action, for a button tooltip or the permanent band-4 legend. */
export function ActionKeys({ action }: { action: Parameters<typeof capsOf>[0] }): JSX.Element {
  return <Keycaps caps={capsOf(action)} />;
}

function Row({ binding, chess }: { binding: KeyBinding; chess: boolean }): JSX.Element {
  const inert = binding.chessOnly === true && !chess;
  return (
    <li className="legend__row" data-inert={inert ? '' : undefined}>
      <Keycaps caps={binding.caps} />
      <span className="legend__text">
        <span className="t-ctl" lang="en">
          {translate('en', binding.label)}
        </span>
        <span className="t-meta legend__zh" lang="zh">
          {translate('zh', binding.label)}
        </span>
      </span>
    </li>
  );
}

export function KeyLegendOverlay({
  open,
  onClose,
  context = 'console',
  chess = false,
  dim = false,
}: KeyLegendOverlayProps): JSX.Element | null {
  const { t } = useLang();
  const transport = bindingsForGroup(context, 'transport');
  const navigation = bindingsForGroup(context, 'navigation');

  return (
    <Overlay open={open} onClose={onClose} title={t('kb.title')} size="lg" dim={dim}>
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
      <p className="t-meta legend__foot">
        <Keycaps caps={['Esc']} /> {t('kb.escape')}
      </p>
    </Overlay>
  );
}
