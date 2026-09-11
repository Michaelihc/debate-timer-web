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

/* ------------------------------------------------------- replacing a loaded round */

import { act, fireEvent, within } from '@testing-library/react';
import { beforeEach } from 'vitest';
import { openConfig } from '../app/boot';
import { readLibrary, readRecents } from '../engine/persist';
import { reconcileState } from '../engine/state';
import { getSession, replacePlan } from '../engine/store';

function runNowOn(index: number): HTMLElement {
  const button = screen.getAllByRole('button', { name: 'Run now' })[index];
  if (!button) throw new Error(`no Run now button ${index}`);
  return button;
}

function recentRow(title: string): HTMLElement {
  const row = [...document.querySelectorAll<HTMLElement>('.lc__row')].find((r) =>
    (r.textContent ?? '').includes(title),
  );
  if (!row) throw new Error(`no recent row for ${title}`);
  return row;
}

describe('Launch, when another round replaces the loaded one', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('asks before replacing a round under way, and keeps it in Recent rounds', async () => {
    const config = instantiatePreset('chinese4v4');
    openConfig(config, { recent: false });
    dispatch({ t: 'ADVANCE' });
    render(<Launch />);

    await act(async () => {
      fireEvent.click(runNowOn(1));
    });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Start a different round?')).toBeTruthy();
    // Nothing is replaced while the question is open.
    expect(getSession().config.id).toBe(config.id);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start the new round' }));
    });
    expect(getSession().config.presetRef).toBe('bp');
    expect(readRecents().map((entry) => entry.id)).toContain(config.id);
    expect(readLibrary()[config.id]).toBeDefined();
  });

  it('keeps the round loaded when the operator says no', async () => {
    const config = instantiatePreset('chinese4v4');
    openConfig(config, { recent: false });
    dispatch({ t: 'ADVANCE' });
    render(<Launch />);
    await act(async () => {
      fireEvent.click(runNowOn(1));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Keep this round' }));
    });
    expect(getSession().config.id).toBe(config.id);
    expect(getSession().state.cursor).toBe(0);
  });

  it('keeps an edited round with its edits, and reopening it brings them back', async () => {
    const config = instantiatePreset('chinese4v4');
    openConfig(config, { recent: false, route: '#/edit' });
    // An editor apply: a speaker renamed and given a different time.
    const edited = structuredClone(config);
    const first = edited.speakers[0];
    if (!first) throw new Error('preset changed');
    first.name = 'Michael';
    first.defaultMs = 210_000;
    const next = plan(edited);
    replacePlan(next, reconcileState(getSession().state, next).state);
    render(<Launch />);

    await act(async () => {
      fireEvent.click(runNowOn(1));
    });
    // Not started, but edited: still asked.
    expect(screen.getByText('Start a different round?')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start the new round' }));
    });
    expect(getSession().config.presetRef).toBe('bp');
    expect(readLibrary()[config.id]?.config.speakers[0]?.name).toBe('Michael');

    // Back on the launch screen, the edited round is listed and opens as edited.
    cleanup();
    render(<Launch />);
    await act(async () => {
      fireEvent.click(within(recentRow('Chinese Academic Debate')).getByRole('button', { name: 'Open' }));
    });
    const reopened = getSession().config;
    expect(reopened.id).toBe(config.id);
    expect(reopened.speakers[0]?.name).toBe('Michael');
    expect(reopened.speakers[0]?.defaultMs).toBe(210_000);
  });

  it('replaces a round nobody has started or edited without asking', async () => {
    openConfig(instantiatePreset('chinese4v4'), { recent: false });
    render(<Launch />);
    await act(async () => {
      fireEvent.click(runNowOn(1));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getSession().config.presetRef).toBe('bp');
  });

  it('opening the round that is already loaded goes back to it with its clocks intact', async () => {
    openConfig(instantiatePreset('chinese4v4'));
    dispatch({ t: 'ADVANCE' });
    dispatch({ t: 'ADVANCE' });
    const cursor = getSession().state.cursor;
    render(<Launch />);
    await act(async () => {
      fireEvent.click(within(recentRow('Chinese Academic Debate')).getByRole('button', { name: 'Open' }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getSession().state.cursor).toBe(cursor);
    expect(location.hash).toBe('#/console');
  });

  it('says which segment the loaded round is on and what its clock reads', () => {
    openConfig(instantiatePreset('chinese4v4'), { recent: false });
    dispatch({ t: 'ADVANCE' });
    dispatch({ t: 'ADVANCE' });
    render(<Launch />);
    const banner = screen.getByRole('region', { name: 'Round in progress' });
    expect(banner.textContent).toContain('segment 2 of 10');
    expect(banner.textContent).toContain('3:00 remaining');
  });
});
