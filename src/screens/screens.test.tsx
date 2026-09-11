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
import { VETTED_PAIRS, checkPair } from '../lib/contrast';
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
    // 4v4 · 10 segments · 34:00 — speaker count, structure and length, on the card.
    expect(screen.getByText(/4v4 · 10 segments · /)).toBeTruthy();
    expect(document.querySelectorAll('.lc__card .ribbon--thumb').length).toBeGreaterThan(0);
  });

  it('previews the roster as the figures the round will actually be run with', () => {
    render(<Launch />);
    const card = document.querySelector('.lc__card');
    // Two sides, facing each other, one figure per speaker — the same <Debater> the
    // console draws, so the card shows what the round looks like.
    const sides = card?.querySelectorAll('.lc__roster .lc__side') ?? [];
    expect(sides).toHaveLength(2);
    expect(sides[0]?.querySelectorAll('.udeb--a')).toHaveLength(4);
    expect(sides[1]?.querySelectorAll('.udeb--b')).toHaveLength(4);
    // Nothing on the preview is a control: picking a format is the card's job.
    expect(card?.querySelectorAll('.lc__roster button')).toHaveLength(0);
  });

  it('offers the original blue/red pair by name, flagged rather than withheld', () => {
    // An imported save.json arrives carrying #0000FF / #FF0000, so the pair has to be
    // reachable in the picker. It is measured like any other, never substituted.
    const classic = VETTED_PAIRS.find((pair) => pair.a === '#0000FF' && pair.b === '#FF0000');
    expect(classic).toBeDefined();
    expect(classic?.labelA.zh).not.toBe('');
    expect(checkPair('#0000FF', '#FF0000').reasons.length).toBeGreaterThan(0);
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
    // Ten segments — prep first — and free debate carries a clock per side.
    expect(rows).toHaveLength(11);
    expect(rows[7]?.textContent).toContain('Free Debate · Proposition');
    expect(rows[8]?.textContent).toContain('Free Debate · Opposition');
  });

  it('marks an overrun with a signed figure, not colour alone', () => {
    loadRound(plan(instantiatePreset('chinese4v4')));
    dispatch({ t: 'ADVANCE', start: true });
    // The round opens on the 5:00 prep phase; take it well past zero.
    dispatch({ t: 'ADJUST', deltaMs: -400_000 });
    render(<Summary />);
    const overrun = document.querySelector('.sum__over');
    expect(overrun?.textContent?.startsWith('+')).toBe(true);
  });
});
