import { describe, expect, it } from 'vitest';

import type { RoundConfig, Segment, SideCfg, SpeakerCfg } from './config';
import { SCHEMA_VERSION, defaultRules, defaultSides } from './config';
import { PRESETS, PRESET_KEYS, instantiatePreset } from './presets';
import type { PresetKey } from './presets';
import { migrate } from './migrate';
import {
  countProblems,
  firstError,
  hasErrors,
  problemsForSegment,
  problemsForSpeaker,
  sortProblems,
  validate,
} from './validate';
import type { Problem, ProblemCode } from './validate';

const ROSTER: SpeakerCfg[] = [
  { id: 'a1', side: 'A', name: 'Pro 1', defaultMs: 240_000 },
  { id: 'a2', side: 'A', name: 'Pro 2', defaultMs: 180_000 },
  { id: 'a3', side: 'A', name: 'Pro 3', defaultMs: 180_000 },
  { id: 'a4', side: 'A', name: 'Pro 4', defaultMs: 300_000 },
  { id: 'b1', side: 'B', name: 'Con 1', defaultMs: 240_000 },
  { id: 'b2', side: 'B', name: 'Con 2', defaultMs: 180_000 },
  { id: 'b3', side: 'B', name: 'Con 3', defaultMs: 180_000 },
  { id: 'b4', side: 'B', name: 'Con 4', defaultMs: 300_000 },
];

function config(over: Partial<RoundConfig> = {}): RoundConfig {
  return {
    v: SCHEMA_VERSION,
    id: 'round',
    title: { en: 'Motion', zh: '辩题' },
    sides: defaultSides(),
    speakers: ROSTER.map((s) => ({ ...s })),
    segments: [{ id: 's1', kind: 'speech', speakerId: 'a1', allottedMs: null }],
    // The 1:00 rung of the default ladder would fire on the first frame of any
    // segment under a minute, so the base round uses the short ladder and every
    // fixture below is longer than 0:30 unless it is testing that very rung.
    rules: { ...defaultRules(), cues: [{ atMs: 30_000, tone: 'soft' }, { atMs: 0, tone: 'double' }] },
    ...over,
  };
}

function sides(a: string, b: string): [SideCfg, SideCfg] {
  const [x, y] = defaultSides();
  return [
    { ...x, color: a },
    { ...y, color: b },
  ];
}

function codes(problems: readonly Problem[]): ProblemCode[] {
  return problems.map((p) => p.code);
}

