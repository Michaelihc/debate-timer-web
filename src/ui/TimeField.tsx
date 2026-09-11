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
 * the field goes back to the last good number. It does not go back silently, though. For a
 * few seconds the field is marked invalid and says, just under itself, what it can read.
 * (The original wrote its error message into the textarea the user was editing, then saved
 * that string over their file; the first web version put the old number back without a word.)
 *
 * A bare number is the one entry that reads two ways, so while one is being typed the field
 * shows how it will be taken: `3` is three minutes, `150` is 150 seconds.
 */

import type { ChangeEvent, JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { formatTime, parseTimeInput } from '../lib/format';
import { useLang } from '../i18n/useLang';

import './ui.css';

export const STEP_MS = 15_000;
export const STEP_SHIFT_MS = 60_000;
export const STEP_ALT_MS = 5_000;
/** How long "couldn't read that" stays under the field. */
export const INVALID_NOTICE_MS = 4_000;

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
  /** Hover text for the box itself. */
  title?: string | undefined;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Enter, after the field has committed. */
  onCommitKey?: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
}

/** A plain number, no unit and no colon: the one entry `bareUnit` decides. */
const BARE_RE = /^\d+(?:\.\d+)?$/;

function halfWidth(text: string): string {
  return text.trim().replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
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
  title,
  onFocus,
  onBlur,
  onCommitKey,
}: TimeFieldProps): JSX.Element {
  const { t } = useLang();
  const autoId = useId();
  const fieldId = id ?? `tf-${autoId}`;
  const msgId = `${fieldId}-msg`;
  const display = formatTime(valueMs, { secondsOnly });
  const [text, setText] = useState(display);
  const [focused, setFocused] = useState(false);
  /** 0 while the field is fine; bumped by each unreadable commit, so the notice restarts. */
  const [invalid, setInvalid] = useState(0);
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

  useEffect(() => {
    if (invalid === 0) return;
    const timer = setTimeout(() => setInvalid(0), INVALID_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [invalid]);

  function clamp(ms: number): number {
    return Math.min(maxMs, Math.max(minMs, ms));
  }

  function commit(raw: string): void {
    editing.current = false;
    const parsed = parseTimeInput(raw, { bareUnit });
    if (parsed === null) {
      show(display);
      // An emptied box simply goes back; something typed that could not be read says so.
      if (raw.trim() !== '') setInvalid((n) => n + 1);
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
    setInvalid(0);
    setText(e.target.value);
  }

  // How a bare number is about to be read, while it is being typed.
  let reading: string | null = null;
  const typed = halfWidth(text);
  if (focused && invalid === 0 && text !== display && BARE_RE.test(typed)) {
    const n = Number(typed);
    const ms = parseTimeInput(typed, { bareUnit });
    if (ms !== null && n > 0) {
      const time = formatTime(clamp(ms));
      reading =
        ms === Math.round(n * 60_000)
          ? t('ed.timeAsMinutes', { n: typed, time })
          : t('ed.timeAsSeconds', { n: typed, time });
    }
  }
  const message = invalid > 0 ? t('ed.timeUnreadable') : reading;

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
        title={title}
        value={text}
        role="spinbutton"
        aria-valuenow={Math.round(valueMs / 1000)}
        aria-valuemin={Math.round(minMs / 1000)}
        aria-valuemax={Math.round(maxMs / 1000)}
        aria-valuetext={display}
        aria-invalid={invalid > 0 ? true : undefined}
        aria-describedby={message === null ? undefined : msgId}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          editing.current = true;
          setFocused(true);
          onFocus?.();
        }}
        onBlur={(e) => {
          setFocused(false);
          commit(e.target.value);
          onBlur?.();
        }}
      />
      {message === null ? null : (
        <span
          id={msgId}
          className="timefield__msg t-meta"
          data-tone={invalid > 0 ? 'error' : undefined}
          role={invalid > 0 ? 'alert' : undefined}
        >
          {message}
        </span>
      )}
    </span>
  );
}
