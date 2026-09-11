/**
 * Editor contract tests.
 *
 * The point of most of these is what the editor does NOT say. A repeated speaker, an
 * omitted speaker and an out-of-sequence order are the operator's run sheet, and the
 * screen must stay silent about all three while still reporting the one thing that
 * cannot run: a segment naming a speaker the roster no longer has.
 *
 * The rest pin the fix for edits that silently never reached the round: the screen says
 * when something is unapplied, and every way out of it asks first.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import Editor from './Editor';
import { chinese4v4, instantiateConfig } from '../domain/presets';
import { plan } from '../domain/plan';
import { KEYS, clearDraft, flushDraft } from '../engine/persist';
import { getSession, loadRound } from '../engine/store';
import { currentRoute, replaceRoute } from '../app/router';

beforeEach(() => {
  clearDraft();
  localStorage.clear();
  replaceRoute('#/edit');
  loadRound(plan(instantiateConfig(chinese4v4)), { markApplied: false });
});

afterEach(() => {
  cleanup();
});

/** The run order's rows, top to bottom. */
function rows(): HTMLElement[] {
  const order = screen.getByRole('region', { name: 'Run sheet' });
  const list = order.querySelector('ol');
  return list === null ? [] : Array.from(list.children).filter((el): el is HTMLElement => el instanceof HTMLElement);
}

/** Press one of the labelled add buttons under the order. */
function add(name: string): void {
  const bar = screen.getByRole('group', { name: 'Add' });
  fireEvent.click(within(bar).getByRole('button', { name }));
}

function applyButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Apply' });
}

function deleteFirstSpeaker(): void {
  fireEvent.click(screen.getByRole('tab', { name: 'Roster' }));
  const roster = screen.getByRole('region', { name: 'Roster' });
  fireEvent.click(within(roster).getAllByRole('button', { name: 'More actions' })[0] as HTMLElement);
  fireEvent.click(within(roster).getAllByRole('button', { name: 'Delete' })[0] as HTMLElement);
}

describe('Editor', () => {
  it('lays the round out as a roster and the operator order, one row per segment', () => {
    render(<Editor />);
    expect(screen.getByRole('region', { name: 'Roster' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Run sheet' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Inspector' })).toBeNull();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(rows()).toHaveLength(10);
  });

  it('appends a repeated speaker and says nothing about it', () => {
    render(<Editor />);
    add('正一');
    add('正一');
    expect(rows()).toHaveLength(12);
    // Still READY: repetition is data, not a defect.
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.queryByText(/duplicate speaker|repeated|unused|out of order|unusual/i)).toBeNull();
    // The repeat is drawn exactly like the first appearance — same chip, no marker.
    const original = rows()[1] as HTMLElement;
    const repeat = rows()[11] as HTMLElement;
    expect(repeat.querySelector('.step__chip')?.textContent).toBe(original.querySelector('.step__chip')?.textContent);
    expect(repeat.querySelectorAll('.step__note')).toHaveLength(0);
  });

  it('reports a deleted speaker exactly as validate.ts does, and offers the bulk fix', () => {
    render(<Editor />);
    add('Break');
    expect(applyButton()).toBeEnabled();

    deleteFirstSpeaker();

    expect(screen.getAllByText('Segment references a deleted speaker').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Remove the 1 segments/ })).toBeInTheDocument();
    // An error, and only an error, disables APPLY.
    expect(applyButton()).toBeDisabled();
  });

  it('reorders a segment with Alt+ArrowDown and announces the new position', () => {
    render(<Editor />);
    const first = rows()[0] as HTMLElement;
    const label = first.querySelector('.step__label')?.textContent;
    fireEvent.keyDown(first, { key: 'ArrowDown', altKey: true });
    expect(rows()[1]?.querySelector('.step__label')?.textContent).toBe(label);
    expect(screen.getByText('Moved to position 2 of 10')).toBeInTheDocument();
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
    add('Free debate');
    expect(rows()).toHaveLength(11);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(rows()).toHaveLength(10);
  });

  it('opens a segment in place, and marks a time only when it overrides the speaker', () => {
    render(<Editor />);
    const row = rows()[1] as HTMLElement;
    const toggle = row.querySelector('.step__toggle') as HTMLElement;
    expect(row.querySelector('.step__note')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(row).getByRole('combobox', { name: 'Speaker' })).toBeInTheDocument();
    expect(within(row).getByText("Follows 正一's time")).toBeInTheDocument();

    const time = within(row).getByLabelText('Time');
    fireEvent.focus(time);
    fireEvent.change(time, { target: { value: '3:30' } });
    fireEvent.blur(time);
    expect(row.querySelector('.step__note')?.textContent).toBe('Custom');

    fireEvent.click(within(row).getByRole('button', { name: "Use 正一's time (3:00)" }));
    expect(row.querySelector('.step__note')).toBeNull();
  });

  it('keeps prep banks out of the round settings, and the two behaviours neutral', () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const dialog = screen.getByRole('dialog', { name: 'Round settings' });
    expect(within(dialog).queryByText(/prep bank/i)).toBeNull();

    const advance = within(dialog).getByRole('radiogroup', { name: 'What ADVANCE does' });
    const free = within(dialog).getByRole('radiogroup', { name: 'Free-debate side clocks' });
    for (const group of [advance, free]) {
      expect(within(group).queryByText(/recommended|default|legacy/i)).toBeNull();
    }

    expect(within(advance).getByRole('radio', { name: /Load the next segment, paused/ })).toBeChecked();
    fireEvent.click(within(advance).getByRole('radio', { name: /Load the next segment and start it/ }));
    expect(within(advance).getByRole('radio', { name: /Load the next segment and start it/ })).toBeChecked();

    expect(within(free).getByRole('radio', { name: /One side at a time/ })).toBeChecked();
    fireEvent.click(within(free).getByRole('radio', { name: /Both sides may run at once/ }));
    expect(within(free).getByRole('radio', { name: /Both sides may run at once/ })).toBeChecked();
  });

  it('says when edits are unapplied, and Apply hands them to the round', () => {
    render(<Editor />);
    expect(applyButton()).toBeDisabled();
    expect(screen.queryByText('Unapplied changes')).toBeNull();

    add('Break');
    expect(screen.getByText('Unapplied changes')).toBeInTheDocument();
    expect(applyButton()).toBeEnabled();

    fireEvent.click(applyButton());
    expect(getSession().config.segments).toHaveLength(11);
    expect(screen.queryByText('Unapplied changes')).toBeNull();
    expect(applyButton()).toBeDisabled();
  });
});