describe('the run order belongs to the operator', () => {
  // The user's real sheet. Speaker 3 speaks before speaker 2, speaker 2 speaks
  // twice, con speaker 1 never speaks at all, and free debate sits before the
  // closing summaries. Every one of those is deliberate.
  const userSegments: Segment[] = [
    { id: 'p', kind: 'prep', label: { en: 'Preparation', zh: '准备时间' }, side: 'both', allottedMs: 300_000 },
    { id: 'e1', kind: 'speech', speakerId: 'a1', allottedMs: null },
    { id: 'e2', kind: 'speech', speakerId: 'a3', allottedMs: null },
    { id: 'e3', kind: 'speech', speakerId: 'b2', allottedMs: null },
    { id: 'e4', kind: 'speech', speakerId: 'a2', allottedMs: null },
    { id: 'e5', kind: 'speech', speakerId: 'a2', allottedMs: null },
    { id: 'e6', kind: 'speech', speakerId: 'b3', allottedMs: null },
    { id: 'f', kind: 'chess', label: { en: 'Free Debate', zh: '自由辩论' }, perSideMs: 500_000, firstFloor: 'A' },
    { id: 'e7', kind: 'speech', speakerId: 'a4', allottedMs: null },
    { id: 'e8', kind: 'speech', speakerId: 'b4', allottedMs: null },
  ];

  it('reports ZERO problems for a repeated speaker, an omitted speaker and 3 before 2', () => {
    expect(validate(config({ segments: userSegments }))).toEqual([]);
  });

  it('has no code that could ever describe an ordering at all', () => {
    const every: ProblemCode[] = [
      'MISSING_SPEAKER',
      'EMPTY_ORDER',
      'ZERO_DURATION',
      'CUE_EXCEEDS_SEGMENT',
      'PROTECTED_OVERLAP',
      'COLOR_TOO_CLOSE',
      'COLOR_LOW_CONTRAST',
      'INVALID_COLOR',
      'UNNAMED_SPEAKER',
    ];
    for (const code of every) {
      expect(code).not.toMatch(/ORDER_|SEQUENCE|DUPLICATE|REPEAT|UNUSED|UNCONVENTIONAL|SKIPPED/);
    }
  });

  it('stays silent however many times a speaker is repeated', () => {
    const repeated: Segment[] = Array.from({ length: 12 }, (_, i) => ({
      id: `r${i}`,
      kind: 'speech',
      speakerId: 'a2',
      allottedMs: null,
    }));
    expect(validate(config({ segments: repeated }))).toEqual([]);
  });

  it('stays silent when only one side ever speaks', () => {
    const oneSided: Segment[] = ROSTER.filter((s) => s.side === 'A').map((s, i) => ({
      id: `o${i}`,
      kind: 'speech',
      speakerId: s.id,
      allottedMs: null,
    }));
    expect(validate(config({ segments: oneSided }))).toEqual([]);
  });

  it('stays silent about prep and free-debate blocks placed anywhere, any number of times', () => {
    const odd: Segment[] = [
      { id: 'f1', kind: 'chess', label: { en: 'Free', zh: '自由' }, perSideMs: 120_000, firstFloor: 'operator' },
      { id: 'p1', kind: 'prep', label: { en: 'Prep', zh: '准备' }, side: 'A', allottedMs: 60_000 },
      { id: 'p2', kind: 'prep', label: { en: 'Prep', zh: '准备' }, side: 'B', allottedMs: 60_000 },
      { id: 'f2', kind: 'chess', label: { en: 'Free', zh: '自由' }, perSideMs: 120_000, firstFloor: 'B' },
      { id: 's1', kind: 'speech', speakerId: 'b4', allottedMs: null },
    ];
    expect(validate(config({ segments: odd }))).toEqual([]);
  });

  it('never disables START ROUND for an unconventional order', () => {
    expect(hasErrors(validate(config({ segments: userSegments })))).toBe(false);
    expect(firstError(validate(config({ segments: userSegments })))).toBeNull();
  });

  it('says nothing about the order of the user file that arrives through migrate', () => {
    const imported = migrate({
      settings: { pro_colors: '#E69F00', con_colors: '#0072B2', time_warning: 30, time_prep: 300, time_free: 500, display_minutes: true, language: 0 },
      title: 'Real Round',
      pro_side: [
        { name: 'Pro 1', time: 240 },
        { name: 'Pro 2', time: 180 },
        { name: 'Pro 3', time: 180 },
        { name: 'Pro 4', time: 300 },
      ],
      con_side: [
        { name: 'Con 1', time: 240 },
        { name: 'Con 2', time: 180 },
        { name: 'Con 3', time: 180 },
        { name: 'Con 4', time: 300 },
      ],
      event_order: ['prep', 1, 3, -2, 2, 2, -3, 'free', 4, -4],
    }).config;
    expect(imported).not.toBeNull();
    if (imported) expect(validate(imported)).toEqual([]);
  });
});

