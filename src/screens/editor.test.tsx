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
import { KEYS, clearDraft, flushDraft, readRecents } from '../engine/persist';
import { dispatch, getSession, loadRound } from '../engine/store';
import { currentRoute, navigate, replaceRoute } from '../app/router';

beforeEach(() => {
  clearDraft();
  localStorage.clear();
  // Opened from the console unless a test says otherwise: Back returns to where it came from.
  replaceRoute('#/console');
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

/** Type into a time box the way the operator does: focus, replace the text, commit. */
function typeTime(field: HTMLElement, text: string, commit: 'blur' | 'enter' = 'blur'): void {
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: text } });
  if (commit === 'enter') fireEvent.keyDown(field, { key: 'Enter' });
  else fireEvent.blur(field);
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

  it('Enter in a name confirms it and moves to the next name on that side, adding nobody', () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole('tab', { name: 'Roster' }));
    const roster = screen.getByRole('region', { name: 'Roster' });
    const before = within(roster).getAllByRole('listitem').length;

    const name = within(roster).getByLabelText('Opposition · Speaker 2');
    fireEvent.change(name, { target: { value: 'Michael Zhao' } });
    fireEvent.keyDown(name, { key: 'Enter' });

    expect(within(roster).getAllByRole('listitem')).toHaveLength(before);
    expect(within(roster).getAllByText('4 speakers')).toHaveLength(2);
    expect(within(roster).getByLabelText('Opposition · Speaker 2')).toHaveValue('Michael Zhao');
    expect(document.activeElement).toBe(within(roster).getByLabelText('Opposition · Speaker 3'));
  });

  it("Enter on a side's last name lands on its Add speaker, and adding stays its own press", () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole('tab', { name: 'Roster' }));
    const roster = screen.getByRole('region', { name: 'Roster' });
    const before = within(roster).getAllByRole('listitem').length;

    fireEvent.keyDown(within(roster).getByLabelText('Proposition · Speaker 4'), { key: 'Enter' });
    expect(within(roster).getAllByRole('listitem')).toHaveLength(before);
    const addProposition = within(roster).getAllByRole('button', { name: 'Add speaker' })[0] as HTMLElement;
    expect(document.activeElement).toBe(addProposition);

    fireEvent.click(addProposition);
    expect(within(roster).getAllByRole('listitem')).toHaveLength(before + 1);
    expect(document.activeElement).toBe(within(roster).getByLabelText('Proposition · Speaker 5'));
  });

  it('an Enter that ends an IME composition does nothing', () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole('tab', { name: 'Roster' }));
    const roster = screen.getByRole('region', { name: 'Roster' });
    const name = within(roster).getByLabelText('Opposition · Speaker 2');
    name.focus();

    fireEvent.keyDown(name, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(name, { key: 'Enter', keyCode: 229 });

    expect(document.activeElement).toBe(name);
    expect(within(roster).getAllByText('4 speakers')).toHaveLength(2);
  });

  it('undoes an edit with its own stack', () => {
    render(<Editor />);
    add('Free debate');
    expect(rows()).toHaveLength(11);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(rows()).toHaveLength(10);
  });

  it("a speech row's time is its speaker's, so the roster and every speech by them agree", () => {
    render(<Editor />);
    add('正一'); // the same speaker again, as row 11
    const opening = rows()[1] as HTMLElement;
    typeTime(within(opening).getByLabelText("Segment 2 · 正一's time"), '3:30', 'enter');

    const roster = screen.getByRole('region', { name: 'Roster' });
    expect(within(roster).getByLabelText('Proposition · Speaker 1 · Time')).toHaveValue('3:30');
    expect(within(rows()[10] as HTMLElement).getByLabelText("Segment 11 · 正一's time")).toHaveValue('3:30');
    // No speech has a time of its own, so nothing is marked.
    expect(opening.querySelector('.step__note')).toBeNull();
    // 14:30 before; +0:30 on the opening, +3:30 for the repeat.
    expect(screen.getByText('Floor time with free debate: Proposition 18:30 · Opposition 14:30')).toBeInTheDocument();
  });

  it('a time for one speech lives in its details, and is marked only while it differs', () => {
    render(<Editor />);
    const row = rows()[1] as HTMLElement;
    const toggle = row.querySelector('.step__toggle') as HTMLElement;
    expect(row.querySelector('.step__note')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(row).getByRole('combobox', { name: 'Speaker' })).toBeInTheDocument();
    expect(
      within(row).getByText('A different time for this one speech. The roster stays as it is.'),
    ).toBeInTheDocument();

    typeTime(within(row).getByLabelText('This speech only'), '4:00');
    expect(row.querySelector('.step__note')?.textContent).toBe('Custom 4:00');
    // The speaker keeps their time, in the roster and in the row's own box.
    const roster = screen.getByRole('region', { name: 'Roster' });
    expect(within(roster).getByLabelText('Proposition · Speaker 1 · Time')).toHaveValue('3:00');
    expect(within(row).getByLabelText("Segment 2 · 正一's time")).toHaveValue('3:00');

    // Set back to the speaker's own time, it is no exception and the mark goes.
    typeTime(within(row).getByLabelText('This speech only'), '3:00');
    expect(row.querySelector('.step__note')).toBeNull();

    typeTime(within(row).getByLabelText('This speech only'), '4:30');
    expect(row.querySelector('.step__note')?.textContent).toBe('Custom 4:30');
    fireEvent.click(within(row).getByRole('button', { name: "Use 正一's time (3:00)" }));
    expect(row.querySelector('.step__note')).toBeNull();
  });

  it('an old per-speech time that only matched the speaker follows the speaker from then on', () => {
    const config = instantiateConfig(chinese4v4);
    const opening = config.segments.find((s) => s.kind === 'speech');
    if (opening?.kind === 'speech') opening.allottedMs = 180_000;
    loadRound(plan(config), { markApplied: false });
    render(<Editor />);

    const row = rows()[1] as HTMLElement;
    expect(row.querySelector('.step__note')).toBeNull();
    typeTime(within(row).getByLabelText("Segment 2 · 正一's time"), '3:30', 'enter');
    expect(row.querySelector('.step__note')).toBeNull();
    expect(screen.getByText('Floor time with free debate: Proposition 15:00 · Opposition 14:30')).toBeInTheDocument();
  });

  it('the roster heads count speakers only; the strip has the one set of side totals, and says what it counts', () => {
    render(<Editor />);
    const roster = screen.getByRole('region', { name: 'Roster' });
    for (const head of within(roster).getAllByRole('heading', { level: 3 })) {
      expect(head.textContent).not.toMatch(/\d:\d\d/);
    }
    expect(screen.getByText('Floor time with free debate: Proposition 14:30 · Opposition 14:30')).toHaveAttribute(
      'title',
      "Each side's speeches plus its free-debate clock. Prep, shared clocks and breaks are not counted.",
    );
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

  it('Back returns to launch when the editor was opened from a format card', () => {
    replaceRoute('#/');
    navigate('#/edit');
    render(<Editor />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(currentRoute().name).toBe('launch');
  });

  it('Back to launch still asks first when edits are unapplied', () => {
    replaceRoute('#/');
    navigate('#/edit');
    render(<Editor />);
    add('Break');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(currentRoute().name).toBe('edit');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Apply and leave' }));
    expect(getSession().config.segments).toHaveLength(11);
    expect(currentRoute().name).toBe('launch');
  });

  it('Back returns to the console when the editor was opened from the console', () => {
    replaceRoute('#/console');
    navigate('#/edit');
    render(<Editor />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(currentRoute().name).toBe('console');
  });
});

describe('time boxes', () => {
  it('an unreadable time says so, marks the box invalid, and puts the old value back', () => {
    render(<Editor />);
    const box = within(rows()[5] as HTMLElement).getByLabelText("Segment 6 · 正三's time");
    typeTime(box, 'abc', 'enter');

    expect(box).toHaveValue('2:00');
    expect(box).toHaveAttribute('aria-invalid', 'true');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't read that, try 3:00 or 180");
    expect(box).toHaveAttribute('aria-describedby', alert.id);

    // Typing again clears the notice.
    fireEvent.change(box, { target: { value: '2' } });
    expect(box).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says how a bare number will be read before it is committed', () => {
    render(<Editor />);
    const box = within(rows()[5] as HTMLElement).getByLabelText("Segment 6 · 正三's time");
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '150' } });
    expect(screen.getByText('150 sec → 2:30')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: '3' } });
    expect(screen.getByText('3 min → 3:00')).toBeInTheDocument();

    fireEvent.change(box, { target: { value: '150' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box).toHaveValue('2:30');
  });
});

