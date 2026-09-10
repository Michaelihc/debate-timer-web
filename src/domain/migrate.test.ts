import { describe, expect, it } from 'vitest';

import type { RoundConfig, Segment } from './config';
import { SCHEMA_VERSION, defaultRules } from './config';
import { isLegacyUnity, migrate, migrateUnity, parseAndMigrate } from './migrate';
import type { MigrationCode, MigrationProblem, MigrationResult } from './migrate';
import { validate } from './validate';

/**
 * The shipped `DebateDataManager.defaultText`, verbatim apart from `event_order`,
 * which carries the order the user actually runs: 3 before 2, 2 twice, -1 never.
 */
const USER_ORDER: readonly (string | number)[] = ['prep', 1, 3, -2, 2, 2, -3, 'free', 4, -4];

interface LegacyOver {
  settings?: Record<string, unknown>;
  order?: readonly (string | number)[];
  title?: unknown;
  pro?: unknown;
  con?: unknown;
}

function legacy(over: LegacyOver = {}): Record<string, unknown> {
  return {
    settings: {
      pro_colors: '#0000FF',
      con_colors: '#FF0000',
      time_warning: 30,
      time_prep: 300,
      time_free: 500,
      display_minutes: true,
      language: 0,
      ...over.settings,
    },
    title: over.title === undefined ? 'New Debate Title' : over.title,
    pro_side: over.pro ?? [
      { name: 'Team 1 A', time: 240 },
      { name: 'Team 1 B', time: 180 },
      { name: 'Team 1 C', time: 180 },
      { name: 'Team 1 D', time: 300 },
    ],
    con_side: over.con ?? [
      { name: 'Team 2 A', time: 240 },
      { name: 'Team 2 B', time: 180 },
      { name: 'Team 2 C', time: 180 },
      { name: 'Team 2 D', time: 300 },
    ],
    event_order: [...(over.order ?? USER_ORDER)],
  };
}

/** Read the run order back out as legacy tokens, so it can be compared verbatim. */
function tokensOf(config: RoundConfig): (string | number)[] {
  const pro = config.speakers.filter((s) => s.side === 'A');
  const con = config.speakers.filter((s) => s.side === 'B');
  return config.segments.map((seg: Segment): string | number => {
    if (seg.kind === 'prep') return 'prep';
    if (seg.kind === 'chess') return 'free';
    if (seg.kind === 'speech') {
      const a = pro.findIndex((s) => s.id === seg.speakerId);
      if (a >= 0) return a + 1;
      const b = con.findIndex((s) => s.id === seg.speakerId);
      if (b >= 0) return -(b + 1);
      return 'dangling';
    }
    if (seg.kind === 'break') return `break:${seg.label.en}`;
    return seg.kind;
  });
}

function codes(problems: readonly MigrationProblem[]): MigrationCode[] {
  return problems.map((p) => p.code);
}

function ok(result: MigrationResult): RoundConfig {
  const config = result.config;
  if (config === null) throw new Error(`expected a config, got ${codes(result.problems).join()}`);
  return config;
}

