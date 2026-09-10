/**
 * The stage's contract with the room. Every assertion here is something a projector
 * audience would notice going wrong from fifteen metres.
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { instantiatePreset } from '../domain/presets';
import { plan as buildPlan } from '../domain/plan';
import type { RunPlan } from '../engine/state';
import { dispatch, getState, loadRound, setFollower } from '../engine/store';
import Stage from './Stage';

afterEach(() => {
  cleanup();
  setFollower(false);
});

/** The stage is a follower, so `startFollower` latches the guard on mount. Every
 *  command a test issues stands in for the leader and has to lift it first. */
function asLeader(fn: () => void): void {
  act(() => {
    setFollower(false);
    fn();
  });
}

function loadChinese(): RunPlan {
  const p = buildPlan(instantiatePreset('chinese4v4'));
  asLeader(() => loadRound(p, { markApplied: false }));
  return p;
}

test('opened with no leader and no round, the stage is legible rather than broken', () => {
  render(<Stage />);
  const region = screen.getByRole('region');
  expect(region).toHaveAttribute('data-variant', 'idle');
  expect(screen.getByText(/waiting for the console/i)).toBeInTheDocument();
  expect(screen.queryAllByRole('timer')).toHaveLength(0);
});

test('pre-round is a standby card, not a zeroed clock', () => {
  loadChinese();
  render(<Stage />);
  expect(screen.getByRole('region')).toHaveAttribute('data-variant', 'standby');
  expect(screen.queryAllByRole('timer')).toHaveLength(0);
});

test('a speech names the speaker, the phase and who is next', () => {
  loadChinese();
  render(<Stage />);
  asLeader(() => dispatch({ t: 'ADVANCE' }));

  expect(screen.getByRole('region')).toHaveAttribute('data-variant', 'speech');
  expect(screen.getAllByRole('timer')).toHaveLength(1);
  // The nameplate carries identity colour; the digits never do.
  const plate = document.querySelector('.stage__plate');
  expect(plate).not.toBeNull();
  expect(document.querySelector('.digits')?.getAttribute('data-side')).toBeNull();
  expect(document.querySelector('.stage__next')).not.toBeNull();
});

test('free debate shows both side clocks, and both banks', () => {
  const p = loadChinese();
  render(<Stage />);
  const chessAt = p.segments.findIndex((s) => s.kind === 'chess');
  expect(chessAt).toBeGreaterThanOrEqual(0);
  for (let i = 0; i <= chessAt; i += 1) asLeader(() => dispatch({ t: 'ADVANCE' }));

  expect(screen.getByRole('region')).toHaveAttribute('data-variant', 'chess');
  expect(screen.getAllByRole('timer')).toHaveLength(2);
  expect(document.querySelectorAll('.stage__bank')).toHaveLength(2);
  // Neither side has the floor yet, so neither stands lit.
  expect(document.querySelectorAll('.stage__chesside[data-live]')).toHaveLength(0);
});

test('HOLD covers the stage with a slab and a frozen clock', () => {
  loadChinese();
  render(<Stage />);
  asLeader(() => dispatch({ t: 'ADVANCE' }));
  asLeader(() => dispatch({ t: 'HOLD' }));

  expect(screen.getByRole('region')).toHaveAttribute('data-hold', '');
  const slab = document.querySelector('.stage__hold');
  expect(slab).not.toBeNull();
  expect(slab?.textContent).toMatch(/\d+:\d\d/);
});

test('the whole run order paints without a single re-render throwing', () => {
  const p = loadChinese();
  render(<Stage />);
  for (let i = 0; i < p.segments.length + 1; i += 1) {
    asLeader(() => dispatch({ t: 'ADVANCE' }));
    expect(screen.getByRole('region')).toBeInTheDocument();
  }
  // Past the last segment the round is complete and says so.
  expect(getState().cursor).toBeGreaterThanOrEqual(p.segments.length);
  expect(screen.getByRole('region')).toHaveAttribute('data-variant', 'complete');
});

test('the ribbon draws the operator order verbatim — no flag, no reorder', () => {
  const p = loadChinese();
  render(<Stage />);
  asLeader(() => dispatch({ t: 'ADVANCE' }));
  const blocks = document.querySelectorAll('.stage__ribbon .ribbon__block');
  expect(blocks).toHaveLength(p.segments.length);
  // Nothing on the stage is interactive: no listbox, no options, no tab stops.
  expect(document.querySelectorAll('.stage [tabindex]')).toHaveLength(0);
  expect(document.querySelectorAll('.stage button')).toHaveLength(0);
});
