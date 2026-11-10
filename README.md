# Debate Timer (Web)

A browser port of [Michaelihc/debate-timer](https://github.com/Michaelihc/debate-timer), the Unity debate timer with current/next speaker indicators, a double timer for free debate, and a clickable timeline.

Live: https://michaelihc.github.io/debate-timer-web/#/console

No build step and no dependencies. Plain HTML, CSS, and JavaScript.

## Run locally

Open `index.html` directly in a browser, or serve the folder:

```
npx serve .
# or
python -m http.server 8000
```

## Features

- Visualized debate layout with numbered pro and con speakers in custom colors and custom side labels
- Current speaker (speech bubble) and next speaker (arrow, flashes when time runs out) indicators
- Ring timer for preparation and speeches, with a warning color, warning sound, red flash, and end bell
- Double bar timer for free debate with an Invert button to hand time between sides
- Timeline as a stepper: one dot per part in its team colour (icons for preparation and free debate), done parts dimmed with a tick, a line that fills up to the current part, and each part's time underneath; click any dot to jump there
- Back and Next buttons on either side of the timeline, each showing the part it leads to
- A two-tier title: a small line with the motion (and the part number during the round) over the main line, with a dot in the colour of whoever has the floor
- Before the round, the centre previews what comes first on a full ring in its team colour, with the whole round as a coloured bar and its total length
- Main-screen controls, timers, and the timeline scale with the screen within sensible limits, from phone landscape to a 1080p projector
- Settings panel split into pages: **Presets**, **Teams & speakers**, **Order & times**, **Display & sound**, and **Advanced** (raw JSON, keyboard shortcuts, reset). Times are entered as minutes and seconds
- Presets: built-in **Default** (3 / 2 / 2 / 3 min, order `1, -1, -2, 3, 2, -3, free, 4, -4`) and **Round robin (quick)** (2 / 1 / 1 / 2 min, alternating, no free debate, warning at 15 s), plus your own presets with a name and icon. Presets can be downloaded and opened as `.json` files to share between computers
- Event order as a detailed vertical list or compact chips, with drag-and-drop reordering, an "Alternate Pro and Con" shortcut, and a running total. Removing a speaker also removes and renumbers their turns
- Besides speeches, preparation and free debate, the order can hold a **shared clock** (one clock for both teams or one team, e.g. crossfire) and a **break**
- Each part of the order has its own settings, opened with its settings button or by clicking it: a time for that part only, protected time at each end of a speech (a knock as it starts and ends), which team a preparation is for, which team starts free debate, a name in English and Chinese, and its own warnings. Parts with settings of their own carry a dot
- Warnings and bells: the warning time with a choice of tone, more warnings each with its own time and tone, and a grace bell (a triple knock) a set time after time runs out. Tones are the warning sound, the time's-up sound, or a soft, single, double or triple knock
- Timing behaviour (Advanced page): whether Next starts the next part's clock or loads it paused, whether free-debate clocks can run together or only one team at a time, whether the clock stops at zero or counts overtime in red, and how much overtime silences the bells
- Chinese versions of the topic and team names (Advanced page), used while the screen is in Chinese
- Sounds can be turned off (Display & sound)
- Custom background color (text and ring colors adapt to light backgrounds)
- Custom warning and end sounds, from a URL or an uploaded file
- English and Simplified Chinese UI
- Download / upload of the whole settings file as JSON

Settings and your presets are stored in the browser's `localStorage`. **Save & Apply** in the settings panel stores the settings and reloads the scene; the footer shows when there are unsaved changes. **Reload Scene** restarts the debate from the stored settings and asks for confirmation while a debate is in progress.

Debate progress (current event and timers) survives an accidental page refresh within the same tab. While a debate is in progress the screen is kept awake where the browser supports it.

## Keyboard

| Key | Action |
| --- | --- |
| Space | Pause / resume the active timer |
| Right arrow or N | Next event |
| Left arrow or P | Previous event |
| I | Invert (free debate only) |
| F | Toggle fullscreen |
| S | Open settings |
| Ctrl+S (Cmd+S) | Save & Apply, while settings are open |
| Esc | Close settings, a dialog, or the end screen |

## Presets

A preset is the round itself: topic, team names and colours, speakers, event order (with each part's own settings), the warning, preparation and free-debate times, the warnings and grace bell, how much overtime silences the bells, and whether free-debate clocks run one team at a time. Language, timer format, background, sounds, what Next does, and overtime counting belong to the screen and are left alone when a preset is loaded. A preset without a topic keeps the current topic.

A preset file is a save file holding just those fields, plus a `name` and an `icon`:

```json
{
  "name": "Round robin (quick)",
  "icon": "⚡",
  "title": "",
  "settings": {
    "pro_label": "",
    "con_label": "",
    "pro_colors": "#0000FF",
    "con_colors": "#FF0000",
    "time_warning": 15,
    "time_prep": 300,
    "time_free": 300
  },
  "pro_side": [
    { "name": "", "time": 120 },
    { "name": "", "time": 60 },
    { "name": "", "time": 60 },
    { "name": "", "time": 120 }
  ],
  "con_side": [
    { "name": "", "time": 120 },
    { "name": "", "time": 60 },
    { "name": "", "time": 60 },
    { "name": "", "time": 120 }
  ],
  "event_order": [1, -1, 2, -2, 3, -3, 4, -4]
}
```

**Open preset file…** also accepts a full settings file; its round becomes a new preset.

## Save file format

Compatible with the original; every field added since is optional. `language` accepts `"en"`, `"zh"`, or the original numeric values (`0` = Chinese, `1` = English). The default language follows the browser: Chinese if its preferred language is Chinese, otherwise English.

```json
{
  "settings": {
    "pro_colors": "#0000FF",
    "con_colors": "#FF0000",
    "pro_label": "",
    "con_label": "",
    "pro_label_zh": "",
    "con_label_zh": "",
    "background_color": "#000000",
    "time_warning": 30,
    "warning_tone": "warning",
    "extra_cues": [],
    "time_grace": 0,
    "overtime_cap": 300,
    "time_prep": 300,
    "time_free": 300,
    "free_exclusive": false,
    "display_minutes": true,
    "language": "en",
    "sound": true,
    "audio_warning": "",
    "audio_end": "",
    "advance_starts": true,
    "overtime": false
  },
  "title": "",
  "title_zh": "",
  "pro_side": [
    { "name": "", "time": 180 },
    { "name": "", "time": 120 },
    { "name": "", "time": 120 },
    { "name": "", "time": 180 }
  ],
  "con_side": [
    { "name": "", "time": 180 },
    { "name": "", "time": 120 },
    { "name": "", "time": 120 },
    { "name": "", "time": 180 }
  ],
  "event_order": [1, -1, -2, 3, 2, -3, "free", 4, -4]
}
```

- Speaker `name`: leave it empty to use the default name in the screen language (Pro 1, Con 1… in English; 正一, 反一… in Chinese).
- `event_order` entries: `"prep"` for preparation time, `"free"` for free debate, a positive number for a pro speaker, a negative number for a con speaker. A part with settings of its own is an object instead:
  - `{ "speaker": 1, "time": 150, "protected": 30 }`: a speech with its own time and protected time
  - `{ "kind": "prep", "side": "con" }`: preparation for one team
  - `{ "kind": "free", "first": "pro", "time": 240 }`: free debate where Pro starts, with 4 minutes each
  - `{ "kind": "shared", "time": 180, "live": ["con"], "label": "Crossfire", "label_zh": "盘问" }`: one clock (`live` is left out when both teams speak)
  - `{ "kind": "break", "time": 300 }`

  Any of them can carry `label`, `label_zh` and `cues`. Anything left out uses the round's settings.
- Warnings (`extra_cues`, and a part's `cues`) are `{ "at": seconds left, "tone": ... }`, with `tone` one of `"warning"`, `"end"`, `"soft"`, `"single"`, `"double"`, `"triple"`. A part's `cues` replaces the round's warnings, including `time_warning`; `[]` means none.
- `time_grace`: seconds after time runs out for a triple knock, `0` for none. `overtime_cap`: no bell rings once this far over time.
- `advance_starts`: `false` loads the next part paused. `free_exclusive`: `true` lets only one team's free-debate clock run. `overtime`: `true` keeps counting after zero. `sound`: `false` silences everything.
- `title_zh`, `pro_label_zh`, `con_label_zh`, `label_zh`: used instead of the plain field while the screen is in Chinese.
- Empty labels fall back to "Pro" / "Con" (or 正方 / 反方 in Chinese).
- Empty audio fields use the bundled sounds. Uploaded files are stored inline as data URLs (2 MB limit); larger sounds should be referenced by URL.

## Status of the original to-do list

| Original item | Status |
| --- | --- |
| Double timer for free debate | Done |
| Labels for For and Against side | Done (`pro_label`, `con_label`) |
| Custom background colors | Done (`background_color`) |
| Custom audio for timers | Done (`audio_warning`, `audio_end`) |
| GUI settings menu instead of JSON | Done (form editor, JSON still available) |
| Clean UI | Done |
| Remove unused shaders | Not applicable on the web |

## Files

- `index.html`, `styles.css`, `app.js`: the app
- `assets/icons/`: the speaker figure, speech bubble, and clipboard from the original project; the other icons are inline SVG in `index.html` and `app.js`
- `assets/audio/`: default warning and end sounds from the original project
