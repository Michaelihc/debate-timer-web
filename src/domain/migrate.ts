/**
 * Version dispatch and the legacy Unity `save.json` importer.
 *
 * Nothing in this file throws. A truncated file, a string where a number belonged,
 * a speaker index past the end of the roster — each becomes a reported problem and
 * the import still produces something the operator can look at and fix. The C#
 * original crashed on a bad index mid-round and wrote its own exception message
 * into the text field the user was editing.
 */

import type {
  CueSpec,
  Hex,
  L10nText,
  RoundConfig,
  Rules,
  Segment,
  SpeakerCfg,
} from './config';
import { DEFAULT_COLOR_A, DEFAULT_COLOR_B, SCHEMA_VERSION, defaultRules } from './config';
import { uniqueId } from './id';
import { parseHex, toHex } from '../lib/contrast';

export type MigrationSeverity = 'error' | 'warning' | 'info';

export type MigrationCode =
  | 'NOT_AN_OBJECT'
  | 'BAD_JSON'
  | 'UNRECOGNISED'
  | 'FUTURE_VERSION'
  | 'UNSUPPORTED_VERSION'
  | 'IMPORTED'
  | 'EMPTY_ORDER'
  | 'EMPTY_ROSTER'
  | 'SPEAKER_OUT_OF_RANGE'
  | 'UNKNOWN_TOKEN'
  | 'BAD_COLOR'
  | 'BAD_DURATION'
  | 'FREE_PER_SIDE'
  | 'CUE_NEVER_FIRES'
  | 'MISSING_TITLE';

export interface MigrationProblem {
  code: MigrationCode;
  severity: MigrationSeverity;
  message: L10nText;
  /** Position in `event_order`, when the problem came from one token. */
  at?: number;
}

export type MigrationSource = 'unity' | 'v3' | 'none';

export interface MigrationResult {
  /** `null` only when the input cannot be read at all; the caller keeps its buffer. */
  config: RoundConfig | null;
  problems: MigrationProblem[];
  source: MigrationSource;
}

function problem(
  code: MigrationCode,
  severity: MigrationSeverity,
  en: string,
  zh: string,
  at?: number,
): MigrationProblem {
  return at === undefined
    ? { code, severity, message: { en, zh } }
    : { code, severity, message: { en, zh }, at };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Seconds from the legacy file, which sometimes stored them as strings. */
function seconds(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function msFrom(value: unknown, fallbackSec: number): number {
  const s = seconds(value);
  if (s === null || s < 0) return fallbackSec * 1000;
  return Math.round(s * 1000);
}

function colorFrom(value: unknown, fallback: Hex): { color: Hex; ok: boolean } {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return { color: fallback, ok: false };
  const rgb = parseHex(raw);
  return rgb ? { color: toHex(rgb), ok: true } : { color: fallback, ok: false };
}

/**
 * The entry point. Sniffs the schema, never throws, and returns problems the import
 * sheet shows before anything is applied.
 */
export function migrate(raw: unknown): MigrationResult {
  if (!isRecord(raw)) {
    return {
      config: null,
      source: 'none',
      problems: [
        problem(
          'NOT_AN_OBJECT',
          'error',
          'This file is not a debate round.',
          '此文件不是一场比赛的配置。',
        ),
      ],
    };
  }

  const version = raw['v'];
  if (version === undefined) {
    if ('event_order' in raw) return migrateUnity(raw);
    return {
      config: null,
      source: 'none',
      problems: [
        problem(
          'UNRECOGNISED',
          'error',
          'Unrecognised format — no version field and no event_order.',
          '无法识别的格式 — 既没有版本号，也没有 event_order。',
        ),
      ],
    };
  }

  if (version === SCHEMA_VERSION) return adoptV3(raw);

  if (typeof version === 'number' && version > SCHEMA_VERSION) {
    return {
      config: null,
      source: 'none',
      problems: [
        problem(
          'FUTURE_VERSION',
          'error',
          'This round was made by a newer version of the app.',
          '这场比赛由更新版本的应用创建。',
        ),
      ],
    };
  }

  return {
    config: null,
    source: 'none',
    problems: [
      problem(
        'UNSUPPORTED_VERSION',
        'error',
        `Schema version ${String(version)} is not supported.`,
        `不支持的配置版本：${String(version)}。`,
      ),
    ],
  };
}

/** `JSON.parse` in a try/catch. A parse failure never touches the caller's buffer. */
export function parseAndMigrate(text: string): MigrationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      config: null,
      source: 'none',
      problems: [
        problem('BAD_JSON', 'error', `Could not read the file: ${detail}`, `无法解析文件：${detail}`),
      ],
    };
  }
  return migrate(raw);
}

