/**
 * One step of the run order:
 *
 *   ⠿ │ 2 ▌ [正一]  开篇立论 ……………… Custom 4:00 │ 3:00 │ ⋯
 *
 * Who, what, how long. For a speech, "how long" is the speaker's one time: the box edits the
 * same number the roster shows, so roster and order never disagree, however many times that
 * speaker appears. Everything else about a segment (its speaker, a time for this speech
 * alone, protected time, cues, its label in both languages) opens in place under the row
 * when the row is clicked, and closes the same way (or Esc). A speech with a time of its own
 * says so beside the box, with that time, and only while it differs from the speaker's.
 * The grip only shows while the row is hovered or focused.
 *
 * The run order is the operator's. A speaker may appear here once, five times, or never;
 * prep, free debate and breaks may sit anywhere. This row renders position, identity and
 * duration and NOTHING about whether the sequence looks conventional — no badge, no
 * asterisk, no tooltip, no colour. The only red thing it can show is a `validate.ts` error:
 * a reference to a speaker the roster no longer has.
 *
 * Identity colour lives on the 4px spine and the speaker chip — periphery. Nothing here
 * reads a clock-state colour, because nothing here is a clock.
 */

import type { DragEvent as ReactDragEvent, JSX, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useId, useRef, useState } from 'react';
import type { Segment } from '../domain/config';
import { isTypingTarget } from '../app/hotkeys';
import { formatTime } from '../lib/format';
import { useLang } from '../i18n/useLang';
import { Icon } from './Icons';
import { TimeField } from './TimeField';
import { RowMenu } from './SpeakerRow';
import { DRAG_MIME, speakerChipStyle } from './rowShared';

import '../screens/editor.css';

export interface SegmentWho {
  text: string;
  /** The side's colour when the clock is one side's; null when it is both sides'. */
  color: string | null;
}

