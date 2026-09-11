# Debate Timer

A timer for running competitive debate rounds, in the browser. Run the round from one screen and put
it full screen (`F`) on the projector.

No backend, no accounts, no install. It is a static page — open it and run a round.

**[Open the app →](https://michaelihc.github.io/debate-timer-web/)**

This is a TypeScript rewrite of [Michaelihc/debate-timer](https://github.com/Michaelihc/debate-timer),
which was built in Unity as a Windows desktop app.

---

## What it does

- **The Unity layout.** The two teams face each other as tinted figures, a countdown ring sits
  between them, and the timeline runs along the bottom — the screen the desktop app drew.
- **A real setup editor.** Build the roster and the running order visually — add speakers, set times,
  drag segments around, pick side colours. The old app made you hand-edit raw JSON.
- **Seven format presets.** Chinese Academic 4v4 (default), British Parliamentary, World Schools,
  Lincoln-Douglas, Policy/CX, Public Forum, and Blank. Every one is a starting point you can edit.
- **Free-debate chess clock** for 自由辩论, with per-side clocks and a swap control.
- **A preparation phase**, scheduled in the running order, with every figure holding a clipboard
  while it runs — as the desktop app shows it.
- **Bilingual.** English and 简体中文 throughout, switchable mid-round with `L`. Nothing is baked in
  at segment-entry time, so the whole round re-labels instantly.
- **Share a round as a link.** The entire configuration is compressed into the URL.
- **Import your old `save.json`** from the Unity app — drop it on the launch screen.

## The running order is yours

Any speaker can appear anywhere in the order, as many times as you like, or not at all. Speaker 3 before
speaker 2 is a legitimate thing for a format to do. The editor will never warn you about it, reorder it,
deduplicate it, or suggest a "fix" — it runs what you built.

The only things it refuses are configurations that genuinely cannot execute: a segment pointing at a
roster slot that doesn't exist, a duration of zero, or malformed JSON on import.

## Two behaviours you choose

Both live in the round's rules, in the editor.

| Setting | Options |
|---|---|
| **Advancing** | *Arm the next segment* (default) — Next loads the speaker showing full time, and `Space` starts the clock when they actually begin. Or *start immediately*, which is what the Unity app did. |
| **Free debate** | *One side at a time* (default) — a chess clock. Or *both sides may run at once*. |

Swap follows the original's rule: it hands the floor from the running side to the other, and is only
meaningful when exactly one side is running. When neither or both are running, the control is hidden
rather than sitting there doing nothing.

## Keyboard

The whole round can be run without looking at the keyboard. `?` (or the Keyboard shortcuts button on
the launch screen) shows this list in the app, in the interface's language.
On Windows and Linux `⇧` is Shift and `⌥` is Alt; the app prints the names your keyboard uses.

| Key | Action |
|---|---|
| `Space` | Start · Pause · Resume (in free debate, the side that has the floor) |
| `S` | Hand the floor to the other side *(free debate)* |
| `←` `→` | Give the floor to a side *(free debate)* |
| `N` | Next segment, without starting its clock |
| `⇧ N` | Next segment, and start its clock |
| `P` / `PgUp` | Previous segment, from where it stopped |
| `PgDn` | Start the clock, or go to the next segment while it runs (for a presenter clicker) |
| `↑` `↓` | ±15s on the current clock (`⇧` for 60s, `⌥` for 5s) |
| `B` `.` | Pause or resume the whole round |
| `R` | Reset the segment |
| `⏎` | Open the selected segment |
| `E` | Open the editor |
| `L` | EN ⇄ 中文 |
| `M` | Mute cues |
| `F` | Fullscreen |
| `Ctrl S` (`⌘ S` on a Mac) | Share |
| `?` | Show these shortcuts |

A reload, a crash or a closed tab does not cost the round: reopening the console puts it back at the
same segment and time, with a running clock charged the time that passed.

## Notable differences from the Unity version

The behavioural rewrites, beyond the new UI:

- **You can go backwards.** `P` (or Back, beside Next on the timeline) returns to the previous segment
  at the time it actually stopped at.
  The original only went forward.
- **A clock at zero keeps counting up** and every control stays live. The original hid start, pause
  *and* resume at zero, leaving Reset as the only way out.
- **Clicking a timeline pip selects it**; `⏎` loads it at its remembered time. The original restarted
  that leg from full duration on a single click.
- **Time is derived from anchors**, not accumulated by subtracting frame deltas, so it does not drift,
  survives a throttled background tab, and reconciles after the laptop sleeps.
- **Warning cues are value predicates, latched.** They cannot be skipped by a frame hitch, and they
  still fire when the warning threshold is longer than the speech.
- **`0:00` appears exactly at expiry** — the original showed it for a full second beforehand.
- **One `Apply`** persists *and* refreshes the live round. The original's Save wrote to disk without
  applying, and Reload discarded unsaved edits without asking.
- **Cues are synthesized** with the Web Audio API rather than shipping ~740 KB of WAV.

## Development

```bash
npm install
npm run dev        # vite dev server
npm run test       # vitest — 344 tests
npm run typecheck  # tsc -b
npm run lint       # oxlint
npm run build      # production build
```

Zero runtime dependencies beyond React. The engine (`src/engine/`) is framework-free TypeScript and is
where the clock, the reducer and the cue latches live; it is tested independently of any UI.

Pushing to `main` deploys to GitHub Pages.

## Licence

MIT — see [LICENSE](LICENSE).
