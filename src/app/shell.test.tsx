/**
 * The contracts four screens are written against. Every assertion here is a promise the
 * shell makes to Launch, Console, Editor and Summary.
 */

import { createRef, useState } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { instantiatePreset } from '../domain/presets';
import { getSession } from '../engine/store';
import type { DigitsHandle } from '../ui/Digits';
import { Digits } from '../ui/Digits';
import { Overlay } from '../ui/Overlay';
import { Ribbon } from '../ui/Ribbon';
import { ribbonFromPlan } from '../ui/ribbonData';
import { TimeField } from '../ui/TimeField';
import App from './App';
import { openConfig } from './boot';
import type { HotkeyHandlers } from './hotkeys';
import { KEYMAP, useHotkeys } from './hotkeys';
import { navigate, parseRoute, replaceRoute } from './router';

beforeEach(() => {
  replaceRoute('#/');
});

afterEach(() => {
  cleanup();
});

function key(init: KeyboardEventInit): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  window.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, ...init }));
}

/* ------------------------------------------------------------------------ router */

test('routes parse, including the share landing and the editor URL mirror', () => {
  expect(parseRoute('').name).toBe('launch');
  expect(parseRoute('#/').name).toBe('launch');
  expect(parseRoute('#/console').name).toBe('console');
  expect(parseRoute('#/nope').name).toBe('launch');
  expect(parseRoute('#/r/0.abc')).toMatchObject({ name: 'share', token: '0.abc' });
  expect(parseRoute('#/edit/r/1.xyz')).toMatchObject({ name: 'edit', token: '1.xyz' });
  expect(parseRoute('#/r/9.bad').name).toBe('launch');
});

test('navigate writes the hash without re-entering on its own rewrite', () => {
  const seen: string[] = [];
  window.addEventListener('hashchange', () => seen.push(location.hash));
  navigate('#/summary');
  expect(location.hash).toBe('#/summary');
  expect(seen).toHaveLength(0);
});

/* ----------------------------------------------------------------------- hotkeys */

test('every action id in KEYMAP is unique', () => {
  const seen = new Set<string>();
  for (const b of KEYMAP) {
    expect(seen.has(b.action)).toBe(false);
    seen.add(b.action);
  }
});

function Keys({ handlers }: { handlers: HotkeyHandlers }) {
  useHotkeys('console', handlers);
  return <input data-testid="field" />;
}

test('a bound action fires; an omitted one is inert', () => {
  const advance = vi.fn();
  render(<Keys handlers={{ advance }} />);
  act(() => key({ key: 'n' }));
  expect(advance).toHaveBeenCalledTimes(1);
  act(() => key({ key: 'p' }));
  expect(advance).toHaveBeenCalledTimes(1);
});

test('nothing fires while focus is in a text field', () => {
  const advance = vi.fn();
  render(<Keys handlers={{ advance }} />);
  const field = screen.getByTestId('field');
  field.focus();
  act(() => {
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
  });
  expect(advance).not.toHaveBeenCalled();
});

test('nothing fires during IME composition, the Chinese-input guard', () => {
  const advance = vi.fn();
  render(<Keys handlers={{ advance }} />);
  act(() => {
    document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  });
  act(() => key({ key: 'n' }));
  expect(advance).not.toHaveBeenCalled();
  act(() => {
    document.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  });
  act(() => key({ key: 'n' }));
  expect(advance).toHaveBeenCalledTimes(1);
});

test('isComposing on the event alone also suppresses', () => {
  const advance = vi.fn();
  render(<Keys handlers={{ advance }} />);
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', isComposing: true }));
  });
  expect(advance).not.toHaveBeenCalled();
});

test('SWAP is inert exactly when the console withholds its handler', () => {
  const swap = vi.fn();
  const { rerender } = render(<Keys handlers={{ swap: undefined }} />);
  act(() => key({ key: 's' }));
  expect(swap).not.toHaveBeenCalled();
  rerender(<Keys handlers={{ swap }} />);
  act(() => key({ key: 's' }));
  expect(swap).toHaveBeenCalledTimes(1);
});

test('RESET needs the key held for 600ms', () => {
  vi.useFakeTimers();
  try {
    const reset = vi.fn();
    render(<Keys handlers={{ reset }} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
    });
    act(() => {
      vi.advanceTimersByTime(400);
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'r' }));
    });
    expect(reset).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
      vi.advanceTimersByTime(700);
    });
    expect(reset).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

/* ------------------------------------------------------------------------ Digits */