describe('migrateUnity — the real payload', () => {
  const result = migrate(legacy());
  const config = ok(result);

  it('is detected as a Unity v1 file', () => {
    expect(isLegacyUnity(legacy())).toBe(true);
    expect(isLegacyUnity({ v: 3 })).toBe(false);
    expect(isLegacyUnity({ event_order: [], v: 3 })).toBe(false);
    expect(isLegacyUnity(null)).toBe(false);
    expect(result.source).toBe('unity');
  });

  it('preserves the operator order verbatim — repeat, omission and 3-before-2 intact', () => {
    expect(tokensOf(config)).toEqual([...USER_ORDER]);
  });

  it('keeps the repeat as two independent segments, not one deduped block', () => {
    const pro2 = config.speakers.filter((s) => s.side === 'A')[1];
    expect(pro2).toBeDefined();
    const usingPro2 = config.segments.filter(
      (s) => s.kind === 'speech' && s.speakerId === pro2?.id,
    );
    expect(usingPro2).toHaveLength(2);
    const segIds = config.segments.map((s) => s.id);
    expect(new Set(segIds).size).toBe(segIds.length);
  });

  it('keeps the full roster even though con speaker 1 never speaks', () => {
    expect(config.speakers.filter((s) => s.side === 'B')).toHaveLength(4);
    expect(tokensOf(config)).not.toContain(-1);
  });

  it('reports nothing but two facts — no error, no warning', () => {
    expect(codes(result.problems)).toEqual(['IMPORTED', 'FREE_PER_SIDE']);
    expect(result.problems.every((p) => p.severity === 'info')).toBe(true);
  });

  it('never reports anything about the order itself', () => {
    expect(codes(result.problems)).not.toContain('SPEAKER_OUT_OF_RANGE');
    expect(codes(result.problems)).not.toContain('UNKNOWN_TOKEN');
    expect(codes(result.problems)).not.toContain('EMPTY_ORDER');
  });

  it('converts signed indices to speaker references and says how many', () => {
    const imported = result.problems.find((p) => p.code === 'IMPORTED');
    expect(imported?.message.en).toContain('Imported 8 speakers and 10 segments');
    expect(imported?.message.en).toContain('Converted 8 signed indices');
    expect(imported?.message.zh).toContain('8 位辩手');
  });

  it('carries both languages on every problem', () => {
    for (const p of result.problems) {
      expect(p.message.en.length).toBeGreaterThan(0);
      expect(p.message.zh.length).toBeGreaterThan(0);
    }
  });

  it('reads participant seconds as milliseconds', () => {
    expect(config.speakers.map((s) => s.defaultMs)).toEqual([
      240_000, 180_000, 180_000, 300_000, 240_000, 180_000, 180_000, 300_000,
    ]);
    expect(config.speakers[0]?.name).toBe('Team 1 A');
    expect(config.speakers[0]?.side).toBe('A');
    expect(config.speakers[4]?.side).toBe('B');
  });

  it('maps time_prep onto the prep block', () => {
    const prep = config.segments[0];
    expect(prep?.kind).toBe('prep');
    if (prep?.kind === 'prep') {
      expect(prep.allottedMs).toBe(300_000);
      expect(prep.side).toBe('both');
    }
  });

  it('mints unique ids for the round, every speaker and every segment', () => {
    const ids = [
      config.id,
      ...config.speakers.map((s) => s.id),
      ...config.segments.map((s) => s.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[0-9a-z]{8}$/);
  });

  it('produces a config the validator has nothing to say about, order-wise', () => {
    // The Unity default palette is blue-on-red, which is a colour finding. Nothing
    // about the segments, the cues, the speakers or the sheet as a whole.
    expect(validate(config).filter((p) => p.ref.kind !== 'side')).toEqual([]);
  });
});

describe('time_free is per side, not a shared pool', () => {
  const config = ok(migrate(legacy()));

  it('gives each side the full 500 seconds', () => {
    const chess = config.segments.find((s) => s.kind === 'chess');
    expect(chess?.kind).toBe('chess');
    if (chess?.kind === 'chess') {
      expect(chess.perSideMs).toBe(500_000);
      expect(chess.firstFloor).toBe('A');
    }
  });

  it('says so in the report rather than silently reinterpreting the number', () => {
    const note = migrate(legacy()).problems.find((p) => p.code === 'FREE_PER_SIDE');
    expect(note?.severity).toBe('info');
    expect(note?.message.en).toContain('500s PER SIDE');
    expect(note?.message.zh).toContain('每方 500 秒');
  });

  it('is not reported when the order has no free debate', () => {
    expect(codes(migrate(legacy({ order: ['prep', 1, -1] })).problems)).not.toContain(
      'FREE_PER_SIDE',
    );
  });

  it('scales with the setting', () => {
    const seg = ok(migrate(legacy({ settings: { time_free: 240 } }))).segments.find(
      (s) => s.kind === 'chess',
    );
    if (seg?.kind === 'chess') expect(seg.perSideMs).toBe(240_000);
    else throw new Error('no chess segment');
  });
});

describe('language, display and colours', () => {
  it('maps language 0 to Chinese', () => {
    expect(ok(migrate(legacy({ settings: { language: 0 } }))).rules.lang).toBe('zh');
  });

  it('maps language 1 to English', () => {
    expect(ok(migrate(legacy({ settings: { language: 1 } }))).rules.lang).toBe('en');
  });

  it('falls back to Chinese for a missing or nonsense language', () => {
    expect(ok(migrate(legacy({ settings: { language: undefined } }))).rules.lang).toBe('zh');
    expect(ok(migrate(legacy({ settings: { language: 7 } }))).rules.lang).toBe('zh');
    expect(ok(migrate(legacy({ settings: { language: 'en' } }))).rules.lang).toBe('zh');
  });

  it('honours display_minutes === false only', () => {
    expect(ok(migrate(legacy({ settings: { display_minutes: true } }))).rules.display).toBe('mm:ss');
    expect(ok(migrate(legacy({ settings: { display_minutes: false } }))).rules.display).toBe(
      'seconds',
    );
    expect(ok(migrate(legacy({ settings: { display_minutes: undefined } }))).rules.display).toBe(
      'mm:ss',
    );
  });

  it('builds the cue ladder from time_warning', () => {
    const rules = ok(migrate(legacy({ settings: { time_warning: 45 } }))).rules;
    expect(rules.cues).toEqual([
      { atMs: 45_000, tone: 'soft' },
      { atMs: 0, tone: 'double' },
    ]);
    expect(rules.graceMs).toBe(15_000);
    expect(rules.overtimeCapMs).toBe(300_000);
  });

  it('reads colours out of settings, where a real file keeps them', () => {
    const config = ok(migrate(legacy()));
    expect(config.sides[0].color).toBe('#0000FF');
    expect(config.sides[1].color).toBe('#FF0000');
    expect(codes(migrate(legacy()).problems)).not.toContain('BAD_COLOR');
  });

  it('also accepts colours at the root, and reports an unreadable one', () => {
    const raw = legacy({ settings: { pro_colors: undefined, con_colors: undefined } });
    raw['pro_colors'] = '#123456';
    raw['con_colors'] = 'chartreuse';
    const result = migrate(raw);
    const config = ok(result);
    expect(config.sides[0].color).toBe('#123456');
    expect(config.sides[1].color).toBe('#0072B2');
    expect(codes(result.problems)).toContain('BAD_COLOR');
    expect(result.problems.find((p) => p.code === 'BAD_COLOR')?.severity).toBe('warning');
  });

  it('names both sides in both languages', () => {
    const config = ok(migrate(legacy()));
    expect(config.sides[0].label).toEqual({ en: 'Proposition', zh: '正方' });
    expect(config.sides[1].label).toEqual({ en: 'Opposition', zh: '反方' });
  });
});

describe('bad input is reported, never thrown', () => {
  it('reports an out-of-range speaker index at its position and keeps a placeholder', () => {
    const result = migrate(legacy({ order: [1, 5, -9] }));
    const config = ok(result);
    const outOfRange = result.problems.filter((p) => p.code === 'SPEAKER_OUT_OF_RANGE');
    expect(outOfRange.map((p) => p.at)).toEqual([1, 2]);
    expect(outOfRange.every((p) => p.severity === 'warning')).toBe(true);
    expect(config.segments).toHaveLength(3);
    const placeholder = config.segments[1];
    expect(placeholder?.kind).toBe('break');
    if (placeholder?.kind === 'break') {
      expect(placeholder.label.en).toBe('Unresolved: 5');
      expect(placeholder.label.zh).toBe('无法解析：5');
      expect(placeholder.allottedMs).toBe(0);
    }
    expect(outOfRange[0]?.message.en).toContain('Pro speaker 5');
    expect(outOfRange[1]?.message.en).toContain('Con speaker 9');
  });

  it('does not throw on an index far past the roster', () => {
    expect(() => migrate(legacy({ order: [9999, -9999] }))).not.toThrow();
    expect(ok(migrate(legacy({ order: [9999] }))).segments).toHaveLength(1);
  });

  it('keeps an unrecognised token as a labelled placeholder', () => {
    const result = migrate(legacy({ order: ['lunch', 0, 1.5] }));
    const config = ok(result);
    expect(codes(result.problems).filter((c) => c === 'UNKNOWN_TOKEN')).toHaveLength(3);
    expect(config.segments.every((s) => s.kind === 'break')).toBe(true);
    const first = config.segments[0];
    if (first?.kind === 'break') expect(first.label.en).toBe('Unresolved: lunch');
  });

  it('normalises JsonUtility-coerced tokens before reading them', () => {
    // A real file mixes bare integers with strings, and Unity accepted ' PREP '.
    expect(tokensOf(ok(migrate(legacy({ order: [' PREP ', '1', 1, 'FREE', '-2'] }))))).toEqual([
      'prep',
      1,
      1,
      'free',
      -2,
    ]);
  });

  it('substitutes 3:00 for a participant with no usable time and says so', () => {
    const result = migrate(
      legacy({
        pro: [
          { name: 'A', time: 0 },
          { name: 'B', time: 'abc' },
        ],
        order: [1, 2],
      }),
    );
    const config = ok(result);
    expect(config.speakers[0]?.defaultMs).toBe(180_000);
    expect(config.speakers[1]?.defaultMs).toBe(180_000);
    expect(codes(result.problems).filter((c) => c === 'BAD_DURATION')).toHaveLength(2);
  });

  it('reads a numeric string time', () => {
    expect(
      ok(migrate(legacy({ pro: [{ name: 'A', time: '240' }], order: [1] }))).speakers[0]?.defaultMs,
    ).toBe(240_000);
  });

  it('reports an empty side and an empty order without failing the import', () => {
    const result = migrate(legacy({ pro: [], con: [], order: [] }));
    expect(result.config).not.toBeNull();
    expect(codes(result.problems)).toContain('EMPTY_ROSTER');
    expect(codes(result.problems)).toContain('EMPTY_ORDER');
  });

  it('notes a warning threshold that could never have fired', () => {
    const result = migrate(
      legacy({ settings: { time_warning: 400 }, pro: [{ name: 'A', time: 120 }], order: [1] }),
    );
    const note = result.problems.find((p) => p.code === 'CUE_NEVER_FIRES');
    expect(note?.severity).toBe('info');
    expect(note?.message.en).toContain('400s');
  });

  it('notes a missing title and still names the round', () => {
    const result = migrate(legacy({ title: '  ' }));
    expect(codes(result.problems)).toContain('MISSING_TITLE');
    expect(ok(result).title).toEqual({ en: 'Imported Round', zh: '导入的比赛' });
  });

  it('mirrors a present title into both languages', () => {
    expect(ok(migrate(legacy())).title).toEqual({
      en: 'New Debate Title',
      zh: 'New Debate Title',
    });
  });

  it('survives missing or wrongly-typed arrays entirely', () => {
    const result = migrateUnity({ event_order: ['prep'] });
    expect(result.config?.segments).toHaveLength(1);
    expect(() => migrateUnity(undefined)).not.toThrow();
    expect(() => migrateUnity({ event_order: 'not an array' })).not.toThrow();
    expect(() => migrateUnity({ pro_side: 'nonsense', event_order: [1] })).not.toThrow();
    expect(migrateUnity({ pro_side: 'nonsense', event_order: [1] }).config?.speakers).toEqual([]);
  });
});

describe('version dispatch', () => {
  it('refuses a non-object', () => {
    for (const value of [null, 42, 'text', undefined, [1, 2]]) {
      const result = migrate(value);
      expect(result.config).toBeNull();
      expect(result.source).toBe('none');
      expect(codes(result.problems)).toEqual(['NOT_AN_OBJECT']);
    }
  });

  it('refuses an object it cannot recognise', () => {
    const result = migrate({ hello: 'world' });
    expect(codes(result.problems)).toEqual(['UNRECOGNISED']);
    expect(result.config).toBeNull();
  });

  it('refuses a newer schema rather than guessing', () => {
    const result = migrate({ v: SCHEMA_VERSION + 1 });
    expect(codes(result.problems)).toEqual(['FUTURE_VERSION']);
    expect(result.config).toBeNull();
  });

  it('refuses a reserved older schema', () => {
    expect(codes(migrate({ v: 1 }).problems)).toEqual(['UNSUPPORTED_VERSION']);
    expect(codes(migrate({ v: 'x' }).problems)).toEqual(['UNSUPPORTED_VERSION']);
  });

  it('adopts a v3 file and reports what it took', () => {
    const source: RoundConfig = {
      v: SCHEMA_VERSION,
      id: 'keepme',
      title: { en: 'T', zh: 'T' },
      sides: [
        { id: 'A', label: { en: 'A', zh: '甲' }, color: '#E69F00', prepBankMs: 0 },
        { id: 'B', label: { en: 'B', zh: '乙' }, color: '#0072B2', prepBankMs: 0 },
      ],
      speakers: [{ id: 'sp1', side: 'A', name: 'One', defaultMs: 180_000 }],
      segments: [{ id: 'sg1', kind: 'speech', speakerId: 'sp1', allottedMs: null }],
      rules: defaultRules(),
      presetRef: 'blank',
    };
    const result = migrate(JSON.parse(JSON.stringify(source)));
    expect(result.source).toBe('v3');
    expect(result.config?.id).toBe('keepme');
    expect(result.config?.presetRef).toBe('blank');
    expect(result.config?.segments).toHaveLength(1);
    expect(codes(result.problems)).toEqual(['IMPORTED']);
  });

  it('repairs a hand-edited v3 file instead of crashing on it', () => {
    const result = migrate({ v: SCHEMA_VERSION, sides: 'nope', speakers: 7, segments: null });
    const config = ok(result);
    expect(config.sides).toHaveLength(2);
    expect(config.speakers).toEqual([]);
    expect(config.segments).toEqual([]);
    expect(config.id).toMatch(/^[0-9a-z]{8}$/);
    expect(config.rules.cues.length).toBeGreaterThan(0);
    expect(codes(result.problems)).toContain('EMPTY_ORDER');
  });
});

describe('parseAndMigrate', () => {
  it('reads a real file end to end', () => {
    const result = parseAndMigrate(JSON.stringify(legacy()));
    expect(result.source).toBe('unity');
    expect(tokensOf(ok(result))).toEqual([...USER_ORDER]);
  });

  it('turns a truncated file into a problem, not an exception', () => {
    const result = parseAndMigrate('{"settings":');
    expect(result.config).toBeNull();
    expect(codes(result.problems)).toEqual(['BAD_JSON']);
    expect(result.problems[0]?.message.en).toContain('Could not read the file');
  });

  it('handles an empty buffer', () => {
    expect(parseAndMigrate('').config).toBeNull();
    expect(codes(parseAndMigrate('').problems)).toEqual(['BAD_JSON']);
  });
});
