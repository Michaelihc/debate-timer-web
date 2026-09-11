/**
 * One roster row:  ⠿ │ 1 │ name            │ 3:00 │ ⋯
 *                           role, underneath
 *
 * Name and role stack, so a role like 总结陈词 or "Opening Constructive" is always read in
 * full rather than cut to 总结陈. The grip shows while the row is hovered or focused.
 *
 * The keyboard is the primary path. Enter in the name field confirms it and moves on to the
 * next name on the same side; after the side's last name it lands on that side's Add
 * speaker button, so a new row is always its own deliberate press and never a side effect
 * of confirming a rename. An Enter that ends an IME composition does nothing. Alt+↑/↓
 * reorders, ⌘D duplicates, ⌘⌫ deletes, Tab walks name → role → time → ⋯.
 *
 * The time is the speaker's one time. Every speech they give in the order runs it, and the
 * order's rows edit the same number.
 *
 * The role field edits the current language and fills the other half while that half is
 * still empty (or still the copy this field put there), so an operator working in one
 * language types a role once and both consoles show it.
 */

import type { DragEvent as ReactDragEvent, JSX, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { L10n, SpeakerCfg } from '../domain/config';
import { useLang } from '../i18n/useLang';
import { Icon } from './Icons';
import { DRAG_MIME } from './rowShared';
import { TimeField } from './TimeField';

import '../screens/editor.css';

/** "Focus this speaker's name" — a fresh `seq` asks again even for the same speaker. */
export interface FocusRequest {
  id: string;
  seq: number;
}

export interface SpeakerRowProps {
  speaker: SpeakerCfg;
  /** 1-based position within this side. */
  ordinal: number;
  /** Position within this side's array, for reordering. */
  index: number;
  /** The side's own name, so "Speaker 1" is not ambiguous across the two rosters. */
  sideLabel: string;
  secondsOnly: boolean;
  /** Nothing here judges the run order; this is only `UNNAMED_SPEAKER` from validate.ts. */
  flagged: boolean;
  focus: FocusRequest | null;
  onPatch: (patch: Partial<SpeakerCfg>) => void;
  /** The speaker's one time. Every speech that follows it changes with it. */
  onTime: (ms: number) => void;
  /** Enter in the name: the editor moves focus on. It never adds a row. */
  onEnter: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveSide: () => void;
  onSetAllOnSide: () => void;
  onMove: (delta: number) => void;
  onReorder: (from: number, to: number) => void;
}

export function SpeakerRow({
  speaker,
  ordinal,
  index,
  sideLabel,
  secondsOnly,
  flagged,
  focus,
  onPatch,
  onTime,
  onEnter,
  onDuplicate,
  onDelete,
  onMoveSide,
  onSetAllOnSide,
  onMove,
  onReorder,
}: SpeakerRowProps): JSX.Element {
  const { t, lang, l10n } = useLang();
  const [dragArmed, setDragArmed] = useState(false);
  const [dropEdge, setDropEdge] = useState<'above' | 'below' | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focus === null || focus.id !== speaker.id) return;
    // Focus the way Tab would: the whole name selected, so typing replaces it.
    nameRef.current?.focus();
    nameRef.current?.select();
  }, [focus, speaker.id]);

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

  function setRole(text: string): void {
    const mine = lang === 'zh' ? (speaker.role?.zh ?? '') : (speaker.role?.en ?? '');
    const other = lang === 'zh' ? (speaker.role?.en ?? '') : (speaker.role?.zh ?? '');
    // Fill the other half while it is empty or still a copy of this one, and only then —
    // checking "empty" alone stopped mirroring after the first keystroke.
    const mirrored = other.trim() === '' || other === mine ? text : other;
    const next: L10n = lang === 'zh' ? { en: mirrored, zh: text } : { en: text, zh: mirrored };
    onPatch(next.en === '' && next.zh === '' ? { role: undefined } : { role: next });
  }

  const who = `${sideLabel} · ${t('ed.speakerN', { i: ordinal })}`;

  return (
    <li
      className="person"
      data-flagged={flagged ? '' : undefined}
      data-drop={dropEdge ?? undefined}
      draggable={dragArmed}
      onKeyDown={onRowKeyDown}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, String(index));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => {
        setDragArmed(false);
        setDropEdge(null);
      }}
      onDragOver={onDragOver}
      onDragLeave={() => setDropEdge(null)}
      onDrop={onDrop}
    >
      <span
        className="person__grip"
        aria-hidden="true"
        title={t('ed.reorderHint')}
        onPointerDown={() => setDragArmed(true)}
        onPointerUp={() => setDragArmed(false)}
      >
        <Icon name="grip" />
      </span>

      <span className="person__ord t-meta num" aria-hidden="true">
        {ordinal}
      </span>

      <span className="person__text">
        <input
          ref={nameRef}
          className="person__name t-row"
          type="text"
          value={speaker.name}
          placeholder={t('ed.namePlaceholder')}
          aria-label={who}
          autoComplete="off"
          onChange={(e) => onPatch({ name: e.target.value })}
          onKeyDown={(e) => {
            // 229 is the Enter some engines still send as an IME composition ends.
            if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return;
            e.preventDefault();
            onEnter();
          }}
        />
        <input
          className="person__role t-meta"
          type="text"
          value={l10n(speaker.role)}
          placeholder={t('ed.rolePlaceholder')}
          aria-label={`${who} · ${t('ed.role')}`}
          title={t('ed.roleHint')}
          autoComplete="off"
          onChange={(e) => setRole(e.target.value)}
        />
      </span>

      <TimeField
        className="person__time"
        valueMs={speaker.defaultMs}
        onChange={onTime}
        label={`${who} · ${t('ed.time')}`}
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