describe('the ready line', () => {
  it('counts its notes instead of sitting silently beside them', () => {
    render(<Editor />);
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.queryByText(/\d+ notes?$/)).toBeNull();

    fireEvent.change(screen.getByLabelText('Opposition · Speaker 2'), { target: { value: '' } });
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('· 1 note')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Speaker has no name' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Proposition · Speaker 2'), { target: { value: '' } });
    expect(screen.getByText('· 2 notes')).toBeInTheDocument();
    // Notes never gate anything.
    expect(applyButton()).toBeEnabled();
  });
});

describe('the commit button', () => {
  function ctrlEnter(): void {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    });
  }

  for (const [from, name] of [
    ['#/', 'a format card'],
    ['#/summary', 'the summary'],
  ] as const) {
    it(`opened from ${name}, is Run now, and opens the timer even with nothing to apply`, () => {
      replaceRoute(from);
      navigate('#/edit');
      render(<Editor />);
      expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
      const run = screen.getByRole('button', { name: 'Run now' });
      expect(run).toBeEnabled();
      expect(run.getAttribute('title')).toMatch(/^Open the timer \(/);

      fireEvent.click(run);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(currentRoute().name).toBe('console');
    });
  }

  it('Run now applies the edits first, without asking, and lists the round', () => {
    replaceRoute('#/');
    navigate('#/edit');
    render(<Editor />);
    fireEvent.change(screen.getByLabelText('Proposition · Speaker 1'), { target: { value: 'Michael Zhao' } });
    const run = screen.getByRole('button', { name: 'Run now' });
    expect(run.getAttribute('title')).toMatch(/^Apply your changes and open the timer \(/);

    fireEvent.click(run);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(currentRoute().name).toBe('console');
    expect(getSession().config.speakers.some((s) => s.name === 'Michael Zhao')).toBe(true);
    expect(readRecents().map((entry) => entry.id)).toContain(getSession().config.id);
    // Applied, so nothing is left to offer back as unapplied.
    flushDraft();
    expect(localStorage.getItem(KEYS.draft)).toBeNull();
  });

  it('Run now waits until the round can run', () => {
    replaceRoute('#/');
    navigate('#/edit');
    render(<Editor />);
    deleteFirstSpeaker();
    const run = screen.getByRole('button', { name: 'Run now' });
    expect(run).toBeDisabled();
    expect(run.getAttribute('title')).toBe('Segment references a deleted speaker');
    ctrlEnter();
    expect(currentRoute().name).toBe('edit');
  });

  it('Ctrl+Enter does what the button does: from a format card it runs the round', () => {
    replaceRoute('#/');
    navigate('#/edit');
    render(<Editor />);
    add('Break');
    ctrlEnter();
    expect(currentRoute().name).toBe('console');
    expect(getSession().config.segments).toHaveLength(11);
  });

  it('opened from the console, Ctrl+Enter applies and the editor stays', () => {
    render(<Editor />);
    add('Break');
    ctrlEnter();
    expect(currentRoute().name).toBe('edit');
    expect(getSession().config.segments).toHaveLength(11);
    expect(screen.getByText('Applied')).toBeInTheDocument();
  });

  it('never claims a round in progress when none is under way', () => {
    render(<Editor />);
    add('Break');
    expect(applyButton().getAttribute('title')).toMatch(/^Apply your changes \(/);
    fireEvent.click(applyButton());
    expect(screen.getByText('Changes applied')).toBeInTheDocument();
    expect(screen.queryByText(/in progress|live round/)).toBeNull();

    add('Break');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Until you apply them, the round stays as it was.')).toBeInTheDocument();
  });

  it('under way, Apply says it reaches the round in progress', () => {
    dispatch({ t: 'ADVANCE' });
    render(<Editor />);
    add('Break');
    expect(applyButton().getAttribute('title')).toMatch(/^Apply to the round in progress \(/);
    fireEvent.click(applyButton());
    expect(screen.getByText('Applied to the round in progress')).toBeInTheDocument();
  });

  it('keeps a draft only while something is unapplied', () => {
    render(<Editor />);
    flushDraft();
    expect(localStorage.getItem(KEYS.draft)).toBeNull();

    add('Break');
    flushDraft();
    expect(localStorage.getItem(KEYS.draft)).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    flushDraft();
    expect(localStorage.getItem(KEYS.draft)).toBeNull();
  });
});
