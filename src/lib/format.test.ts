import { describe, expect, it } from 'vitest';
import {
  fillFraction,
  formatDelta,
  formatOvertime,
  formatTime,
  parseTimeInput,
} from './format';

/** U+2212 MINUS SIGN — the glyph the ahead/behind chip uses, not ASCII '-'. */
const MINUS = '−';

describe('formatTime — countdown', () => {
  it('renders M:SS with unpadded minutes and padded seconds', () => {
    expect(formatTime(167_000)).toBe('2:47');
    expect(formatTime(60_000)).toBe('1:00');
    expect(formatTime(299_000)).toBe('4:59');
    expect(formatTime(9_000)).toBe('0:09');
    expect(formatTime(600_000)).toBe('10:00');
  });

  it('ceils the seconds: any remainder still shows the higher second', () => {
    expect(formatTime(166_001)).toBe('2:47');
    expect(formatTime(166_999)).toBe('2:47');
    expect(formatTime(167_001)).toBe('2:48');
  });

  it('reads 0:00 at exactly zero and NOT a second early', () => {
    expect(formatTime(0)).toBe('0:00');
    // Math.floor (the original's bug) would print 0:00 for this whole final second.
    expect(formatTime(999)).toBe('0:01');
    expect(formatTime(1)).toBe('0:01');
    expect(formatTime(1_000)).toBe('0:01');
    expect(formatTime(1_001)).toBe('0:02');
  });

  it('rolls to H:MM:SS at one hour and stays M:SS below it', () => {
    expect(formatTime(4_503_000)).toBe('1:15:03');
    expect(formatTime(3_600_000)).toBe('1:00:00');
    expect(formatTime(3_599_000)).toBe('59:59');
    // ceil crosses the boundary too: 3599.001s rounds up to a full hour.
    expect(formatTime(3_599_001)).toBe('1:00:00');
    expect(formatTime(7_384_000)).toBe('2:03:04');
  });

  it('forces H:MM:SS below the threshold when asked', () => {
    expect(formatTime(167_000, { showHours: true })).toBe('0:02:47');
    expect(formatTime(0, { showHours: true })).toBe('0:00:00');
  });

  it('renders a bare integer in seconds-only mode', () => {
    expect(formatTime(125_000, { secondsOnly: true })).toBe('125');
    expect(formatTime(124_001, { secondsOnly: true })).toBe('125');
    expect(formatTime(0, { secondsOnly: true })).toBe('0');
    expect(formatTime(3_600_000, { secondsOnly: true })).toBe('3600');
  });

  it('delegates negative remaining to overtime and survives non-finite input', () => {
    expect(formatTime(-1)).toBe('+0:00');
    expect(formatTime(-12_000)).toBe('+0:12');
    expect(formatTime(Number.NaN)).toBe('0:00');
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});

describe('formatOvertime', () => {
  it('floors, so the first overtime second reads +0:00 then ticks to +0:01', () => {
    expect(formatOvertime(-1)).toBe('+0:00');
    expect(formatOvertime(-999)).toBe('+0:00');
    expect(formatOvertime(-1_000)).toBe('+0:01');
    expect(formatOvertime(-1_999)).toBe('+0:01');
    expect(formatOvertime(-8_000)).toBe('+0:08');
  });

  it('reads the magnitude, so either sign gives the same string', () => {
    expect(formatOvertime(12_000)).toBe('+0:12');
    expect(formatOvertime(-12_000)).toBe('+0:12');
  });

  it('honours seconds-only and the hour rollover', () => {
    expect(formatOvertime(-12_000, { secondsOnly: true })).toBe('+12');
    expect(formatOvertime(-3_661_000)).toBe('+1:01:01');
    expect(formatOvertime(-90_000, { showHours: true })).toBe('+0:01:30');
  });

  it('collapses non-finite input to +0:00', () => {
    expect(formatOvertime(Number.NaN)).toBe('+0:00');
  });
});

describe('fillFraction', () => {
  it('is the remaining share of the allotment', () => {
    expect(fillFraction(90_000, 180_000)).toBe(0.5);
    expect(fillFraction(180_000, 180_000)).toBe(1);
    expect(fillFraction(0, 180_000)).toBe(0);
  });

  it('returns 0, never NaN, when the allotment is zero', () => {
    const f = fillFraction(0, 0);
    expect(Number.isNaN(f)).toBe(false);
    expect(f).toBe(0);
    expect(fillFraction(180_000, 0)).toBe(0);
    expect(fillFraction(1, -1)).toBe(0);
  });

  it('clamps overtime and overfill into [0,1] and never returns Infinity', () => {
    expect(fillFraction(-45_000, 180_000)).toBe(0);
    expect(fillFraction(240_000, 180_000)).toBe(1);
    expect(fillFraction(Number.NaN, 180_000)).toBe(0);
    expect(fillFraction(1_000, Number.POSITIVE_INFINITY)).toBe(0);
    expect(Number.isFinite(fillFraction(1_000, 0))).toBe(true);
  });
});

describe('formatDelta', () => {
  it('signs the offset and drops the sign at zero', () => {
    expect(formatDelta(80_000)).toBe('+1:20');
    expect(formatDelta(-45_000)).toBe(MINUS + '0:45');
    expect(formatDelta(0)).toBe('0:00');
    expect(formatDelta(-500)).toBe('0:00');
    expect(formatDelta(999)).toBe('0:00');
  });

  it('floors the magnitude and honours the display options', () => {
    expect(formatDelta(80_999)).toBe('+1:20');
    expect(formatDelta(90_000, { secondsOnly: true })).toBe('+90');
    expect(formatDelta(3_661_000)).toBe('+1:01:01');
  });
});

describe('parseTimeInput', () => {
  it('reads a bare number by the auto rule: under 60 is minutes, 60+ is seconds', () => {
    expect(parseTimeInput('3')).toBe(180_000);
    expect(parseTimeInput('59')).toBe(3_540_000);
    expect(parseTimeInput('60')).toBe(60_000);
    expect(parseTimeInput('90')).toBe(90_000);
    expect(parseTimeInput('180')).toBe(180_000);
    expect(parseTimeInput('0')).toBe(0);
  });

  it('honours an explicit bare unit', () => {
    expect(parseTimeInput('3', { bareUnit: 'seconds' })).toBe(3_000);
    expect(parseTimeInput('180', { bareUnit: 'minutes' })).toBe(10_800_000);
    expect(parseTimeInput('45', { bareUnit: 'seconds' })).toBe(45_000);
  });

  it('reads colon forms with two or three parts', () => {
    expect(parseTimeInput('3:00')).toBe(180_000);
    expect(parseTimeInput('0:30')).toBe(30_000);
    expect(parseTimeInput('1:15:03')).toBe(4_503_000);
    expect(parseTimeInput('75:03')).toBe(4_503_000);
    expect(parseTimeInput('0:00')).toBe(0);
  });

  it('reads unit suffixes, including the implied unit below the last one named', () => {
    expect(parseTimeInput('3m')).toBe(180_000);
    expect(parseTimeInput('90s')).toBe(90_000);
    expect(parseTimeInput('2m30')).toBe(150_000);
    expect(parseTimeInput('2m30s')).toBe(150_000);
    expect(parseTimeInput('1h')).toBe(3_600_000);
    expect(parseTimeInput('1h30')).toBe(5_400_000);
    expect(parseTimeInput('1h5m30s')).toBe(3_930_000);
    expect(parseTimeInput('1h15m3s')).toBe(4_503_000);
  });

  it('accepts fractions', () => {
    expect(parseTimeInput('2.5')).toBe(150_000);
    expect(parseTimeInput('2.5m')).toBe(150_000);
    expect(parseTimeInput('0.5s')).toBe(500);
  });

  it('normalises case, whitespace, full-width digits, and Chinese units', () => {
    expect(parseTimeInput('  3M  ')).toBe(180_000);
    expect(parseTimeInput('2 m 30 s')).toBe(150_000);
    expect(parseTimeInput('１８０')).toBe(180_000);
    expect(parseTimeInput('１：３０')).toBe(90_000);
    expect(parseTimeInput('3分30秒')).toBe(210_000);
    expect(parseTimeInput('3分')).toBe(180_000);
    expect(parseTimeInput('30秒')).toBe(30_000);
    expect(parseTimeInput('2小时')).toBe(7_200_000);
    expect(parseTimeInput('1时15分3秒')).toBe(4_503_000);
  });

  it('returns null — not 0, not NaN — for anything it cannot read', () => {
    expect(parseTimeInput('')).toBeNull();
    expect(parseTimeInput('   ')).toBeNull();
    expect(parseTimeInput('abc')).toBeNull();
    expect(parseTimeInput('3:')).toBeNull();
    expect(parseTimeInput(':30')).toBeNull();
    expect(parseTimeInput('1:2:3:4')).toBeNull();
    expect(parseTimeInput('3::00')).toBeNull();
    expect(parseTimeInput('-5')).toBeNull();
    expect(parseTimeInput('m')).toBeNull();
    expect(parseTimeInput('s')).toBeNull();
    expect(parseTimeInput('3x')).toBeNull();
  });

  it('round-trips against formatTime for the forms the editor writes back', () => {
    for (const ms of [0, 30_000, 180_000, 240_000, 420_000, 4_503_000]) {
      expect(parseTimeInput(formatTime(ms))).toBe(ms);
    }
  });
});
