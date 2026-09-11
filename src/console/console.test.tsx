/**
 * The console's own promises.
 *
 * These are the assertions that would be expensive to discover at a tournament: that SWAP
 * is gone rather than dead, that nothing is disabled in overtime, that a button does what
 * its label says on one click, that going back is a control on the timeline strip, and that
 * the run order is drawn exactly as the operator arranged it — repeats, omissions and all.
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { openConfig } from '../app/boot';
import { bindingsFor } from '../app/hotkeys';
import type { RoundConfig } from '../domain/config';
import { chessClockId } from '../domain/plan';
import { PRESET_KEYS, instantiatePreset } from '../domain/presets';
import { now } from '../engine/chronometer';
import { paintSoon } from '../engine/loop';
import { canSwap, clockView } from '../engine/selectors';
import { dispatch, getSession } from '../engine/store';
import Console from '../screens/Console';

function key(init: KeyboardEventInit): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
    window.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, ...init }));
  });
}

function el(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`nothing matches ${selector}`);
  return found;
}

/** Let the frame loop paint, the way it does after every command and every frame. */
async function frames(): Promise<void> {
  await act(async () => {
    paintSoon();
    for (let i = 0; i < 2; i += 1) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    }
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

/** The first speech. The preset opens on a prep phase, so index 0 is nobody's turn. */
function firstSpeechIndex(): number {
  return getSession().plan.segments.findIndex((s) => s.kind === 'speech');
}

function remainingOf(index: number): number {
  const s = getSession();
  const id = s.plan.segments[index]?.primaryClockId;
  if (id === undefined) throw new Error(`no segment ${index}`);
  const view = clockView(s.state, s.plan, id, now());
  if (!view) throw new Error(`no clock for segment ${index}`);
  return view.remainingMs;
}

beforeEach(() => {
  openChinese();
});

afterEach(() => {
  cleanup();
});

test('nothing is printed beside the figures, and no speaker name under the ring', () => {
  const i = firstSpeechIndex();
  act(() => {
    dispatch({ t: 'LOAD', cursor: i });
    dispatch({ t: 'START' });
  });
  render(<Console />);

  const figures = [...document.querySelectorAll<HTMLElement>('.uteam .udeb')];
  expect(figures).toHaveLength(getSession().config.speakers.length);
  expect(document.querySelector('.udeb__name')).toBeNull();
  for (const figure of figures) {
    // The figure draws its number and nothing else; the name is read to assistive tech.
    expect(figure.querySelector('.udeb__stack')?.textContent ?? '').toMatch(/^\d+$/);
    const drawnOutsideTheFigure = [...figure.children].filter(
      (child) => !child.classList.contains('udeb__stack') && !child.classList.contains('u-sr'),
    );
    expect(drawnOutsideTheFigure).toHaveLength(0);
  }

  const { segments } = getSession().plan;
  const speaking = segments[i]?.speaker?.name ?? '';
  const next = segments[i + 1]?.speaker?.name ?? '';
  expect(speaking).not.toBe('');
  expect(next).not.toBe('');
  const caption = el('.ucore__caption').textContent ?? '';
  expect(caption).not.toContain(speaking);
  expect(caption).not.toContain(next);
  // The next segment is still named, by its own label and length.
  expect(el('.ucore__next').textContent ?? '').toMatch(/\d:\d\d/);
});

test('before the round the ring holds the first segment’s time, and Start arms it there', () => {
  const { segments, totalMs } = getSession().plan;
  // The preset opens on its 5:00 prep phase, in a 34:00 round.
  expect(segments[0]?.allottedMs).toBe(300_000);
  expect(totalMs).toBe(2_040_000);
  render(<Console />);

  expect(el('.ucore__ring').textContent).toContain('5:00');
  expect(el('.ucore__ring').textContent).not.toContain('34:00');
  const caption = el('.ucore__caption').textContent ?? '';
  expect(caption).toContain('Begins shortly');
  // "Up next" names the segment; its length is already the big number in the ring.
  expect(el('.ucore__next').textContent).toContain('Preparation');
  expect(caption).not.toMatch(/\d:\d\d/);

  // The first press arms segment 1 (the owner's rule), and the ring reads the same time.
  key({ key: ' ' });
  expect(getSession().state.cursor).toBe(0);
  expect(getSession().state.run).toBeNull();
  expect(el('.ucore__ring').textContent).toContain('5:00');
});

test('every control stays live past zero', () => {
  act(() => {
    dispatch({ t: 'LOAD', cursor: 1 });
    dispatch({ t: 'START' });
    // Straight past expiry: the clock now counts up and nothing may go dead.
    dispatch({ t: 'ADJUST', deltaMs: -1_000_000 });
  });
  render(<Console />);

  for (const label of ['Pause', 'Reset', 'Next', 'Back', '15s', 'Pause round']) {
    const buttons = screen.getAllByRole('button', { name: new RegExp(label, 'i') });
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(button).toBeEnabled();
  }
});

test('timer controls sit under the ring; Back and Next sit on the timeline strip', () => {
  act(() => {
    dispatch({ t: 'LOAD', cursor: firstSpeechIndex() });
  });
  render(<Console />);

  const transport = el('.transport');
  const underRing = within(transport)
    .getAllByRole('button')
    .map((b) => b.textContent ?? '');
  expect(underRing.some((text) => /start|pause|resume/i.test(text))).toBe(true);
  expect(underRing.some((text) => /reset/i.test(text))).toBe(true);
  expect(underRing.some((text) => /back|next/i.test(text))).toBe(false);

  const strip = el('.tline');
  expect(within(strip).getByRole('button', { name: /back/i })).toBeEnabled();
  expect(within(strip).getByRole('button', { name: /next/i })).toBeEnabled();
  // One Next on the whole screen, not one per band.
  expect(screen.getAllByRole('button', { name: /next/i })).toHaveLength(1);
});

test('Back takes a mistaken advance back, at the remembered time, from a click', () => {
  const i = firstSpeechIndex();
  act(() => {
    dispatch({ t: 'LOAD', cursor: i });
    dispatch({ t: 'ADJUST', deltaMs: -42_000 });
  });
  const before = remainingOf(i);
  render(<Console />);
  const strip = el('.tline');

  fireEvent.click(within(strip).getByRole('button', { name: /next/i }));
  expect(getSession().state.cursor).toBe(i + 1);

  fireEvent.click(within(strip).getByRole('button', { name: /back/i }));
  expect(getSession().state.cursor).toBe(i);
  expect(remainingOf(i)).toBe(before);
});

test('Reset puts the segment back to full time on a single click', () => {
  const i = firstSpeechIndex();
  act(() => {
    dispatch({ t: 'LOAD', cursor: i });
    dispatch({ t: 'START' });
    dispatch({ t: 'ADJUST', deltaMs: -60_000 });
  });
  render(<Console />);
  const full = getSession().plan.segments[i]?.allottedMs ?? 0;
  expect(remainingOf(i)).toBeLessThanOrEqual(full - 60_000);

  // A plain click: no press-and-hold, no confirm.
  fireEvent.click(within(el('.transport')).getByRole('button', { name: /reset/i }));

  expect(remainingOf(i)).toBe(full);
  expect(getSession().state.run).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('R resets on one press, too', () => {
  const i = firstSpeechIndex();
  act(() => {
    dispatch({ t: 'LOAD', cursor: i });
    dispatch({ t: 'ADJUST', deltaMs: -30_000 });
  });
  render(<Console />);
  key({ key: 'r' });
  expect(remainingOf(i)).toBe(getSession().plan.segments[i]?.allottedMs);
});

test('the console has no undo or redo: no buttons, no chip, and Ctrl+Z does nothing', () => {
  const consoleActions = bindingsFor('console').map((b): string => b.action);
  expect(consoleActions).not.toContain('undo');
  expect(consoleActions).not.toContain('redo');
  // The editor keeps its draft history.
  const editorActions = bindingsFor('editor').map((b): string => b.action);
  expect(editorActions).toEqual(expect.arrayContaining(['undo', 'redo']));

  act(() => {
    dispatch({ t: 'LOAD', cursor: 0 });
  });
  render(<Console />);
  expect(screen.queryByRole('button', { name: /undo|redo/i })).toBeNull();

  // An advance raises nothing.
  key({ key: 'n' });
  expect(document.querySelector('.undochip')).toBeNull();

  act(() => {
    dispatch({ t: 'ADJUST', deltaMs: -15_000 });
  });
  const before = getSession().state;
  key({ key: 'z', ctrlKey: true });
  key({ key: 'z', ctrlKey: true, shiftKey: true });
  key({ key: 'z', metaKey: true });
  expect(getSession().state).toBe(before);
});

test('each side’s give-floor button sits under its own time and hides while that side runs', () => {
  const i = chessIndex();
  act(() => {
    dispatch({ t: 'LOAD', cursor: i });
  });
  render(<Console />);
  const barA = el('.ubar[data-side="A"]');
  const barB = el('.ubar[data-side="B"]');

  const giveA = within(barA).getByRole('button', { name: /give floor to proposition/i });
  expect(within(barB).getByRole('button', { name: /give floor to opposition/i })).toBeEnabled();
  // Below that side's own digits — and nowhere in the row under the ring.
  const digitsA = el('.ubar[data-side="A"] .ubar__digits');
  expect(digitsA.compareDocumentPosition(giveA) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(el('.transport')).queryByRole('button', { name: /give floor/i })).toBeNull();

  // Proposition opens. Giving it the floor again would do nothing, so its button goes.
  act(() => {
    dispatch({ t: 'START' });
  });
  expect(getSession().state.floor).toBe('A');
  expect(within(barA).queryByRole('button', { name: /give floor/i })).toBeNull();

  // Opposition's hands over, from a click, and then it is Opposition's that goes.
  fireEvent.click(within(barB).getByRole('button', { name: /give floor to opposition/i }));
  const segId = getSession().plan.segments[i]?.segId ?? '';
  expect(getSession().state.floor).toBe('B');
  expect(getSession().state.run?.clockId).toBe(chessClockId(segId, 'B'));
  expect(within(barB).queryByRole('button', { name: /give floor/i })).toBeNull();
  expect(within(barA).getByRole('button', { name: /give floor to proposition/i })).toBeEnabled();
});

test('the on-deck figure waits half-lit, then steps up once the live clock runs out', async () => {
  // No bell at zero, so nothing but the passage of time can change the figure.
  const config = instantiatePreset('chinese4v4');
  config.rules = { ...config.rules, cues: [] };
  act(() => {
    openConfig(config, { recent: false });
  });
  const i = firstSpeechIndex();
  const full = getSession().plan.segments[i]?.allottedMs ?? 0;
  act(() => {
    dispatch({ t: 'LOAD', cursor: i });
    dispatch({ t: 'START' });
    dispatch({ t: 'ADJUST', deltaMs: -(full - 400) });
  });
  render(<Console />);
  await frames();

  const onDeck = (): HTMLElement => el('.uteam .udeb[data-state="next"]');
  expect(onDeck().hasAttribute('data-urgent')).toBe(false);

  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 700);
    });
  });
  await frames();
  expect(onDeck().hasAttribute('data-urgent')).toBe(true);

  // Time back on the clock: the next speaker waits again.
  act(() => {
    dispatch({ t: 'ADJUST', deltaMs: 60_000 });
  });
  await frames();
  expect(onDeck().hasAttribute('data-urgent')).toBe(false);
});

