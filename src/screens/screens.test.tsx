/**
 * Contract tests for the two screens that bracket a round: Launch and Summary.
 *
 * They guard the things that are easy to break silently — the preset grid staying
 * seven cards led by the default format, and the box score reporting every CLOCK
 * (free debate is two) in the operator's order, with overruns marked in words as
 * well as colour.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { plan } from '../domain/plan';
import { PRESET_KEYS, instantiatePreset } from '../domain/presets';
import { dispatch, loadRound } from '../engine/store';
import Launch from './Launch';
import Summary from './Summary';

afterEach(cleanup);

describe('Launch', () => {
  it('offers every format, led by the one the operator actually runs', () => {
    render(<Launch />);
    expect(screen.getAllByText('Run now')).toHaveLength(PRESET_KEYS.length);
    const cards = document.querySelectorAll('.lc__card');
    expect(cards).toHaveLength(PRESET_KEYS.length);
    expect(cards[0]?.hasAttribute('data-default')).toBe(true);
    expect(cards[0]?.textContent).toContain('Chinese Academic 4v4');
  });

  it('states the shape of a format before it is chosen', () => {
    render(<Launch />);
    // 4v4 · 9 segments · 42:30 — speaker count, structure and length, on the card.
    expect(screen.getByText(/4v4 · 9 segments · /)).toBeTruthy();
    expect(document.querySelectorAll('.lc__card .ribbon--thumb').length).toBeGreaterThan(0);
  });
});

describe('Summary', () => {
  it('says so plainly when no round has been run', () => {
    render(<Summary />);
    expect(screen.getByText('No round has been run yet.')).toBeTruthy();
  });

  it('reports one row per clock, in the order the round ran them', () => {
    loadRound(plan(instantiatePreset('chinese4v4')));
    dispatch({ t: 'ADVANCE', start: true });
    render(<Summary />);
    const rows = screen.getByRole('table').querySelectorAll('tbody tr');
    // Nine segments, but free debate carries a clock per side.
    expect(rows).toHaveLength(10);
    expect(rows[6]?.textContent).toContain('Free Debate · Proposition');
    expect(rows[7]?.textContent).toContain('Free Debate · Opposition');
  });

  it('marks an overrun with a signed figure, not colour alone', () => {
    loadRound(plan(instantiatePreset('chinese4v4')));
    dispatch({ t: 'ADVANCE', start: true });
    dispatch({ t: 'ADJUST', deltaMs: -200_000 });
    render(<Summary />);
    const overrun = document.querySelector('.sum__over');
    expect(overrun?.textContent?.startsWith('+')).toBe(true);
  });
});
