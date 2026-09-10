/**
 * One roster row, 44px: grip · ordinal · name · role · time · ⋯
 *
 * The keyboard is the primary path. Enter in the name field creates the next row and
 * focuses it — eight speakers are eight names and eight Enters. Alt+↑/↓ reorders,
 * ⌘D duplicates, ⌘⌫ deletes, Tab walks name → role → time → next name.
 *
 * The role field edits the current language and mirrors into the other while that other
 * is still empty, so a monolingual operator never sees a second box and a bilingual one
 * presses L and types the other half.
 */

import type { DragEvent as ReactDragEvent, JSX, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { L10n, SpeakerCfg } from '../domain/config';
import { useLang } from '../i18n/useLang';
import { Icon } from './Icons';
import { DRAG_MIME } from './rowShared';
import { TimeField } from './TimeField';

import '../screens/editor.css';

export interface SpeakerRowProps {
  speaker: SpeakerCfg;
  /** 1-based position within this side. */
  ordinal: number;
  /** Position within this side's array, for reordering. */
  index: number;
  color: string;
  /** The side's own name, so "Speaker 1" is not ambiguous across the two rosters. */
  sideLabel: string;
  secondsOnly: boolean;
  /** Nothing here judges the run order; this is only `UNNAMED_SPEAKER` from validate.ts. */
  flagged: boolean;
  onPatch: (patch: Partial<SpeakerCfg>) => void;
  onEnter: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveSide: () => void;
  onSetAllOnSide: () => void;
  onMove: (delta: number) => void;
  onReorder: (from: number, to: number) => void;
  focusKey: string | null;
}

export function SpeakerRow({
  speaker,
  ordinal,
  index,
  color,
  sideLabel,
  secondsOnly,
  flagged,
  onPatch,
  onEnter,
  onDuplicate,
  onDelete,
  onMoveSide,
  onSetAllOnSide,
  onMove,
  onReorder,
  focusKey,
}: SpeakerRowProps): JSX.Element {
  const { t, lang, l10n } = useLang();
  const [dragArmed, setDragArmed] = useState(false);
  const [dropEdge, setDropEdge] = useState<'above' | 'below' | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusKey === speaker.id) nameRef.current?.focus();
  }, [focusKey, speaker.id]);

  function onRowKeyDown(e: ReactKeyboardEvent<HTMLLIElement>): void {
    // Alt+↑/↓ reorders from the name and role fields — that is the roster's keyboard
    // path — but inside the TimeField those same chords are its own ±5s step.
    const inTimeField =
      e.target instanceof HTMLElement && e.target.getAttribute('role') === 'spinbutton';
    if (!inTimeField && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
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
    if (mod && (e.key === 'Backspace' || e.key === 'Delete')) {
      e.preventDefault();
      onDelete();
    }
  }

  function onDragStart(e: ReactDragEvent<HTMLLIElement>): void {
    e.dataTransfer.setData(DRAG_MIME, String(index));
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e: ReactDragEvent<HTMLLIElement>): void {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const box = e.currentTarget.getBoundingClientRect();
    setDropEdge(e.clientY < box.top + box.height / 2 ? 'above' : 'below');
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

  const roleText = l10n(speaker.role);

  function setRole(text: string): void {
    const other = lang === 'zh' ? (speaker.role?.en ?? '') : (speaker.role?.zh ?? '');
    // Mirror into the untouched language so one typed word reaches both.
    const mirrored = other.trim() === '' ? text : other;
    const next: L10n = lang === 'zh' ? { en: mirrored, zh: text } : { en: text, zh: mirrored };
    onPatch(next.en === '' && next.zh === '' ? { role: undefined } : { role: next });
  }

  return (
    <li
      className="srow"
      data-flagged={flagged ? '' : undefined}
      data-drop={dropEdge ?? undefined}
      draggable={dragArmed}
      onKeyDown={onRowKeyDown}
      onDragStart={onDragStart}
      onDragEnd={() => {
        setDragArmed(false);
        setDropEdge(null);
      }}
      onDragOver={onDragOver}
      onDragLeave={() => setDropEdge(null)}
      onDrop={onDrop}
    >
      <span className="srow__spine" style={{ background: color }} aria-hidden="true" />

      <button
        type="button"
        className="srow__grip"
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

      <span className="srow__ord t-meta num" aria-hidden="true">
        {ordinal}
      </span>

      <input
        ref={nameRef}
        className="srow__name t-row"
        type="text"
        value={speaker.name}
        placeholder={t('ed.namePlaceholder')}
        aria-label={`${sideLabel} · ${t('ed.speakerN', { i: ordinal })}`}
        autoComplete="off"
        onChange={(e) => onPatch({ name: e.target.value })}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          onEnter();
        }}
      />

      <input
        className="srow__role t-meta"
        type="text"
        value={roleText}
        placeholder={t('ed.role')}
        aria-label={t('ed.role')}
        title={t('ed.roleHint')}
        autoComplete="off"
        onChange={(e) => setRole(e.target.value)}
      />

      <TimeField
        className="srow__time"
        valueMs={speaker.defaultMs}
        onChange={(ms) => onPatch({ defaultMs: ms })}
        label={t('ed.time')}
        labelHidden
        secondsOnly={secondsOnly}
        minMs={0}
      />

      <RowMenu label={t('ed.more')}>
        <button type="button" onClick={onDuplicate}>
          {t('ed.duplicate')}
        </button>
        <button type="button" onClick={onSetAllOnSide}>
          {t('ed.setAllOnSide')}
        </button>
        <button type="button" onClick={onMoveSide}>
          {t('ed.moveToOtherSide')}
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
    </li>
  );
}

/* ------------------------------------------------------------------ shared bits */

export interface RowMenuProps {
  label: string;
  children: ReactNode;
}

/**
 * The `⋯` row menu. Closes on Esc, on outside focus and on any choice — a menu that
 * survives its own action is a menu the operator has to dismiss twice.
 */
export function RowMenu({ label, children }: RowMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  return (
    <div
      className="rowmenu"
      ref={box}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !open) return;
        e.stopPropagation();
        setOpen(false);
      }}
    >
      <button
        type="button"
        className="rowmenu__toggle"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open ? (
        <div
          className="rowmenu__pop t-ctl"
          role="group"
          aria-label={label}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