test('there is no prep bank on the console: no chip under a roster, and Q and W do nothing', () => {
  for (const presetKey of PRESET_KEYS) {
    for (const side of instantiatePreset(presetKey).sides) expect(side.prepBankMs).toBe(0);
  }

  // Even a round saved with banks shows no control for them, and the keys stay dead.
  const config = instantiatePreset('chinese4v4');
  config.sides = [
    { ...config.sides[0], prepBankMs: 60_000 },
    { ...config.sides[1], prepBankMs: 60_000 },
  ];
  act(() => {
    openConfig(config, { recent: false });
  });
  act(() => {
    dispatch({ t: 'LOAD', cursor: firstSpeechIndex() });
  });
  render(<Console />);
  expect(document.querySelector('.uteam__bank')).toBeNull();
  expect(screen.queryByText(/prep bank/i)).toBeNull();

  const actions = bindingsFor('console').map((b): string => b.action);
  expect(actions).not.toContain('bankA');
  expect(actions).not.toContain('bankB');
  const before = getSession().state;
  key({ key: 'q' });
  key({ key: 'w' });
  expect(getSession().state).toBe(before);
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

test('the Ribbon draws the operator’s order verbatim and flags nothing about it', () => {
  // Speaker 3 before speaker 2, speaker 2 twice, speaker 1 never: all intentional.
  const config = instantiatePreset('chinese4v4');
  // Ids are re-minted per instance, so find the speeches by who gives them.
  const speechBy = (name: string) => {
    const id = config.speakers.find((p) => p.name === name)?.id;
    return config.segments.find((s) => s.kind === 'speech' && s.speakerId === id);
  };
  const a1 = speechBy('正一');
  const a3 = speechBy('正三');
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

test('the strip numbers the opposition negative, with arrows between squares and no underline', () => {
  render(<Console />);
  const pips = screen.getAllByRole('option');
  const { segments } = getSession().plan;
  let checked = 0;
  segments.forEach((ps, i) => {
    if (ps.kind !== 'speech' || ps.speaker === null) return;
    const mark = pips[i]?.textContent ?? '';
    expect(mark).toMatch(ps.speaker.side === 'B' ? /^\u2212\d+$/ : /^\d+$/);
    checked += 1;
  });
  expect(checked).toBeGreaterThan(0);
  expect(document.querySelectorAll('.tline__arrow')).toHaveLength(pips.length - 1);
  expect(document.querySelector('.tline__tick')).toBeNull();
});

/* ------------------------------------------------------------ reload, home, hold */

import { restoreSession } from '../app/boot';
import { plan as planOf } from '../domain/plan';
import { nowFrom } from '../engine/chronometer';
import { readLive } from '../engine/persist';
import { loadRound } from '../engine/store';
import { setLang } from '../i18n/useLang';
import { KeyLegendOverlay } from '../ui/KeyLegendOverlay';

/** The page goes away: this document's round is gone, and boot starts from storage. */
function pageGoesAway(): void {
  act(() => {
    loadRound(planOf(instantiatePreset('bp')), { markApplied: false, persist: false });
  });
}

test('a reload puts a paused round back at the same segment and the same time', () => {
  const i = firstSpeechIndex();
  act(() => {
    dispatch({ t: 'LOAD', cursor: i });
    dispatch({ t: 'START' });
    dispatch({ t: 'ADJUST', deltaMs: -3_000 });
    dispatch({ t: 'PAUSE' });
  });
  const before = remainingOf(i);
  expect(readLive()?.state.cursor).toBe(i);

  pageGoesAway();
  act(() => {
    restoreSession();
  });

  expect(getSession().state.cursor).toBe(i);
  expect(remainingOf(i)).toBe(before);
  // Restoring wrote nothing over the snapshot it restored from.
  expect(readLive()?.state.cursor).toBe(i);

  render(<Console />);
  expect(el('.utop__meta').textContent).toContain(`Segment ${i + 1} of`);
});

test('a reload puts a running clock back, charged the wall time the page was away', () => {
  const i = firstSpeechIndex();
  const started = now();
  act(() => {
    dispatch({ t: 'LOAD', cursor: i }, started);
    dispatch({ t: 'START' }, started);
  });
  const full = getSession().plan.segments[i]?.allottedMs ?? 0;

  pageGoesAway();
  // A new document: its monotonic clock starts somewhere else, seven seconds of wall
  // time later.
  const back = nowFrom(50, started.epoch + 7_000);
  act(() => {
    restoreSession(back);
  });

  const s = getSession();
  expect(s.state.cursor).toBe(i);
  expect(s.state.run).not.toBeNull();
  const id = s.plan.segments[i]?.primaryClockId ?? '';
  expect(clockView(s.state, s.plan, id, back)?.remainingMs).toBe(full - 7_000);
});

test('the header line says where the round is and how long it has run, and nothing more', () => {
  render(<Console />);
  // Skipped segments are exactly what made an ahead-of-schedule verdict meaningless.
  act(() => {
    for (let i = 0; i < 6; i += 1) dispatch({ t: 'ADVANCE' });
  });
  const meta = el('.utop__meta').textContent ?? '';
  expect(meta).toContain(`Segment 6 of ${getSession().plan.segments.length}`);
  expect(meta).toMatch(/Round\d+:\d\d\/\d+:\d\d/);
  expect(meta).not.toMatch(/schedule|[+−]\d+:\d\d/i);
  // The rosters carry the side names; the header does not repeat them.
  for (const side of getSession().config.sides) expect(meta).not.toContain(side.label.en);
});

test('the console has a way home, and going there keeps the round where it was', () => {
  const i = firstSpeechIndex();
  act(() => {
    dispatch({ t: 'LOAD', cursor: i });
  });
  render(<Console />);
  fireEvent.click(within(el('.utop')).getByRole('button', { name: 'Home' }));
  expect(location.hash).toBe('#/');
  expect(getSession().state.cursor).toBe(i);
});

test('a held round offers one way to resume it, not two', () => {
  act(() => {
    dispatch({ t: 'LOAD', cursor: firstSpeechIndex() });
    dispatch({ t: 'START' });
    dispatch({ t: 'HOLD' });
  });
  render(<Console />);
  expect(screen.getAllByRole('button', { name: /resume round/i })).toHaveLength(1);
  expect(screen.queryByRole('button', { name: /pause round/i })).toBeNull();
});

test('in free debate Space pauses and resumes the side with the floor, as the button does', () => {
  const i = chessIndex();
  act(() => {
    dispatch({ t: 'LOAD', cursor: i });
  });
  render(<Console />);
  const segId = getSession().plan.segments[i]?.segId ?? '';
  const primary = (): HTMLElement => el('.transport__main .tbtn--primary');
  const caps = (): string[] =>
    [...primary().querySelectorAll('.keycap')].map((k) => k.textContent ?? '');

  // Space is one binding with one meaning; there is no Shift Space variant to learn.
  expect(bindingsFor('console').filter((b) => b.chords.some((c) => c.key === ' '))).toHaveLength(1);

  // Nobody running: Space starts the floor, exactly as the button does.
  expect(primary().textContent).toMatch(/Start/);
  expect(caps()).toEqual(['Space']);
  key({ key: ' ' });
  expect(getSession().state.run?.clockId).toBe(chessClockId(segId, 'A'));

  // One side running: the button pauses it, and so does Space. The floor stays put.
  expect(primary().textContent).toMatch(/Pause/);
  expect(caps()).toEqual(['Space']);
  key({ key: ' ' });
  expect(getSession().state.run).toBeNull();
  expect(getSession().state.floor).toBe('A');
  expect(primary().textContent).not.toMatch(/Pause/);
  expect(caps()).toEqual(['Space']);

  // Shift Space is not a second pause key any more.
  const paused = getSession().state;
  key({ key: ' ', shiftKey: true });
  expect(getSession().state).toBe(paused);

  // Space resumes the same side; handing the floor over is the arrow keys' job.
  key({ key: ' ' });
  expect(getSession().state.run?.clockId).toBe(chessClockId(segId, 'A'));
  key({ key: 'ArrowRight' });
  expect(getSession().state.floor).toBe('B');
  expect(getSession().state.run?.clockId).toBe(chessClockId(segId, 'B'));
});

test('fullscreen is a button in the top bar as well as F, and it follows the real state', async () => {
  // jsdom has no Fullscreen API, which is also what a phone without one looks like.
  render(<Console />);
  expect(within(el('.utop')).queryByRole('button', { name: /fullscreen/i })).toBeNull();
  cleanup();

  let element: Element | null = null;
  const changed = (next: Element | null): void => {
    element = next;
    document.dispatchEvent(new Event('fullscreenchange'));
  };
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => true });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => element });
  const request = vi.fn(async () => {
    changed(document.documentElement);
  });
  document.documentElement.requestFullscreen = request;
  document.exitFullscreen = vi.fn(async () => {
    changed(null);
  });
  try {
    render(<Console />);
    const enter = within(el('.utop')).getByRole('button', { name: 'Fullscreen' });
    expect(enter).toHaveAttribute('aria-keyshortcuts', 'F');
    expect(enter.getAttribute('title')).toBe('Fullscreen · F');

    await act(async () => {
      fireEvent.click(enter);
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(within(el('.utop')).getByRole('button', { name: 'Exit fullscreen' })).toBeTruthy();

    // Leaving with Esc goes through the browser, not the button, and still shows.
    act(() => {
      changed(null);
    });
    expect(within(el('.utop')).getByRole('button', { name: 'Fullscreen' })).toBeTruthy();
  } finally {
    for (const prop of ['fullscreenEnabled', 'fullscreenElement', 'exitFullscreen']) {
      Reflect.deleteProperty(document, prop);
    }
    Reflect.deleteProperty(document.documentElement, 'requestFullscreen');
  }
});

test('the keyboard legend speaks the interface language, one row per binding', () => {
  act(() => {
    setLang('zh');
  });
  try {
    render(<KeyLegendOverlay open onClose={() => undefined} context="console" />);
    const dialog = screen.getByRole('dialog');
    const text = dialog.textContent ?? '';
    expect(text).toContain('重置本环节');
    expect(text).not.toContain('Reset the segment');
    const esc = [...dialog.querySelectorAll('.keycap')].filter((k) => k.textContent === 'Esc');
    expect(esc).toHaveLength(1);
  } finally {
    act(() => {
      setLang('en');
    });
  }
});