// A v3 file from a share link or an export. Shape-check the parts we index into so
// a hand-edited file cannot crash a render, but leave the operator's data alone.
function adoptV3(raw: Record<string, unknown>): MigrationResult {
  const problems: MigrationProblem[] = [];
  const base = raw as unknown as RoundConfig;

  const minted = new Set<string>();
  const rules: Rules = { ...defaultRules(), ...(isRecord(raw['rules']) ? base.rules : {}) };
  if (!Array.isArray(rules.cues)) rules.cues = defaultRules().cues;

  const sidesRaw = Array.isArray(raw['sides']) ? base.sides : null;
  const sides: RoundConfig['sides'] = sidesRaw &&
  sidesRaw[0] !== undefined &&
  sidesRaw[1] !== undefined
    ? [sidesRaw[0], sidesRaw[1]]
    : [
        { id: 'A', label: { en: 'Side A', zh: '正方' }, color: DEFAULT_COLOR_A, prepBankMs: 0 },
        { id: 'B', label: { en: 'Side B', zh: '反方' }, color: DEFAULT_COLOR_B, prepBankMs: 0 },
      ];

  const config: RoundConfig = {
    v: SCHEMA_VERSION,
    id: typeof base.id === 'string' && base.id !== '' ? base.id : uniqueId(minted),
    title: isRecord(raw['title'])
      ? base.title
      : { en: 'Imported Round', zh: '导入的比赛' },
    sides,
    speakers: Array.isArray(raw['speakers']) ? base.speakers : [],
    segments: Array.isArray(raw['segments']) ? base.segments : [],
    rules,
  };
  if (typeof base.presetRef === 'string') config.presetRef = base.presetRef;

  if (config.segments.length === 0) {
    problems.push(
      problem('EMPTY_ORDER', 'warning', 'The run order is empty.', '流程为空。'),
    );
  }
  problems.push(
    problem(
      'IMPORTED',
      'info',
      `Imported ${config.speakers.length} speakers and ${config.segments.length} segments.`,
      `已导入 ${config.speakers.length} 位辩手、${config.segments.length} 个环节。`,
    ),
  );
  return { config, problems, source: 'v3' };
}

interface LegacyParticipant {
  name: unknown;
  time: unknown;
}

/**
 * `event_order` is `Array<string | number>` in a real file: `JsonUtility` coerced
 * bare integers into its declared `string[]`, `JSON.parse` does not. Normalising
 * with `String(v)` FIRST, before anything reads it, is the whole fix.
 */