export interface SegmentCardProps {
  segment: Segment;
  index: number;
  count: number;
  label: string;
  /** Whose clock it is: the speaker, one side, both sides — or nobody, for a break. */
  who: SegmentWho | null;
  /** The segment names a speaker the roster no longer has (`MISSING_SPEAKER`). */
  missing: boolean;
  /** Side colour for the spine; null when the clock is not one side's. */
  color: string | null;
  /**
   * The number in the row's time box. For a speech it is the SPEAKER's time, the same number
   * the roster shows, so the two can never disagree. Free debate edits one side's clock;
   * prep, shared clocks and breaks edit their own allotment.
   */
  durationMs: number;
  perSide: boolean;
  /**
   * A speech that runs its own time instead of its speaker's: that time, set in the row's
   * details. Null while there is no such exception, or while it equals the speaker's time.
   */
  customMs: number | null;
  /** The time box's name and hover text when it is more than "Time" (a speaker's time). */
  timeLabel?: string | undefined;
  timeHint?: string | undefined;
  /** Nothing to edit in the box: a speech whose speaker was deleted. */
  timeDisabled?: boolean;
  expanded: boolean;
  secondsOnly: boolean;
  /** Id of the screen's one line explaining Alt+↑ / Alt+↓. */
  hintId?: string;
  onToggle: () => void;
  onDuration: (ms: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (delta: number) => void;
  onReorder: (from: number, to: number) => void;
  /** The details, rendered under the row while it is expanded. */
  children?: ReactNode;
}

export function SegmentCard({
  segment,
  index,
  count,
  label,
  who,
  missing,
  color,
  durationMs,
  perSide,
  customMs,
  timeLabel,
  timeHint,
  timeDisabled = false,
  expanded,
  secondsOnly,
  hintId,
  onToggle,
  onDuration,
  onDuplicate,
  onDelete,
  onMove,
  onReorder,
  children,
}: SegmentCardProps): JSX.Element {
  const { t } = useLang();
  const detailsId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [dragArmed, setDragArmed] = useState(false);
  const [dropEdge, setDropEdge] = useState<'above' | 'below' | null>(null);

  function onKeyDown(e: ReactKeyboardEvent<HTMLLIElement>): void {
    // Inside a field every key belongs to the field — Alt+↑/↓ in a time box is its ±5s
    // step, not a reorder, and firing both would move the row AND change its time.
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
    const onRow = e.target === e.currentTarget || e.target === toggleRef.current;
    if (onRow && (e.key === 'Backspace' || e.key === 'Delete')) {
      e.preventDefault();
      onDelete();
      return;
    }
    if (e.key === 'Escape' && expanded) {
      // Esc closes the open row before it means "leave the editor".
      e.preventDefault();
      e.stopPropagation();
      toggleRef.current?.focus();
      onToggle();
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

  const time = formatTime(durationMs, { secondsOnly });
  const customTime = customMs === null ? null : formatTime(customMs, { secondsOnly });
  const name = [
    t('ed.segmentN', { i: index + 1 }),
    missing ? t('ed.speakerDeleted') : who?.text,
    label,
    customTime !== null
      ? t('ed.customTime', { time: customTime })
      : perSide
        ? `${time} ${t('ed.perSide')}`
        : time,
  ]
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' · ');

  return (
    <li
      className="step"
      data-seg={segment.id}
      data-kind={segment.kind}
      data-expanded={expanded ? '' : undefined}
      data-missing={missing ? '' : undefined}
      data-drop={dropEdge ?? undefined}
      draggable={dragArmed}
      onKeyDown={onKeyDown}
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
      <div
        className="step__head"
        onClick={(e) => {
          // The whole row opens the details; its own controls keep their clicks.
          if (e.target instanceof Element && e.target.closest('input,button,select,textarea,.rowmenu')) return;
          onToggle();
        }}
      >
        <span
          className="step__grip"
          aria-hidden="true"
          title={t('ed.reorderHint')}
          onPointerDown={() => setDragArmed(true)}
          onPointerUp={() => setDragArmed(false)}
        >
          <Icon name="grip" />
        </span>

        <button
          ref={toggleRef}
          type="button"
          className="step__toggle"
          aria-expanded={expanded}
          aria-controls={expanded ? detailsId : undefined}
          aria-label={name}
          aria-describedby={hintId}
          onClick={onToggle}
        >
          <span className="step__num t-meta num" aria-hidden="true">
            {index + 1}
          </span>
          <span
            className="step__spine"
            style={color === null ? undefined : { background: color }}
            aria-hidden="true"
          />
          <span className="step__who" aria-hidden="true">
            {missing ? (
              <span className="step__missing t-cap">
                <Icon name="alert" /> {t('ed.speakerDeleted')}
              </span>
            ) : who === null ? null : who.color === null ? (
              <span className="step__chip step__chip--both" title={who.text}>
                {who.text}
              </span>
            ) : (
              <span className="step__chip" style={speakerChipStyle(who.color)} title={who.text}>
                {who.text}
              </span>
            )}
          </span>
          <span className="step__label t-row">{label}</span>
          <Icon name="caret" className="step__caret" />
        </button>

        {perSide ? (
          <span className="step__note t-meta">{t('ed.perSide')}</span>
        ) : customTime !== null ? (
          <span
            className="step__note step__note--custom t-meta num"
            title={t('ed.customTimeHint', { time: customTime, name: who?.text ?? '', base: time })}
          >
            {t('ed.customTime', { time: customTime })}
          </span>
        ) : null}

        <TimeField
          className="step__time"
          valueMs={durationMs}
          onChange={onDuration}
          label={`${t('ed.segmentN', { i: index + 1 })} · ${timeLabel ?? (perSide ? `${t('ed.time')} · ${t('ed.perSide')}` : t('ed.time'))}`}
          labelHidden
          title={timeHint}
          disabled={timeDisabled}
          secondsOnly={secondsOnly}
        />

        <RowMenu label={t('ed.more')}>
          <button type="button" onClick={onDuplicate}>
            {t('ed.duplicate')}
          </button>
          <button type="button" disabled={index === 0} onClick={() => onMove(-1)}>
            {t('ed.moveUp')}
          </button>
          <button type="button" disabled={index === count - 1} onClick={() => onMove(1)}>
            {t('ed.moveDown')}
          </button>
          <button type="button" data-tone="danger" onClick={onDelete}>
            {t('ed.delete')}
          </button>
        </RowMenu>
      </div>

      {expanded ? (
        <div className="step__details" id={detailsId}>
          {children}
        </div>
      ) : null}
    </li>
  );
}