describe('leaving the editor', () => {
  const dialog = (): HTMLElement => screen.getByRole('dialog', { name: 'Apply your changes?' });

  /** The browser has already moved by the time the router hears about it. */
  function browserGoesTo(hash: string, event: 'popstate' | 'hashchange'): void {
    act(() => {
      history.pushState(null, '', hash);
      window.dispatchEvent(event === 'popstate' ? new PopStateEvent('popstate') : new Event('hashchange'));
    });
  }

  it('leaves silently when nothing is unapplied', () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(currentRoute().name).toBe('console');
  });

  it('asks before Back leaves unapplied edits behind', () => {
    render(<Editor />);
    add('Break');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(within(dialog()).getByRole('button', { name: 'Apply and leave' })).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Discard changes' })).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Keep editing' })).toBeInTheDocument();
    expect(currentRoute().name).toBe('edit');
  });

  it('asks on Esc through the same guard', () => {
    render(<Editor />);
    add('Break');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(dialog()).toBeInTheDocument();
    expect(currentRoute().name).toBe('edit');
  });

  it('Keep editing stays, edits and all', () => {
    render(<Editor />);
    add('Break');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(currentRoute().name).toBe('edit');
    expect(rows()).toHaveLength(11);
    expect(screen.getByText('Unapplied changes')).toBeInTheDocument();
  });

  it('Discard leaves, and the discarded edits do not come back next time', () => {
    render(<Editor />);
    add('Break');
    flushDraft();
    expect(localStorage.getItem(KEYS.draft)).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Discard changes' }));
    expect(currentRoute().name).toBe('console');
    expect(localStorage.getItem(KEYS.draft)).toBeNull();
    expect(getSession().config.segments).toHaveLength(10);

    cleanup();
    replaceRoute('#/edit');
    render(<Editor />);
    expect(rows()).toHaveLength(10);
    expect(screen.queryByText('Unapplied changes')).toBeNull();
  });

  it('Apply and leave applies the draft, then leaves', () => {
    render(<Editor />);
    add('Break');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Apply and leave' }));
    expect(getSession().config.segments).toHaveLength(11);
    expect(currentRoute().name).toBe('console');
  });

  it('offers Fix errors instead of Apply when the draft cannot run', () => {
    render(<Editor />);
    deleteFirstSpeaker();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(within(dialog()).queryByRole('button', { name: 'Apply and leave' })).toBeNull();

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Fix errors' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(currentRoute().name).toBe('edit');
    // The row naming the deleted speaker is opened for repair.
    expect(rows()[1]?.querySelector('.step__toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  it('guards the browser Back button, and puts the editor address back', () => {
    render(<Editor />);
    add('Break');
    browserGoesTo('#/console', 'popstate');
    expect(dialog()).toBeInTheDocument();
    expect(currentRoute().name).toBe('edit');
    expect(location.hash.startsWith('#/edit')).toBe(true);
  });

  it('lets the browser Back button through when nothing is unapplied', () => {
    render(<Editor />);
    browserGoesTo('#/console', 'popstate');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(currentRoute().name).toBe('console');
  });

  it('guards a hand-edited address the same way', () => {
    render(<Editor />);
    add('Break');
    browserGoesTo('#/summary', 'hashchange');
    expect(dialog()).toBeInTheDocument();
    expect(currentRoute().name).toBe('edit');
  });

  it('prompts on closing the tab only while something is unapplied', () => {
    render(<Editor />);
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    add('Break');
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });
});
