/**
 * Band 4: the permanently visible, context-sensitive keycap legend.
 *
 * An operator should never have to remember a binding, and should never be shown one that
 * is not live right now. The rows come from `KEYMAP`, so a legend row cannot lie about a
 * binding, and the chess rows — including SWAP — appear only while they actually work.
 */

import type { JSX } from 'react';
import type { HotkeyAction } from '../app/hotkeys';
import { capsOf } from '../app/hotkeys';
import type { StringKey } from '../i18n/strings';
import { useLang } from '../i18n/useLang';
import { Keycaps } from '../ui/KeyLegendOverlay';

import './console.css';

export interface KeyLegendProps {
  /** The current segment is a free debate. */
  chess: boolean;
  /** `canSwap()` — SWAP is listed only while the control exists. */
  swap: boolean;
}

interface Row {
  caps: string[];
  label: StringKey;
}

function row(action: HotkeyAction, label?: StringKey): Row {
  return { caps: capsOf(action), label: label ?? 'kb.spaceContext' };
}

export function KeyLegend({ chess, swap }: KeyLegendProps): JSX.Element {
  const { t } = useLang();

  const rows: Row[] = [];
  if (chess) {
    if (swap) rows.push({ caps: [...capsOf('toggle'), ...capsOf('swap')], label: 'kb.swap' });
    rows.push(row('togglePause', 'kb.chessPause'));
    rows.push({ caps: [...capsOf('floorA'), ...capsOf('floorB')], label: 'kb.floorPick' });
  } else {
    rows.push(row('toggle', 'kb.spaceContext'));
  }
  rows.push(row('advance', 'kb.advance'));
  rows.push(row('prev', 'kb.prev'));
  rows.push({ caps: [...capsOf('plus15'), ...capsOf('minus15')], label: 'kb.adjust15' });
  rows.push({ caps: [...capsOf('bankA'), ...capsOf('bankB')], label: 'kb.bankDraw' });
  rows.push(row('hold', 'kb.hold'));
  rows.push(row('reset', 'kb.holdReset'));
  rows.push(row('undo', 'kb.undoRedo'));
  rows.push(row('loadCursored', 'kb.loadPip'));
  rows.push(row('stageWindow', 'kb.stageWindow'));
  rows.push(row('editor', 'kb.editor'));
  rows.push(row('legend', 'kb.legend'));

  return (
    <div className="keylegend" aria-label={t('kb.title')}>
      <ul className="keylegend__list">
        {rows.map((r) => (
          <li key={`${r.label}-${r.caps.join('')}`} className="keylegend__row">
            <Keycaps caps={r.caps} />
            <span className="keylegend__text t-cap">{t(r.label)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
