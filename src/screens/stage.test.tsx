/**
 * The stage's contract with the room. Every assertion here is something a projector
 * audience would notice going wrong from fifteen metres — and, since the restoration,
 * something the ORIGINAL app put on the wall: the two teams facing each other as person
 * figures, a radial ring with the time in it, and a strip of timeline pips.
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
  // Nothing to walk, so no rail and no pips — never an empty strip.
  expect(document.querySelectorAll('.stage__pip')).toHaveLength(0);
});

test('pre-round is a standby card, not a zeroed clock', () => {
  loadChinese();
  render(<Stage />);
  expect(screen.getByRole('region')).toHaveAttribute('data-variant', 'standby');
  expect(screen.queryAllByRole('timer')).toHaveLength(0);
  // The teams are already facing each other, and the motion is already up.
  expect(document.querySelectorAll('.udeb')).toHaveLength(8);
  expect(document.querySelectorAll('.stage__team')).toHaveLength(2);
});

test('a speech is a ring with the time in it, one speaking figure and one on deck', () => {
  loadChinese();
  render(<Stage />);
  asLeader(() => dispatch({ t: 'ADVANCE' }));

  expect(screen.getByRole('region')).toHaveAttribute('data-variant', 'speech');
  expect(screen.getAllByRole('timer')).toHaveLength(1);

  // The countdown is the radial ring, and the digits sit inside its core.
  expect(document.querySelector('.uring__arc')).not.toBeNull();
  expect(document.querySelector('.uring__core .digits')).not.toBeNull();

  // Identity colour tints the figures; the digits never carry it.
  expect(document.querySelector('.digits')?.getAttribute('data-side')).toBeNull();
  expect(document.querySelectorAll('.udeb[data-state="speaking"]')).toHaveLength(1);
  expect(document.querySelectorAll('.udeb[data-state="next"]')).toHaveLength(1);
});

test('free debate shows both side bars, both banks, and a group icon on every figure', () => {
  const p = loadChinese();
  render(<Stage />);
  const chessAt = p.segments.findIndex((s) => s.kind === 'chess');
  expect(chessAt).toBeGreaterThanOrEqual(0);
  for (let i = 0; i <= chessAt; i += 1) asLeader(() => dispatch({ t: 'ADVANCE' }));

  expect(screen.getByRole('region')).toHaveAttribute('data-variant', 'chess');
  expect(screen.getAllByRole('timer')).toHaveLength(2);
  // The original's two vertical fill bars, not one ring.
  expect(document.querySelectorAll('.stage__vbar')).toHaveLength(2);
  expect(document.querySelector('.uring')).toBeNull();
  expect(document.querySelectorAll('.stage__bank')).toHaveLength(2);
  // Every figure holds the group icon through free debate, as the original does.
  expect(document.querySelectorAll('.udeb[data-overlay="free"]')).toHaveLength(8);
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

test('the timeline draws the operator order verbatim — no flag, no reorder', () => {
  const p = loadChinese();
  render(<Stage />);
  asLeader(() => dispatch({ t: 'ADVANCE' }));

  const pips = document.querySelectorAll('.stage__pip');
  expect(pips).toHaveLength(p.segments.length);
  expect(document.querySelectorAll('.stage__pip[data-state="current"]')).toHaveLength(1);
  expect(document.querySelector('.stage__rail')).not.toBeNull();

  // Nothing on the stage is interactive: no listbox, no options, no tab stops.
  expect(document.querySelectorAll('.stage [tabindex]')).toHaveLength(0);
  expect(document.querySelectorAll('.stage button')).toHaveLength(0);
});

test('the warning flash is mounted where the room can see it', () => {
  loadChinese();
  render(<Stage />);
  asLeader(() => dispatch({ t: 'ADVANCE' }));
  expect(document.querySelector('.stage .u-flash')).not.toBeNull();
});
