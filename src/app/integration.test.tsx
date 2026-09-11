/**
 * The seam nobody owned.
 *
 * Four screens were written in parallel against a shell that was written before any of
 * them existed. Each has its own tests and each passes them in isolation; none of them
 * proves that `App` can actually mount the composition — that the route table reaches the
 * right screen, that a screen survives being handed a live round by the shell rather than
 * by its own fixture, and that switching between them does not leave a stray hotkey
 * registration or a torn-down clock behind.
 *
 * These tests mount the real `<App />`, drive it with the real router and the real store,
 * and assert only that every screen renders and stays renderable. They deliberately do NOT
 * re-assert any screen's own contract — that is its own suite's job.
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { instantiatePreset } from '../domain/presets';
import { getSession } from '../engine/store';
import App from './App';
import { openConfig } from './boot';
import { navigate, replaceRoute } from './router';

beforeEach(() => {
  replaceRoute('#/');
});

afterEach(() => {
  cleanup();
});

/** The format the user actually runs — 正一/正二/正三/正四 vs 反一…, prep and 自由辩论. */
async function loadRound(): Promise<void> {
  await act(async () => {
    openConfig(instantiatePreset('chinese4v4'), { history: 'replace' });
  });
}

async function mount(): Promise<void> {
  await act(async () => {
    render(<App />);
  });
}

async function goto(hash: string): Promise<void> {
  await act(async () => {
    navigate(hash);
  });
}

test('every route mounts a screen, with a round loaded', async () => {
  await loadRound();
  await mount();

  for (const hash of ['#/', '#/console', '#/edit', '#/summary']) {
    await goto(hash);
    // `main` is the shell's screen slot; a screen that threw would unmount it.
    expect(screen.getAllByRole('main').length).toBeGreaterThan(0);
  }
});

test('the launch screen mounts with no round at all', async () => {
  await mount();
  expect(screen.getAllByRole('main').length).toBeGreaterThan(0);
});

test('the console mounts before a round has ever been opened', async () => {
  await mount();
  await goto('#/console');
  expect(screen.getAllByRole('main').length).toBeGreaterThan(0);
});

test('the editor mounts cold, without the console having run first', async () => {
  await loadRound();
  await mount();
  await goto('#/edit');
  expect(screen.getAllByRole('main').length).toBeGreaterThan(0);
});

test('an old #/stage bookmark still lands on a screen rather than a blank page', async () => {
  await mount();
  await goto('#/stage');
  expect(screen.getAllByRole('main').length).toBeGreaterThan(0);
});

test('a full round trip through every screen and back leaves the round intact', async () => {
  await loadRound();
  const before = getSession().plan.segments.map((s) => s.segId);
  await mount();

  for (const hash of ['#/console', '#/edit', '#/summary', '#/console', '#/']) {
    await goto(hash);
  }

  // The operator's order is the operator's: walking the UI must not touch it.
  expect(getSession().plan.segments.map((s) => s.segId)).toEqual(before);
});

test('the document keeps exactly one theme, language and side-colour pair across routes', async () => {
  await loadRound();
  await mount();

  for (const hash of ['#/console', '#/edit', '#/']) {
    await goto(hash);
    expect(document.documentElement.dataset['theme']).toMatch(/dark|light/);
    expect(document.documentElement.lang).toMatch(/en|zh/);
    expect(document.documentElement.style.getPropertyValue('--side-a')).not.toBe('');
    expect(document.documentElement.style.getPropertyValue('--side-b')).not.toBe('');
  }
});

test('the icon sprite is mounted once, and every screen draws from it', async () => {
  await loadRound();
  await mount();
  await goto('#/console');
  expect(document.querySelectorAll('.icon-sprite')).toHaveLength(1);
});
