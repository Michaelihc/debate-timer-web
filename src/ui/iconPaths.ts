/**
 * The sprite's geometry. Kept apart from `Icons.tsx` so that file exports components
 * and nothing else — a module that mixes the two defeats fast refresh.
 *
 * Every glyph is drawn by hand on a 16px grid with 1.5px strokes and square caps. There
 * are no emoji anywhere in this app: an emoji is a third party's typeface, renders
 * differently on every machine in the venue, and cannot take `currentColor`.
 */

export type IconName =
  | 'play'
  | 'pause'
  | 'next'
  | 'prev'
  | 'reset'
  | 'hold'
  | 'swap'
  | 'plus'
  | 'minus'
  | 'undo'
  | 'redo'
  | 'sound'
  | 'mute'
  | 'keyboard'
  | 'close'
  | 'check'
  | 'alert'
  | 'grip'
  | 'caret'
  | 'link'
  | 'unlink'
  | 'copy'
  | 'download'
  | 'edit'
  | 'share';

export const PATHS: Record<IconName, string> = {
  play: 'M5.25 3.5 12.5 8 5.25 12.5Z',
  pause: 'M5.75 3.5v9M10.25 3.5v9',
  next: 'M3.75 3.5 9.75 8l-6 4.5zM12.25 3.5v9',
  prev: 'M12.25 3.5 6.25 8l6 4.5zM3.75 3.5v9',
  reset: 'M13 8a5 5 0 1 1-1.6-3.67M12.9 1.6V5H9.5',
  hold: 'M2.75 3.75h10.5v8.5H2.75zM5.5 8h5',
  swap: 'M3 5.5h8.5M9.5 3.5l2 2-2 2M13 10.5H4.5M6.5 8.5l-2 2 2 2',
  plus: 'M8 3.5v9M3.5 8h9',
  minus: 'M3.5 8h9',
  undo: 'M6 4 2.75 7.25 6 10.5M2.75 7.25H10a3.25 3.25 0 0 1 0 6.5H6.5',
  redo: 'M10 4l3.25 3.25L10 10.5M13.25 7.25H6a3.25 3.25 0 0 0 0 6.5h3.5',
  sound: 'M3 6.25h2.5L9 3.5v9L5.5 9.75H3zM11.5 6a3 3 0 0 1 0 4',
  mute: 'M3 6.25h2.5L9 3.5v9L5.5 9.75H3zM11.5 6.25l3 3.5M14.5 6.25l-3 3.5',
  keyboard:
    'M1.75 4.25h12.5v7.5H1.75zM4.25 6.75h.1M7 6.75h.1M9.75 6.75h.1M12 6.75h.1M5 9.5h6',
  close: 'M4 4l8 8M12 4l-8 8',
  check: 'M3.25 8.5 6.5 11.75 12.75 4.75',
  alert: 'M8 2.5 14.5 13.5H1.5zM8 6.5v3M8 11.25h.1',
  grip: 'M6 4h.1M10 4h.1M6 8h.1M10 8h.1M6 12h.1M10 12h.1',
  caret: 'M6 3.5 10.5 8 6 12.5',
  link: 'M6.75 9.25 9.25 6.75M5.5 7 3.75 8.75a2.5 2.5 0 0 0 3.5 3.5L9 10.5M10.5 9l1.75-1.75a2.5 2.5 0 0 0-3.5-3.5L7 5.5',
  unlink:
    'M5.5 7 3.75 8.75a2.5 2.5 0 0 0 3.5 3.5L9 10.5M10.5 9l1.75-1.75a2.5 2.5 0 0 0-3.5-3.5L7 5.5M2.5 2.5l11 11',
  copy: 'M5.75 5.75h7.5v7.5h-7.5zM10.25 5.75v-3h-7.5v7.5h3',
  download: 'M8 2.75v7.75M4.75 7.25 8 10.5l3.25-3.25M2.75 13.25h10.5',
  edit: 'M3 13v-2.75L10.75 2.5l2.75 2.75L5.75 13zM9.25 4 12 6.75',
  share: 'M8 12.5V3.25M4.75 6.5 8 3.25l3.25 3.25M3 10v3.25h10V10',
};

export const ICON_NAMES = Object.keys(PATHS) as IconName[];
