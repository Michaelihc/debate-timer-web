/**
 * One run-sheet card, 44px:
 *   ⠿ grip │ cumulative start │ 4px side spine │ kind glyph │ label │ chip │ duration │ cues │ ⋯
 *
 * The run order is the operator's. A speaker may appear here once, five times, or never;
 * prep, free debate and breaks may sit anywhere. This card renders position and duration
 * and NOTHING about whether the sequence looks conventional — no badge, no asterisk, no
 * tooltip, no colour. The only red thing it can ever show is a `validate.ts` error, and
 * the only error a card can carry is a reference to a speaker that no longer exists.
 *
 * Identity colour lives on the 4px spine and the speaker chip — periphery. Nothing on
 * this card reads a clock-state colour, because nothing on this card is a clock.
 */

import type { DragEvent as ReactDragEvent, JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useState } from 'react';
import type { Segment, SegmentKind, SideId, SpeakerCfg } from '../domain/config';
import { isTypingTarget } from '../app/hotkeys';
import type { StringKey } from '../i18n/strings';
import { formatTime } from '../lib/format';
import { useLang } from '../i18n/useLang';
import { Icon } from './Icons';
import { TimeField } from './TimeField';
import { RowMenu } from './SpeakerRow';
import { DRAG_MIME, speakerChipStyle } from './rowShared';

import '../screens/editor.css';

/**
 * A one-glyph tell for the kind, so the eye reads structure before words.
 *
 * Every one of these is a plain typographic character with no emoji presentation — U+23F8
 * PAUSE BUTTON would have been the obvious mark for `prep`, but it is emoji-capable and
 * arrives coloured and differently shaped on half the machines in a venue.
 */
const GLYPH: Record<SegmentKind, string> = {
  speech: '▌',
  shared: '⇄',
  prep: '‖',
  chess: '⧗',
  break: '—',
};

export interface SegmentCardProps {
  segment: Segment;
  index: number;
  count: number;
  /** Cumulative round time at which this segment starts. */
  offsetMs: number;
  /** The number the operator edits: `perSideMs` for free debate, the allotment otherwise. */
  durationMs: number;
  perSide: boolean;
  label: string;
  speaker: SpeakerCfg | null;
  /** The segment names a speaker the roster no longer has (`MISSING_SPEAKER`). */
  missing: boolean;
  side: SideId | null;
  color: string | null;
  cues: readonly number[];
  customCues: boolean;
  /** A speech taking the speaker's default time rather than its own. */
  inherited: boolean;
  selected: boolean;
  secondsOnly: boolean;
  onSelect: () => void;
  onDuration: (ms: number) => void;
  onToggleInherit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (delta: number) => void;
  onReorder: (from: number, to: number) => void;
}

