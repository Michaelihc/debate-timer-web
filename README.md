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
- Clickable timeline to jump to any event
- Settings menu with a form editor and a raw JSON editor; the event order can be edited as compact chips or as a detailed vertical list, with drag-and-drop reordering in both
- Custom background color (text and ring colors adapt to light backgrounds)
- Custom warning and end sounds, from a URL or an uploaded file
- English and Simplified Chinese UI
- Download / upload of the save file as JSON

Settings are stored in the browser's `localStorage`. **Save & Apply** in the menu stores the settings and reloads the scene. **Reload Scene** restarts the debate from the stored settings and asks for confirmation while a debate is in progress.

Debate progress (current event and timers) survives an accidental page refresh within the same tab. While a debate is in progress the screen is kept awake where the browser supports it.

## Keyboard

| Key | Action |
| --- | --- |
| Space | Pause / resume the active timer |
| Right arrow or N | Next event |
| Left arrow or P | Previous event |
| I | Invert (free debate only) |
| F | Toggle fullscreen |
| Esc | Close the menu, dialog, or end screen |

## Save file format

Compatible with the original. New optional fields are `pro_label`, `con_label`, `background_color`, `audio_warning`, and `audio_end`. `language` accepts `"en"`, `"zh"`, or the original numeric values (`0` = Chinese, `1` = English).

```json
{
  "settings": {
    "pro_colors": "#0000FF",
    "con_colors": "#FF0000",
    "pro_label": "",
    "con_label": "",
    "background_color": "#000000",
    "time_warning": 30,
    "time_prep": 300,
    "time_free": 300,
    "display_minutes": true,
    "language": "en",
    "audio_warning": "",
    "audio_end": ""
  },
  "title": "在公共空间中，权利行使应不应受“公序良俗”的限制",
  "pro_side": [
    { "name": "Team 1 A", "time": 180 },
    { "name": "Team 1 B", "time": 120 },
    { "name": "Team 1 C", "time": 120 },
    { "name": "Team 1 D", "time": 180 }
  ],
  "con_side": [
    { "name": "Team 2 A", "time": 180 },
    { "name": "Team 2 B", "time": 120 },
    { "name": "Team 2 C", "time": 120 },
    { "name": "Team 2 D", "time": 180 }
  ],
  "event_order": [1, -1, -2, 3, 2, -3, "free", 4, -4]
}
```

- `event_order` entries: `"prep"` for preparation time, `"free"` for free debate, a positive number for a pro speaker, a negative number for a con speaker.
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
- `assets/icons/`: icons from the original project
- `assets/audio/`: default warning and end sounds from the original project
