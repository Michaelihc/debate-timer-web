/**
 * The most-used control in the app.
 *
 * Displays `3:00` in tabular figures and accepts `3`, `3:00`, `180`, `3m`, `90s`, `2m30`,
 * `1:15:03` and the Chinese forms `3分30秒`. Parsing is `lib/format.parseTimeInput`; this
 * component only owns focus, stepping and the normalise-on-commit rule.
 *
 * ↑/↓ step 15s · ⇧ 60s · ⌥ 5s. Those arrows belong to the field while it has focus, which
 * is exactly why the global hotkey layer refuses to fire inside an input.
 *
 * An unreadable entry is never written back into the field and never becomes the value:
 * the field reverts to the last good number on blur. (The original wrote its error message
 * into the textarea the user was editing, then saved that string over their file.)
 */

import type { ChangeEvent, JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { formatTime, parseTimeInput } from '../lib/format';

import './ui.css';

export const STEP_MS = 15_000;
export const STEP_SHIFT_MS = 60_000;
export const STEP_ALT_MS = 5_000;

export interface TimeFieldProps {
  valueMs: number;
  onChange: (ms: number) => void;
  /** Accessible label. Always required — a bare time box tells a screen reader nothing. */
  label: string;
  /** Hide the label visually (the run sheet's duration column already has a header). */
  labelHidden?: boolean;
  /** How a bare number with no unit is read. Cue and grace fields pass `'seconds'`. */
  bareUnit?: 'auto' | 'minutes' | 'seconds';
  /** `rules.display === 'seconds'` renders `180` instead of `3:00`. */
  secondsOnly?: boolean;
  minMs?: number;
  maxMs?: number;
  disabled?: boolean;
  /** The value is inherited from the speaker's default; the caller draws the link glyph. */
  inherited?: boolean;
  id?: string;
  name?: string;
  className?: string;
  placeholder?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Enter with the field committed — the roster uses it to create the next row. */
  onCommitKey?: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
}

function stepFor(e: ReactKeyboardEvent<HTMLInputElement>): number {
  if (e.shiftKey) return STEP_SHIFT_MS;
  if (e.altKey) return STEP_ALT_MS;
  return STEP_MS;
}

export function TimeField({
  valueMs,
  onChange,
  label,
  labelHidden = false,
  bareUnit = 'auto',
  secondsOnly = false,
  minMs = 0,
  maxMs = 24 * 60 * 60 * 1000,
  disabled = false,
  inherited = false,
  id,
  name,
  className,
  placeholder,
  onFocus,
  onBlur,
  onCommitKey,
}: TimeFieldProps): JSX.Element {
  const autoId = useId();
  const fieldId = id ?? `tf-${autoId}`;
  const display = formatTime(valueMs, { secondsOnly });
  const [text, setText] = useState(display);
  const editing = useRef(false);
  const inputEl = useRef<HTMLInputElement>(null);

  /** State AND the node: a rejected entry must leave the box, even when React's own
   *  value is already the canonical one and a re-render would therefore be skipped. */
  function show(next: string): void {
    setText(next);
    if (inputEl.current && inputEl.current.value !== next) inputEl.current.value = next;
  }

  // While the operator is typing, the field is theirs. Outside of that, it always shows
  // the canonical form of the real value.
  useEffect(() => {
    if (!editing.current) show(display);
  }, [display]);

  function clamp(ms: number): number {
    return Math.min(maxMs, Math.max(minMs, ms));
  }

  function commit(raw: string): void {
    editing.current = false;
    const parsed = parseTimeInput(raw, { bareUnit });
    if (parsed === null) {
      show(display);
      return;
    }
    const next = clamp(parsed);
    show(formatTime(next, { secondsOnly }));
    if (next !== valueMs) onChange(next);
  }

  function step(delta: number): void {
    const base = parseTimeInput(text, { bareUnit }) ?? valueMs;
    const next = clamp(base + delta);
    editing.current = false;
    show(formatTime(next, { secondsOnly }));
    if (next !== valueMs) onChange(next);
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      step(stepFor(e));
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      step(-stepFor(e));
      return;
    }
    if (e.key === 'Enter') {
      commit(e.currentTarget.value);
      onCommitKey?.(e);
      return;
    }
    if (e.key === 'Escape') {
      editing.current = false;
      show(display);
      e.currentTarget.blur();
    }
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>): void {
    editing.current = true;
    setText(e.target.value);
  }

  return (
    <span className={className === undefined ? 'timefield' : `timefield ${className}`}>
      <label className={labelHidden ? 'sr-only' : 't-cap timefield__label'} htmlFor={fieldId}>
        {label}
      </label>
      <input
        id={fieldId}
        ref={inputEl}
        name={name}
        className="timefield__input"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        data-numeric=""
        data-inherited={inherited ? '' : undefined}
        disabled={disabled}
        placeholder={placeholder}
        value={text}
        role="spinbutton"
        aria-valuenow={Math.round(valueMs / 1000)}
        aria-valuemin={Math.round(minMs / 1000)}
        aria-valuemax={Math.round(maxMs / 1000)}
        aria-valuetext={display}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          editing.current = true;
          onFocus?.();
        }}
        onBlur={(e) => {
          commit(e.target.value);
          onBlur?.();
        }}
      />
    </span>
  );
}
