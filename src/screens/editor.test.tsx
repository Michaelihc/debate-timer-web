/**
 * Editor contract tests.
 *
 * The point of most of these is what the editor does NOT say. A repeated speaker, an
 * omitted speaker and an out-of-sequence order are the operator's run sheet, and the
 * screen must stay silent about all three while still reporting the one thing that
 * cannot run: a segment naming a speaker the roster no longer has.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import Editor from './Editor';
import { chinese4v4, instantiateConfig } from '../domain/presets';
import { plan } from '../domain/plan';
import { loadRound } from '../engine/store';

beforeEach(() => {
  localStorage.clear();
  location.hash = '#/edit';
  loadRound(plan(instantiateConfig(chinese4v4)), { markApplied: false });
});

afterEach(() => {
  cleanup();
});

function cards(): HTMLElement[] {
  const sheet = screen.getByRole('region', { name: 'Run sheet' });
  const list = sheet.querySelector('.ed__cards');
  return list === null ? [] : within(list as HTMLElement).getAllByRole('listitem');
}

describe('Editor', () => {
  it('renders the operator order verbatim, one card per segment', () => {
    render(<Editor />);
    expect(screen.getByRole('region', { name: 'Roster' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Inspector' })).toBeInTheDocument();
    expect(cards()).toHaveLength(9);
  });

  it('appends a repeated speaker and says nothing about it', () => {
    render(<Editor />);
    const composer = screen.getByRole('combobox', { name: 'Add segment' });
    for (let i = 0; i < 2; i++) {
      fireEvent.change(composer, { target: { value: 'p1' } });
      fireEvent.keyDown(composer, { key: 'Enter' });
    }
    expect(cards()).toHaveLength(11);
    // Still READY: repetition is data, not a defect.
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.queryByText(/duplicate speaker|unused|out of order|unusual/i)).toBeNull();
  });

  it('reports a deleted speaker exactly as validate.ts does, and offers the bulk fix', () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole('tab', { name: 'Roster' }));
    const roster = screen.getByRole('region', { name: 'Roster' });
    const menu = within(roster).getAllByRole('button', { name: 'More actions' })[0];
    fireEvent.click(menu as HTMLElement);
    const del = within(roster).getAllByRole('button', { name: 'Delete' })[0];
    fireEvent.click(del as HTMLElement);

    expect(screen.getAllByText('Segment references a deleted speaker').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Remove the 1 segments/ })).toBeInTheDocument();
    // An error, and only an error, disables APPLY.
    expect(screen.getByRole('button', { name: /^Apply/ })).toBeDisabled();
  });

  it('reorders a segment with Alt+ArrowDown and announces the new position', () => {
    render(<Editor />);
    const first = cards()[0] as HTMLElement;
    const label = first.querySelector('.scard__label')?.textContent;
    fireEvent.keyDown(first, { key: 'ArrowDown', altKey: true });
    expect(cards()[1]?.querySelector('.scard__label')?.textContent).toBe(label);
    expect(screen.getByText('Moved to position 2 of 9')).toBeInTheDocument();
  });

  it('creates the next roster row from Enter in a name field', () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole('tab', { name: 'Roster' }));
    const roster = screen.getByRole('region', { name: 'Roster' });
    const before = within(roster).getAllByRole('listitem').length;
    fireEvent.keyDown(within(roster).getByLabelText('Proposition · Speaker 1'), { key: 'Enter' });
    expect(within(roster).getAllByRole('listitem')).toHaveLength(before + 1);
  });

  it('undoes an edit with its own stack', () => {
    render(<Editor />);
    const composer = screen.getByRole('combobox', { name: 'Add segment' });
    fireEvent.change(composer, { target: { value: 'free' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(cards()).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(cards()).toHaveLength(9);
  });

  it('presents ADVANCE and free-debate exclusivity as neutral settings', () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole('tab', { name: 'Inspector' }));
    const arm = screen.getByRole('radio', { name: /Load the next segment, paused/ });
    const auto = screen.getByRole('radio', { name: /Load the next segment and start it/ });
    expect(arm).toBeChecked();
    fireEvent.click(auto);
    expect(screen.getByRole('radio', { name: /Load the next segment and start it/ })).toBeChecked();

    expect(screen.getByRole('radio', { name: /One side at a time/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /Both sides may run at once/ }));
    expect(screen.getByRole('radio', { name: /Both sides may run at once/ })).toBeChecked();
  });
});