export function SegmentCard({
  segment,
  index,
  count,
  offsetMs,
  durationMs,
  perSide,
  label,
  speaker,
  missing,
  side,
  color,
  cues,
  customCues,
  inherited,
  selected,
  secondsOnly,
  onSelect,
  onDuration,
  onToggleInherit,
  onDuplicate,
  onDelete,
  onMove,
  onReorder,
}: SegmentCardProps): JSX.Element {
  const { t, l10n } = useLang();
  const [dragArmed, setDragArmed] = useState(false);
  const [dropEdge, setDropEdge] = useState<'above' | 'below' | null>(null);

  function onKeyDown(e: ReactKeyboardEvent<HTMLLIElement>): void {
    // Inside the duration box every key belongs to the field — Alt+↑/↓ there is the
    // ±5s step, not a reorder, and firing both would move the card AND change its time.
    if (isTypingTarget(e.target)) return;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      onMove(e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      onDuplicate();
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      onDelete();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  }

  function onDrop(e: ReactDragEvent<HTMLLIElement>): void {
    e.preventDefault();
    const raw = Number.parseInt(e.dataTransfer.getData(DRAG_MIME), 10);
    const edge = dropEdge;
    setDropEdge(null);
    setDragArmed(false);
    if (!Number.isInteger(raw) || raw === index) return;
    let target = edge === 'below' ? index + 1 : index;
    if (raw < target) target -= 1;
    onReorder(raw, target);
  }

  const name = `${t('ed.segmentN', { i: index + 1 })} · ${label} · ${formatTime(durationMs, { secondsOnly })}`;

  return (
    <li
      className="scard"
      tabIndex={0}
      aria-label={name}
      aria-current={selected ? 'true' : undefined}
      data-selected={selected ? '' : undefined}
      data-missing={missing ? '' : undefined}
      data-kind={segment.kind}
      data-side={side ?? undefined}
      data-drop={dropEdge ?? undefined}
      draggable={dragArmed}
      onKeyDown={onKeyDown}
      onClick={(e) => {
        if (e.target instanceof HTMLElement && e.target.closest('input,button,select,textarea')) return;
        onSelect();
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, String(index));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => {
        setDragArmed(false);
        setDropEdge(null);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const box = e.currentTarget.getBoundingClientRect();
        setDropEdge(e.clientY < box.top + box.height / 2 ? 'above' : 'below');
      }}
      onDragLeave={() => setDropEdge(null)}
      onDrop={onDrop}
    >
      <span className="scard__at t-cap num" aria-label={t('ed.startsAt')}>
        {formatTime(offsetMs, { secondsOnly })}
      </span>

      <button
        type="button"
        className="scard__grip"
        aria-label={t('ed.reorderHint')}
        onPointerDown={() => setDragArmed(true)}
        onPointerUp={() => setDragArmed(false)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          onMove(e.key === 'ArrowUp' ? -1 : 1);
        }}
      >
        <Icon name="grip" />
      </button>

      <span
        className="scard__spine"
        style={color === null ? undefined : { background: color }}
        aria-hidden="true"
      />

      <span className="scard__glyph" aria-hidden="true">
        {GLYPH[segment.kind]}
      </span>

      <span className="scard__label t-row">{label}</span>

      {missing ? (
        <span className="scard__missing t-cap">
          <Icon name="alert" /> {t('ed.speakerDeleted')}
        </span>
      ) : speaker ? (
        <span className="scard__chip t-cap" style={color === null ? undefined : speakerChipStyle(color)}>
          {speaker.name.trim() === '' ? l10n(speaker.role) || t('k.speech') : speaker.name}
        </span>
      ) : (
        <span className="scard__badge t-cap">{t(badgeKey(segment.kind))}</span>
      )}

      <span className="scard__cues t-cap" aria-label={t('ed.cueTiers')}>
        {cues.length === 0 ? (
          <span className="scard__cue-none">{t('ui.none')}</span>
        ) : (
          cues.map((at) => (
            <span key={at} className="scard__cue" data-custom={customCues ? '' : undefined}>
              {formatTime(at, { secondsOnly })}
            </span>
          ))
        )}
      </span>

      <span className="scard__dur">
        {segment.kind === 'speech' ? (
          <button
            type="button"
            className="scard__link"
            aria-pressed={!inherited}
            title={inherited ? t('ed.inherit') : t('ed.override')}
            aria-label={inherited ? t('ed.inherit') : t('ed.override')}
            onClick={onToggleInherit}
          >
            <Icon name={inherited ? 'link' : 'unlink'} />
          </button>
        ) : null}
        <TimeField
          className="scard__time"
          valueMs={durationMs}
          onChange={onDuration}
          label={perSide ? `${t('ed.time')} · ${t('ed.perSide')}` : t('ed.time')}
          labelHidden
          secondsOnly={secondsOnly}
          inherited={inherited}
        />
      </span>

      <RowMenu label={t('ed.more')}>
        <button type="button" onClick={onSelect}>
          {t('ed.inspector')}
        </button>
        <button type="button" onClick={onDuplicate}>
          {t('ed.duplicate')}
        </button>
        <button type="button" onClick={() => onMove(-1)}>
          {t('ed.moveUp')}
        </button>
        <button type="button" onClick={() => onMove(1)}>
          {t('ed.moveDown')}
        </button>
        <button type="button" data-tone="danger" onClick={onDelete}>
          {t('ed.delete')}
        </button>
      </RowMenu>

      <span className="sr-only">{t('ed.segmentN', { i: index + 1 })} / {count}</span>
    </li>
  );
}

function badgeKey(kind: SegmentKind): StringKey {
  switch (kind) {
    case 'chess':
      return 'k.free';
    case 'shared':
      return 'k.shared';
    case 'prep':
      return 'k.prep';
    case 'break':
      return 'k.break';
    default:
      return 'k.speech';
  }
}
