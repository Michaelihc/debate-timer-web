import { clamp01 } from './clamp';

export interface TimeFormatOpts {
  /** Force H:MM:SS below the one-hour auto-threshold (column alignment). */
  showHours?: boolean;
  /** `rules.display === 'seconds'`: a bare integer, no colon. */
  secondsOnly?: boolean;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function hms(totalSec: number, forceHours: boolean): string {
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  if (forceHours || totalSec >= 3600) {
    return `${Math.floor(totalMin / 60)}:${pad2(totalMin % 60)}:${pad2(s)}`;
  }
  // Minutes are never padded, seconds always are.
  return `${totalMin}:${pad2(s)}`;
}

/**
 * Remaining time. Ceiling on the seconds, so `0:00` appears exactly at expiry instead of
 * sitting there for a full second first (the original floored). Negative input is
 * overtime and delegates to `formatOvertime`.
 */
export function formatTime(ms: number, opts: TimeFormatOpts = {}): string {
  const value = Number.isFinite(ms) ? ms : 0;
  if (value < 0) return formatOvertime(value, opts);
  const sec = Math.ceil(value / 1000);
  if (opts.secondsOnly) return String(sec);
  return hms(sec, opts.showHours === true);
}

/**
 * Overtime counts up from `+0:00`: floor, not ceil, so the first overtime second reads
 * `+0:00` and ticks to `+0:01`. Accepts either sign; the magnitude is what matters.
 */
export function formatOvertime(ms: number, opts: TimeFormatOpts = {}): string {
  const value = Number.isFinite(ms) ? Math.abs(ms) : 0;
  const sec = Math.floor(value / 1000);
  if (opts.secondsOnly) return `+${sec}`;
  return `+${hms(sec, opts.showHours === true)}`;
}

/** Depletion-bar fill, 1 = full. Zero or negative allotment fills nothing — never NaN. */
export function fillFraction(remainingMs: number, allottedMs: number): number {
  if (!Number.isFinite(allottedMs) || allottedMs <= 0) return 0;
  if (!Number.isFinite(remainingMs)) return 0;
  return clamp01(remainingMs / allottedMs);
}

/** Signed offset for the ahead/behind chip: `+1:20`, `−0:45`, `0:00`. */
export function formatDelta(ms: number, opts: TimeFormatOpts = {}): string {
  const value = Number.isFinite(ms) ? ms : 0;
  const sec = Math.floor(Math.abs(value) / 1000);
  const body = opts.secondsOnly ? String(sec) : hms(sec, opts.showHours === true);
  if (sec === 0) return body;
  return value < 0 ? `−${body}` : `+${body}`;
}

export interface ParseTimeOpts {
  /**
   * How to read a bare number with no unit and no colon.
   * 'auto' (default): under 60 is minutes (`3` → 3:00), 60 and over is seconds
   * (`180` → 3:00, `90` → 1:30). Cue and grace fields pass 'seconds'.
   */
  bareUnit?: 'auto' | 'minutes' | 'seconds';
}

const NUM = '\\d+(?:\\.\\d+)?';
const BARE_RE = new RegExp(`^${NUM}$`);
// Optional h, optional m, then a tail that is seconds when it carries `s` and otherwise
// means "the unit below the last one named" — `2m30` is 2:30, `1h30` is 1:30:00.
const UNIT_RE = new RegExp(`^(?:(${NUM})h)?(?:(${NUM})m)?(?:(${NUM})(s)?)?$`);

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ':')
    .replace(/小时/g, 'h')
    .replace(/[时分]/g, (c) => (c === '时' ? 'h' : 'm'))
    .replace(/秒/g, 's')
    .replace(/\s+/g, '');
}

/**
 * `3` · `3:00` · `180` · `3m` · `90s` · `2m30` · `1:15:03` · `3分30秒` → ms.
 * Returns null for anything it cannot read; `0` is a successful parse, not a failure.
 */
export function parseTimeInput(text: string, opts: ParseTimeOpts = {}): number | null {
  const src = normalize(text);
  if (src === '') return null;

  if (BARE_RE.test(src)) {
    const n = Number(src);
    const unit = opts.bareUnit ?? 'auto';
    const asMinutes = unit === 'minutes' || (unit === 'auto' && n < 60);
    return Math.round(n * (asMinutes ? 60_000 : 1000));
  }

  if (src.includes(':')) {
    const parts = src.split(':');
    if (parts.length < 2 || parts.length > 3) return null;
    if (!parts.every((p) => /^\d+$/.test(p))) return null;
    const nums = parts.map(Number);
    const [a = 0, b = 0, c = 0] = nums;
    return parts.length === 3
      ? (a * 3600 + b * 60 + c) * 1000
      : (a * 60 + b) * 1000;
  }

  const m = UNIT_RE.exec(src);
  if (!m) return null;
  const [, hourStr, minStr, tailStr, tailIsSeconds] = m;
  if (hourStr === undefined && minStr === undefined && tailStr === undefined) return null;

  let ms = 0;
  if (hourStr !== undefined) ms += Number(hourStr) * 3_600_000;
  if (minStr !== undefined) ms += Number(minStr) * 60_000;
  if (tailStr !== undefined) {
    const tail = Number(tailStr);
    const tailMinutes = tailIsSeconds === undefined && minStr === undefined && hourStr !== undefined;
    ms += tail * (tailMinutes ? 60_000 : 1000);
  }
  return Math.round(ms);
}