export function migrateUnity(raw: unknown): MigrationResult {
  const problems: MigrationProblem[] = [];
  const root = isRecord(raw) ? raw : {};
  const settings = isRecord(root['settings']) ? root['settings'] : {};

  const orderRaw = Array.isArray(root['event_order']) ? root['event_order'] : [];
  const order: string[] = orderRaw.map((token) => String(token).trim().toLowerCase());

  const minted = new Set<string>();
  const readRoster = (value: unknown): LegacyParticipant[] =>
    Array.isArray(value) ? value.filter(isRecord).map((p) => ({ name: p['name'], time: p['time'] })) : [];

  const proRaw = readRoster(root['pro_side']);
  const conRaw = readRoster(root['con_side']);

  const mk = (side: 'A' | 'B', index: number, p: LegacyParticipant): SpeakerCfg => {
    const sec = seconds(p.time);
    if (sec === null || sec <= 0) {
      problems.push(
        problem(
          'BAD_DURATION',
          'warning',
          `${side === 'A' ? 'Pro' : 'Con'} speaker ${index + 1} had no usable time; set to 3:00.`,
          `${side === 'A' ? '正方' : '反方'}第 ${index + 1} 位辩手没有可用时长，已设为 3:00。`,
        ),
      );
    }
    const name = typeof p.name === 'string' && p.name.trim() !== '' ? p.name : '';
    return {
      id: uniqueId(minted),
      side,
      name,
      defaultMs: sec !== null && sec > 0 ? Math.round(sec * 1000) : 180_000,
    };
  };

  const pro = proRaw.map((p, i) => mk('A', i, p));
  const con = conRaw.map((p, i) => mk('B', i, p));

  if (pro.length === 0 || con.length === 0) {
    problems.push(
      problem(
        'EMPTY_ROSTER',
        'warning',
        'One side has no speakers in the imported file.',
        '导入的文件中有一方没有辩手。',
      ),
    );
  }

  const prepMs = msFrom(settings['time_prep'], 0);
  const freeMs = msFrom(settings['time_free'], 0);
  const warningMs = msFrom(settings['time_warning'], 30);

  let convertedIndices = 0;
  let freeCount = 0;

  const segments: Segment[] = order.map((token, at): Segment => {
    if (token === 'prep') {
      return {
        id: uniqueId(minted),
        kind: 'prep',
        label: { en: 'Preparation', zh: '准备时间' },
        side: 'both',
        allottedMs: prepMs,
      };
    }
    if (token === 'free') {
      freeCount++;
      return {
        id: uniqueId(minted),
        kind: 'chess',
        label: { en: 'Free Debate', zh: '自由辩论' },
        perSideMs: freeMs,
        firstFloor: 'A',
      };
    }

    const n = Number(token);
    if (Number.isInteger(n) && n !== 0) {
      const roster = n > 0 ? pro : con;
      const speaker = roster[Math.abs(n) - 1];
      if (speaker) {
        convertedIndices++;
        return { id: uniqueId(minted), kind: 'speech', speakerId: speaker.id, allottedMs: null };
      }
      problems.push(
        problem(
          'SPEAKER_OUT_OF_RANGE',
          'warning',
          `Position ${at + 1} names ${n > 0 ? 'Pro' : 'Con'} speaker ${Math.abs(n)}, who is not on the roster. Kept as a placeholder block.`,
          `第 ${at + 1} 个环节指向${n > 0 ? '正方' : '反方'}第 ${Math.abs(n)} 位辩手，名单中没有此人。已保留为占位环节。`,
          at,
        ),
      );
    } else {
      problems.push(
        problem(
          'UNKNOWN_TOKEN',
          'warning',
          `Position ${at + 1} holds "${token}", which is not a speaker, prep or free debate. Kept as a placeholder block.`,
          `第 ${at + 1} 个环节的值 "${token}" 既不是辩手，也不是准备或自由辩论。已保留为占位环节。`,
          at,
        ),
      );
    }

    // Never a throw and never a silent drop: the token survives as its own label.
    return {
      id: uniqueId(minted),
      kind: 'break',
      label: { en: `Unresolved: ${token}`, zh: `无法解析：${token}` },
      allottedMs: 0,
    };
  });

  if (segments.length === 0) {
    problems.push(problem('EMPTY_ORDER', 'warning', 'event_order was empty.', 'event_order 为空。'));
  }

  const proColor = colorFrom(settings['pro_colors'] ?? root['pro_colors'], DEFAULT_COLOR_A);
  const conColor = colorFrom(settings['con_colors'] ?? root['con_colors'], DEFAULT_COLOR_B);
  if (!proColor.ok || !conColor.ok) {
    problems.push(
      problem(
        'BAD_COLOR',
        'warning',
        'A side colour could not be read and fell back to the default pair.',
        '有一方的颜色无法解析，已回退到默认配色。',
      ),
    );
  }

  const cues: CueSpec[] = [
    { atMs: warningMs, tone: 'soft' },
    { atMs: 0, tone: 'double' },
  ];

  const rules: Rules = {
    ...defaultRules(),
    cues,
    graceMs: 15_000,
    display: settings['display_minutes'] === false ? 'seconds' : 'mm:ss',
    // Unity: 0 = zh-Hans, 1 = en. Anything else keeps the original default of zh.
    lang: settings['language'] === 1 ? 'en' : 'zh',
    overtimeCapMs: 300_000,
  };

  const titleText = typeof root['title'] === 'string' && root['title'].trim() !== '' ? root['title'] : '';
  if (titleText === '') {
    problems.push(
      problem('MISSING_TITLE', 'info', 'No title in the file.', '文件中没有标题。'),
    );
  }

  const config: RoundConfig = {
    v: SCHEMA_VERSION,
    id: uniqueId(minted),
    title: titleText ? { en: titleText, zh: titleText } : { en: 'Imported Round', zh: '导入的比赛' },
    sides: [
      { id: 'A', label: { en: 'Proposition', zh: '正方' }, color: proColor.color, prepBankMs: 0 },
      { id: 'B', label: { en: 'Opposition', zh: '反方' }, color: conColor.color, prepBankMs: 0 },
    ],
    speakers: [...pro, ...con],
    segments,
    rules,
  };

  if (freeCount > 0) {
    problems.push(
      problem(
        'FREE_PER_SIDE',
        'info',
        `"free" read as ${Math.round(freeMs / 1000)}s PER SIDE, not a shared pool.`,
        `"free" 按每方 ${Math.round(freeMs / 1000)} 秒计算，而非双方共用。`,
      ),
    );
  }

  // The original never surfaced this: a warning threshold above a speech's length
  // simply never fired, silently, for the whole round.
  const neverFires = segments.filter((seg) => {
    if (warningMs <= 0) return false;
    if (seg.kind === 'speech') {
      const speaker = [...pro, ...con].find((s) => s.id === seg.speakerId);
      return speaker !== undefined && warningMs >= speaker.defaultMs;
    }
    if (seg.kind === 'chess') return warningMs >= seg.perSideMs;
    if (seg.kind === 'prep' || seg.kind === 'break') return seg.allottedMs > 0 && warningMs >= seg.allottedMs;
    return false;
  }).length;
  if (neverFires > 0) {
    problems.push(
      problem(
        'CUE_NEVER_FIRES',
        'info',
        `time_warning of ${Math.round(warningMs / 1000)}s exceeds ${neverFires} segment(s); those warnings would never have fired.`,
        `time_warning 为 ${Math.round(warningMs / 1000)} 秒，超过了 ${neverFires} 个环节的时长，这些提醒原本永远不会响。`,
      ),
    );
  }

  problems.unshift(
    problem(
      'IMPORTED',
      'info',
      `Imported ${config.speakers.length} speakers and ${segments.length} segments. Converted ${convertedIndices} signed indices to speaker references.`,
      `已导入 ${config.speakers.length} 位辩手、${segments.length} 个环节，并将 ${convertedIndices} 个带符号序号转换为辩手引用。`,
    ),
  );

  return { config, problems, source: 'unity' };
}

/** Does this parsed object look like a Unity `save.json`? */
export function isLegacyUnity(raw: unknown): boolean {
  return isRecord(raw) && raw['v'] === undefined && 'event_order' in raw;
}