describe('every code fires on its minimal failing config', () => {
  it('EMPTY_ORDER — an empty run sheet cannot run', () => {
    const problems = validate(config({ segments: [] }));
    expect(codes(problems)).toEqual(['EMPTY_ORDER']);
    expect(problems[0]?.severity).toBe('error');
    expect(problems[0]?.ref).toEqual({ kind: 'round' });
  });

  it('MISSING_SPEAKER — a reference with no roster entry', () => {
    const problems = validate(
      config({ segments: [{ id: 'x', kind: 'speech', speakerId: 'ghost', allottedMs: null }] }),
    );
    expect(codes(problems)).toEqual(['MISSING_SPEAKER']);
    expect(problems[0]?.severity).toBe('error');
    expect(problems[0]?.ref).toEqual({ kind: 'segment', segId: 'x', index: 0 });
  });

  it('MISSING_SPEAKER — a shared segment naming a deleted participant', () => {
    const problems = validate(
      config({
        segments: [
          {
            id: 'x',
            kind: 'shared',
            label: { en: 'CX', zh: '质询' },
            allottedMs: 180_000,
            live: ['A', 'B'],
            speakerIds: ['a1', 'ghost'],
          },
        ],
      }),
    );
    expect(codes(problems)).toEqual(['MISSING_SPEAKER']);
  });

  it('MISSING_SPEAKER suppresses the derived ZERO_DURATION rather than doubling up', () => {
    // A dangling reference resolves to 0ms; reporting both would name one fault twice.
    const problems = validate(
      config({ segments: [{ id: 'x', kind: 'speech', speakerId: 'ghost', allottedMs: null }] }),
    );
    expect(codes(problems)).not.toContain('ZERO_DURATION');
  });

  it('ZERO_DURATION — a segment with no time on the clock', () => {
    const problems = validate(
      config({ segments: [{ id: 'x', kind: 'break', label: { en: 'B', zh: '休' }, allottedMs: 0 }] }),
    );
    expect(codes(problems)).toEqual(['ZERO_DURATION']);
    expect(problems[0]?.severity).toBe('error');
    expect(problems[0]?.ref).toEqual({ kind: 'segment', segId: 'x', index: 0 });
  });

  it('ZERO_DURATION — a speech overridden to 0:00, and a chess segment with an empty side', () => {
    expect(
      codes(validate(config({ segments: [{ id: 'x', kind: 'speech', speakerId: 'a1', allottedMs: 0 }] }))),
    ).toEqual(['ZERO_DURATION']);
    expect(
      codes(
        validate(
          config({
            segments: [
              { id: 'x', kind: 'chess', label: { en: 'F', zh: '自' }, perSideMs: 0, firstFloor: 'A' },
            ],
          }),
        ),
      ),
    ).toEqual(['ZERO_DURATION']);
  });

  it('CUE_EXCEEDS_SEGMENT — a warning above the allotment, as a fact not a fault', () => {
    const problems = validate(
      config({
        rules: { ...defaultRules() }, // the 1:00 / 0:30 ladder
        segments: [{ id: 'x', kind: 'break', label: { en: 'B', zh: '休' }, allottedMs: 45_000 }],
      }),
    );
    expect(codes(problems)).toEqual(['CUE_EXCEEDS_SEGMENT']);
    expect(problems[0]?.severity).toBe('info');
    expect(problems[0]?.ref).toEqual({ kind: 'cue', segId: 'x', index: 0, atMs: 60_000 });
    expect(problems[0]?.message.en).toContain('1:00');
    expect(problems[0]?.message.en).toContain('0:45');
  });

  it('CUE_EXCEEDS_SEGMENT — never for the 0ms expiry cue, which always fires', () => {
    const problems = validate(
      config({
        rules: { ...defaultRules(), cues: [{ atMs: 0, tone: 'double' }] },
        segments: [{ id: 'x', kind: 'break', label: { en: 'B', zh: '休' }, allottedMs: 1_000 }],
      }),
    );
    expect(problems).toEqual([]);
  });

  it('CUE_EXCEEDS_SEGMENT — measured per side on a chess segment, not on the pair', () => {
    // 2:00 per side. A 2:30 warning never fires even though both sides total 4:00.
    const problems = validate(
      config({
        rules: { ...defaultRules(), cues: [{ atMs: 150_000, tone: 'soft' }, { atMs: 0, tone: 'double' }] },
        segments: [
          { id: 'x', kind: 'chess', label: { en: 'F', zh: '自' }, perSideMs: 120_000, firstFloor: 'A' },
        ],
      }),
    );
    expect(codes(problems)).toEqual(['CUE_EXCEEDS_SEGMENT']);
  });

  it('PROTECTED_OVERLAP — two protected windows that meet in the middle', () => {
    const problems = validate(
      config({
        segments: [
          { id: 'x', kind: 'speech', speakerId: 'a1', allottedMs: 120_000, protectedMs: 70_000 },
        ],
      }),
    );
    expect(codes(problems)).toEqual(['PROTECTED_OVERLAP']);
    expect(problems[0]?.severity).toBe('warning');
    expect(problems[0]?.ref).toEqual({ kind: 'segment', segId: 'x', index: 0 });
  });

  it('PROTECTED_OVERLAP — silent when the windows fit', () => {
    expect(
      validate(
        config({
          segments: [
            { id: 'x', kind: 'speech', speakerId: 'a1', allottedMs: 420_000, protectedMs: 60_000 },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('COLOR_TOO_CLOSE — two greys nobody can tell apart', () => {
    const problems = validate(config({ sides: sides('#808080', '#858585') }));
    expect(codes(problems)).toEqual(['COLOR_TOO_CLOSE']);
    expect(problems[0]?.severity).toBe('warning');
    expect(problems[0]?.ref).toEqual({ kind: 'side', side: 'A' });
  });

  it('COLOR_LOW_CONTRAST — a side colour too dark to read off a projector', () => {
    const problems = validate(config({ sides: sides('#3C5A73', '#FFFF00') }));
    expect(codes(problems)).toEqual(['COLOR_LOW_CONTRAST']);
    expect(problems[0]?.severity).toBe('warning');
    expect(problems[0]?.ref).toEqual({ kind: 'side', side: 'A' });
  });

  it('COLOR_LOW_CONTRAST — named per side, so both can be reported at once', () => {
    const problems = validate(config({ sides: sides('#1A1A2E', '#2E1A1A') }));
    const lowContrast = problems.filter((p) => p.code === 'COLOR_LOW_CONTRAST');
    expect(lowContrast.map((p) => (p.ref.kind === 'side' ? p.ref.side : null))).toEqual(['A', 'B']);
  });

  it('INVALID_COLOR — a colour that is not a colour', () => {
    const problems = validate(config({ sides: sides('chartreuse', '#0072B2') }));
    expect(codes(problems)).toContain('INVALID_COLOR');
    const invalid = problems.find((p) => p.code === 'INVALID_COLOR');
    expect(invalid?.severity).toBe('warning');
    expect(invalid?.ref).toEqual({ kind: 'side', side: 'A' });
    // An unreadable colour is never an error: the round still runs.
    expect(hasErrors(problems)).toBe(false);
  });

  it('UNNAMED_SPEAKER — a blank name is a fact, not a fault', () => {
    const problems = validate(
      config({
        speakers: [{ id: 'a1', side: 'A', name: '   ', defaultMs: 240_000 }],
      }),
    );
    expect(codes(problems)).toEqual(['UNNAMED_SPEAKER']);
    expect(problems[0]?.severity).toBe('info');
    expect(problems[0]?.ref).toEqual({ kind: 'speaker', speakerId: 'a1' });
  });

  it('reports every problem in both languages', () => {
    const problems = validate(
      config({ segments: [], sides: sides('#808080', '#858585'), speakers: [{ id: 'a1', side: 'A', name: '', defaultMs: 1 }] }),
    );
    expect(problems.length).toBeGreaterThan(2);
    for (const p of problems) {
      expect(p.message.en.trim().length).toBeGreaterThan(0);
      expect(p.message.zh.trim().length).toBeGreaterThan(0);
      expect(p.message.en).not.toMatch(/\{\w+\}/);
      expect(p.message.zh).not.toMatch(/\{\w+\}/);
    }
  });

  it('reserves `error` for the three things that genuinely cannot execute', () => {
    const errorCodes = new Set<ProblemCode>();
    const samples: RoundConfig[] = [
      config({ segments: [] }),
      config({ segments: [{ id: 'x', kind: 'speech', speakerId: 'ghost', allottedMs: null }] }),
      config({ segments: [{ id: 'x', kind: 'break', label: { en: 'B', zh: '休' }, allottedMs: 0 }] }),
      config({ sides: sides('chartreuse', '#858585') }),
      config({ speakers: [{ id: 'a1', side: 'A', name: '', defaultMs: 1 }] }),
      config({
        segments: [{ id: 'x', kind: 'speech', speakerId: 'a1', allottedMs: 120_000, protectedMs: 70_000 }],
      }),
    ];
    for (const sample of samples) {
      for (const p of validate(sample)) if (p.severity === 'error') errorCodes.add(p.code);
    }
    expect([...errorCodes].sort()).toEqual(['EMPTY_ORDER', 'MISSING_SPEAKER', 'ZERO_DURATION']);
  });
});

describe('the shipped presets', () => {
  const runnable = PRESET_KEYS.filter((k) => k !== 'blank');

  it.each(runnable)('%s validates completely clean', (key: PresetKey) => {
    expect(validate(PRESETS[key])).toEqual([]);
  });

  it('blank reports only that its run sheet is empty, which is what blank means', () => {
    const problems = validate(PRESETS.blank);
    expect(codes(problems)).toEqual(['EMPTY_ORDER']);
  });

  it.each(PRESET_KEYS)('%s stays clean after instantiation mints new ids', (key: PresetKey) => {
    const instance = instantiatePreset(key);
    const expected = key === 'blank' ? ['EMPTY_ORDER'] : [];
    expect(codes(validate(instance))).toEqual(expected);
  });

  it('no preset carries an error but blank', () => {
    for (const key of runnable) expect(hasErrors(validate(PRESETS[key]))).toBe(false);
    expect(hasErrors(validate(PRESETS.blank))).toBe(true);
  });
});

describe('reporting helpers', () => {
  const problems = validate(
    config({
      segments: [
        { id: 'x', kind: 'speech', speakerId: 'ghost', allottedMs: null },
        { id: 'y', kind: 'break', label: { en: 'B', zh: '休' }, allottedMs: 0 },
      ],
      speakers: [{ id: 'a1', side: 'A', name: '', defaultMs: 240_000 }],
      sides: sides('#808080', '#858585'),
    }),
  );

  it('counts by severity', () => {
    expect(countProblems(problems)).toEqual({ errors: 2, warnings: 1, infos: 1 });
    expect(countProblems([])).toEqual({ errors: 0, warnings: 0, infos: 0 });
  });

  it('finds the first error and nothing when there is none', () => {
    expect(firstError(problems)?.code).toBe('MISSING_SPEAKER');
    expect(firstError(validate(config()))).toBeNull();
    expect(hasErrors([])).toBe(false);
  });

  it('filters to one segment, including its cue problems', () => {
    expect(codes(problemsForSegment(problems, 'x'))).toEqual(['MISSING_SPEAKER']);
    expect(codes(problemsForSegment(problems, 'y'))).toEqual(['ZERO_DURATION']);
    expect(problemsForSegment(problems, 'nope')).toEqual([]);
    const cueProblems = validate(
      config({
        rules: { ...defaultRules() },
        segments: [{ id: 'q', kind: 'break', label: { en: 'B', zh: '休' }, allottedMs: 45_000 }],
      }),
    );
    expect(codes(problemsForSegment(cueProblems, 'q'))).toEqual(['CUE_EXCEEDS_SEGMENT']);
  });

  it('filters to one speaker', () => {
    expect(codes(problemsForSpeaker(problems, 'a1'))).toEqual(['UNNAMED_SPEAKER']);
    expect(problemsForSpeaker(problems, 'ghost')).toEqual([]);
  });

  it('sorts errors, then warnings, then facts, without mutating the input', () => {
    const before = [...problems];
    const sorted = sortProblems(problems);
    expect(sorted.map((p) => p.severity)).toEqual(['error', 'error', 'warning', 'info']);
    expect(problems).toEqual(before);
    expect(sorted).not.toBe(problems);
  });

  it('is stable within a severity band', () => {
    const sorted = sortProblems(problems);
    expect(codes(sorted).slice(0, 2)).toEqual(['MISSING_SPEAKER', 'ZERO_DURATION']);
  });
});
