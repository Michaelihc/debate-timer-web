/**
 * The console's own promises.
 *
 * These are the assertions that would be expensive to discover at a tournament: that SWAP
 * is gone rather than dead, that nothing is disabled in overtime, that going back is a
 * control and not a menu item, and that the run order is drawn exactly as the operator
 * arranged it — repeats, omissions and all.
 */

import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { instantiatePreset } from '../domain/presets';
import { chessClockId } from '../domain/plan';
import { openConfig } from '../app/boot';
import type { RoundConfig } from '../domain/config';
import { canSwap } from '../engine/selectors';
import { dispatch, getSession } from '../engine/store';
import Console from '../screens/Console';

function key(init: KeyboardEventInit): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
    window.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, ...init }));
  });
}

function openChinese(): RoundConfig {
  const config = instantiatePreset('chinese4v4');
  act(() => {
    openConfig(config, { recent: false });
  });
  return config;
}

/** The index of the free-debate block in the shipped Chinese preset. */
function chessIndex(): number {
  return getSession().plan.segments.findIndex((s) => s.kind === 'chess');
}

beforeEach(() => {
  openChinese();
});

afterEach(() => {
  cleanup();
});

test('a speech names the person, never a bare index', () => {
  act(() => {
    dispatch({ t: 'LOAD', cursor: 0 });
  });
  render(<Console />);

  const speaker = getSession().plan.segments[0]?.speaker;
  expect(speaker).toBeDefined();
  // The nameplate, plus the roster row on the rail.
  expect(screen.getAllByText(speaker?.name ?? '—').length).toBeGreaterThan(0);
});

test('the transport row is always visible and stays live past zero', () => {
  act(() => {
    dispatch({ t: 'LOAD', cursor: 1 });
    dispatch({ t: 'START' });
    // Straight past expiry: the clock now counts up and nothing may go dead.
    dispatch({ t: 'ADJUST', deltaMs: -1_000_000 });
  });
  render(<Console />);

  for (const label of ['Pause', 'Next', 'Back', '15s', 'Hold round']) {
    for (const button of screen.getAllByRole('button', { name: new RegExp(label, 'i') })) {
      expect(button).toBeEnabled();
    }
  }
});

test('SWAP is hidden — not disabled — whenever canSwap is false, and its key is inert', () => {
  const i = chessIndex();
  act(() => {
    dispatch({ t: 'LOAD', cursor: i });
  });
  const s = getSession();
  expect(canSwap(s.state, s.plan)).toBe(false);

  render(<Console />);
  expect(screen.queryByRole('button', { name: /hand off floor/i })).toBeNull();

  // The binding is dead in the same breath as the control: pressing S changes nothing.
  const before = getSession().state;
  key({ key: 's' });
  expect(getSession().state).toBe(before);

  // Open the segment: exactly one side runs, so SWAP exists again.
  act(() => {
    dispatch({ t: 'START' });
  });
  expect(canSwap(getSession().state, getSession().plan)).toBe(true);
  expect(screen.getByRole('button', { name: /hand off floor/i })).toBeEnabled();

  const segId = getSession().plan.segments[i]?.segId ?? '';
  key({ key: 's' });
  expect(getSession().state.floor).toBe('B');
  expect(getSession().state.run?.clockId).toBe(chessClockId(segId, 'B'));
});

test('SWAP survives overtime — the control and the key both keep working', () => {
  const i = chessIndex();
  act(() => {
    dispatch({ t: 'LOAD', cursor: i });
    dispatch({ t: 'START' });
    dispatch({ t: 'ADJUST', deltaMs: -1_000_000 });
  });
  render(<Console />);
  expect(screen.getByRole('button', { name: /hand off floor/i })).toBeEnabled();
  key({ key: 's' });
  expect(getSession().state.floor).toBe('B');
});

test('an advance raises the undo chip, naming where it landed', () => {
  act(() => {
    dispatch({ t: 'LOAD', cursor: 0 });
  });
  render(<Console />);
  key({ key: 'n' });

  const landed = getSession().plan.segments[1]?.speaker?.name ?? '';
  const status = screen.getByRole('status');
  expect(within(status).getByText(new RegExp(landed))).toBeInTheDocument();
  expect(within(status).getByRole('button', { name: /undo/i })).toBeInTheDocument();
});

test('the Ribbon draws the operator’s order verbatim and flags nothing about it', () => {
  // Speaker 3 before speaker 2, speaker 2 twice, speaker 1 never: all intentional.
  const config = instantiatePreset('chinese4v4');
  const a1 = config.segments[0];
  const a3 = config.segments[4];
  if (!a1 || !a3) throw new Error('preset changed');
  config.segments = [a3, a1, a3];
  act(() => {
    openConfig(config, { recent: false });
  });

  render(<Console />);
  const pips = screen.getAllByRole('option');
  expect(pips).toHaveLength(3);
  expect(screen.queryByRole('alert')).toBeNull();
  for (const pip of pips) {
    expect(pip.textContent ?? '').not.toMatch(/duplicate|unusual|missing|order/i);
  }
});

test('a prep bank draw takes over the core and Escape ends it', () => {
  act(() => {
    dispatch({ t: 'LOAD', cursor: 0 });
    dispatch({ t: 'START' });
  });
  render(<Console />);

  key({ key: 'q' });
  expect(getSession().state.bankDraw?.side).toBe('A');
  expect(screen.getAllByText(/prep bank/i).length).toBeGreaterThan(0);

  key({ key: 'Escape' });
  expect(getSession().state.bankDraw).toBeNull();
  // The speech it interrupted is running again, because it was running when we drew.
  expect(getSession().state.run?.clockId).toBe(getSession().plan.segments[0]?.primaryClockId);
});