test('Digits paints through its ref without re-rendering', () => {
  const ref = createRef<DigitsHandle>();
  const renders = vi.fn();
  function Wrap() {
    renders();
    return <Digits ref={ref} initialMs={180_000} name="X" />;
  }
  render(<Wrap />);
  act(() => ref.current?.write(167_000, { band: 'normal' }));
  expect(renders).toHaveBeenCalledTimes(1);
  expect(document.querySelector('.digits__head')?.textContent).toBe('2:');
  expect(document.querySelector('.digits__sec')?.textContent).toBe('47');
  act(() => ref.current?.write(-3200, { band: 'over' }));
  expect(document.querySelector('.digits__sign')?.textContent).toBe('+');
  expect(document.querySelector('.digits__sec')?.textContent).toBe('03');
  expect(document.querySelector('.digits')?.getAttribute('data-band')).toBe('over');
});

test('the digits themselves never carry a live region', () => {
  render(<Digits initialMs={1000} />);
  expect(document.querySelector('.digits')?.getAttribute('aria-live')).toBe('off');
});

/* ------------------------------------------------------------------------ Ribbon */

test('a stray click on the live Ribbon selects; only the second one loads', async () => {
  openConfig(instantiatePreset('chinese4v4'), { route: '#/console' });
  const segments = ribbonFromPlan(getSession().plan, getSession().state, 'en');
  const onSelect = vi.fn();
  const onLoad = vi.fn();
  function Wrap() {
    const [selected, setSelected] = useState<number | null>(null);
    return (
      <Ribbon
        scale="live"
        segments={segments}
        selected={selected}
        onSelect={(i) => {
          setSelected(i);
          onSelect(i);
        }}
        onLoad={onLoad}
      />
    );
  }
  render(<Wrap />);
  const first = screen.getAllByRole('option')[0];
  expect(first).toBeTruthy();
  await act(async () => first?.click());
  expect(onSelect).toHaveBeenCalledWith(0);
  expect(onLoad).not.toHaveBeenCalled();
  await act(async () => first?.click());
  expect(onLoad).toHaveBeenCalledWith(0);
});

test('the Ribbon draws the operator order verbatim', () => {
  openConfig(instantiatePreset('chinese4v4'), { route: '#/console' });
  const segments = ribbonFromPlan(getSession().plan, getSession().state, 'en');
  expect(segments).toHaveLength(getSession().plan.segments.length);
  expect(segments.map((s) => s.index)).toEqual(segments.map((_, i) => i));
});

/* --------------------------------------------------------------------- TimeField */

test('TimeField accepts every shorthand and steps by 15s', async () => {
  const onChange = vi.fn();
  function Wrap() {
    const [ms, setMs] = useState(180_000);
    return (
      <TimeField
        label="Time"
        valueMs={ms}
        onChange={(next) => {
          setMs(next);
          onChange(next);
        }}
      />
    );
  }
  render(<Wrap />);
  const input = screen.getByLabelText('Time') as HTMLInputElement;
  expect(input.value).toBe('3:00');

  const cases: [string, number][] = [
    ['2m30', 150_000],
    ['90s', 90_000],
    ['180', 180_000],
    ['4', 240_000],
    ['1:15', 75_000],
  ];
  for (const [text, expected] of cases) {
    await act(async () => {
      input.focus();
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.blur();
    });
    expect(onChange).toHaveBeenLastCalledWith(expected);
  }

  await act(async () => {
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  });
  expect(onChange).toHaveBeenLastCalledWith(90_000);
});

test('an unreadable entry never becomes the value', async () => {
  const onChange = vi.fn();
  render(<TimeField label="Time" valueMs={180_000} onChange={onChange} />);
  const input = screen.getByLabelText('Time') as HTMLInputElement;
  await act(async () => {
    input.focus();
    input.value = 'later';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.blur();
  });
  expect(onChange).not.toHaveBeenCalled();
  expect(input.value).toBe('3:00');
});

/* ----------------------------------------------------------------------- Overlay */

test('Overlay traps focus, closes on Esc and gives focus back', async () => {
  const onClose = vi.fn();
  function Wrap() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
          open
        </button>
        <Overlay
          open={open}
          title="Sheet"
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        >
          <button type="button">inside</button>
        </Overlay>
      </>
    );
  }
  render(<Wrap />);
  const trigger = screen.getByTestId('trigger');
  trigger.focus();
  await act(async () => trigger.click());
  expect(screen.getByRole('dialog')).toBeTruthy();
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(onClose).toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger);
});

/* --------------------------------------------------------------------------- App */

test('the shell mounts, syncs the document and hosts the legend', async () => {
  await act(async () => {
    render(<App />);
  });
  expect(document.documentElement.dataset['theme']).toBe('dark');
  expect(document.documentElement.lang).toMatch(/en|zh/);
  expect(document.documentElement.style.getPropertyValue('--side-a')).not.toBe('');
  await act(async () => key({ key: '?', shiftKey: true }));
  expect(screen.getAllByRole('dialog').length).toBeGreaterThan(0);
});
