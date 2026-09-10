/**
 * What can and cannot be reported about a round.
 *
 * The run order belongs to the operator. Any speaker may appear at any position,
 * any number of times, or not at all; prep, free-debate and break blocks may sit
 * anywhere, any number of times. None of that is a problem of any severity here —
 * there is deliberately no code for an unused speaker, a repeated speaker or an
 * unconventional sequence, and nothing in this file reorders or completes anything.
 *
 * Errors are reserved for a round that genuinely cannot execute. Everything else is
 * a warning or a statement of fact, and `START ROUND` is disabled only on errors.
 */

import type { Id, L10nText, RoundConfig, SideId } from './config';
import { speakerById } from './config';
import { resolveAllotted, resolveCues } from './plan';
import { checkPair, parseHex } from '../lib/contrast';
import { formatTime } from '../lib/format';
import type { StringKey } from '../i18n/strings';
import { STRINGS } from '../i18n/strings';

export type Severity = 'error' | 'warning' | 'info';

export type ProblemCode =
  | 'MISSING_SPEAKER'
  | 'EMPTY_ORDER'
  | 'ZERO_DURATION'
  | 'CUE_EXCEEDS_SEGMENT'
  | 'PROTECTED_OVERLAP'
  | 'COLOR_TOO_CLOSE'
  | 'COLOR_LOW_CONTRAST'
  | 'INVALID_COLOR'
  | 'UNNAMED_SPEAKER';

/** Where the validation strip scrolls to and what it focuses. */
export type ProblemRef =
  | { kind: 'round' }
  | { kind: 'segment'; segId: Id; index: number }
  | { kind: 'cue'; segId: Id; index: number; atMs: number }
  | { kind: 'speaker'; speakerId: Id }
  | { kind: 'side'; side: SideId };

export interface Problem {
  code: ProblemCode;
  severity: Severity;
  ref: ProblemRef;
  message: L10nText;
}

type Vars = Record<string, string | number>;

const TOKEN = /\{(\w+)\}/g;

/**
 * Both locales at once. `validate` runs in the domain layer, which never sees the
 * live language, so a problem carries its text in both and the strip picks one.
 */
function message(key: StringKey, vars?: Vars): L10nText {
  const fill = (text: string) =>
    vars === undefined
      ? text
      : text.replace(TOKEN, (match, name: string) => {
          const value = vars[name];
          return value === undefined ? match : String(value);
        });
  return { en: fill(STRINGS.en[key]), zh: fill(STRINGS.zh[key]) };
}

export function validate(config: RoundConfig): Problem[] {
  const problems: Problem[] = [];

  if (config.segments.length === 0) {
    problems.push({
      code: 'EMPTY_ORDER',
      severity: 'error',
      ref: { kind: 'round' },
      message: message('v.emptySheet'),
    });
  }

  for (const [index, segment] of config.segments.entries()) {
    const ref: ProblemRef = { kind: 'segment', segId: segment.id, index };

    // A reference with no roster entry is the one thing that cannot run. The
    // original threw IndexOutOfRangeException here, mid-round, after it had
    // already advanced the speaker index.
    const referenced: Id[] =
      segment.kind === 'speech'
        ? [segment.speakerId]
        : segment.kind === 'shared'
          ? (segment.speakerIds ?? [])
          : [];
    let dangling = false;
    for (const speakerId of referenced) {
      if (speakerById(config, speakerId) === undefined) {
        dangling = true;
        problems.push({
          code: 'MISSING_SPEAKER',
          severity: 'error',
          ref,
          message: message('v.missingSpeaker'),
        });
      }
    }

    // For a chess segment the meaningful number is one side's clock, not the pair.
    const clockMs = segment.kind === 'chess' ? segment.perSideMs : resolveAllotted(segment, config);

    if (clockMs <= 0 && !dangling) {
      problems.push({
        code: 'ZERO_DURATION',
        severity: 'error',
        ref,
        message: message('v.zeroDuration'),
      });
    }

    if (clockMs > 0) {
      for (const cue of resolveCues(segment, config.rules)) {
        // A cue at 0 is expiry and always fires; one at or above the allotment
        // fires on the first frame, which is worth knowing at 3pm rather than
        // discovering mid-round.
        if (cue.atMs > 0 && cue.atMs >= clockMs) {
          problems.push({
            code: 'CUE_EXCEEDS_SEGMENT',
            severity: 'info',
            ref: { kind: 'cue', segId: segment.id, index, atMs: cue.atMs },
            message: message('v.cueExceedsSegment', {
              cue: formatTime(cue.atMs),
              len: formatTime(clockMs),
            }),
          });
        }
      }
    }

    if (segment.kind === 'speech') {
      const protectedMs = segment.protectedMs ?? 0;
      if (protectedMs > 0 && protectedMs * 2 > clockMs) {
        problems.push({
          code: 'PROTECTED_OVERLAP',
          severity: 'warning',
          ref,
          message: message('v.protectedOverlap'),
        });
      }
    }
  }

  for (const speaker of config.speakers) {
    if (speaker.name.trim() === '') {
      problems.push({
        code: 'UNNAMED_SPEAKER',
        severity: 'info',
        ref: { kind: 'speaker', speakerId: speaker.id },
        message: message('v.unnamedSpeaker'),
      });
    }
  }

  problems.push(...validateColors(config));
  return problems;
}

function validateColors(config: RoundConfig): Problem[] {
  const out: Problem[] = [];
  const [a, b] = config.sides;

  for (const cfg of [a, b]) {
    if (parseHex(cfg.color) === null) {
      out.push({
        code: 'INVALID_COLOR',
        severity: 'warning',
        ref: { kind: 'side', side: cfg.id },
        message: message('v.colorLowContrast'),
      });
    }
  }

  const check = checkPair(a.color, b.color);
  const tooClose = check.reasons.some(
    (r) => r === 'DELTA_L_BLOCK' || r === 'DELTA_L_WARN' || r === 'CVD_DEUTERANOPIA' || r === 'CVD_PROTANOPIA',
  );
  if (tooClose) {
    out.push({
      code: 'COLOR_TOO_CLOSE',
      severity: 'warning',
      ref: { kind: 'side', side: 'A' },
      message: message('v.colorTooClose'),
    });
  }
  if (check.reasons.includes('CONTRAST_A')) {
    out.push({
      code: 'COLOR_LOW_CONTRAST',
      severity: 'warning',
      ref: { kind: 'side', side: 'A' },
      message: message('v.colorLowContrast'),
    });
  }
  if (check.reasons.includes('CONTRAST_B')) {
    out.push({
      code: 'COLOR_LOW_CONTRAST',
      severity: 'warning',
      ref: { kind: 'side', side: 'B' },
      message: message('v.colorLowContrast'),
    });
  }
  return out;
}

export interface ProblemCounts {
  errors: number;
  warnings: number;
  infos: number;
}

export function countProblems(problems: readonly Problem[]): ProblemCounts {
  const counts: ProblemCounts = { errors: 0, warnings: 0, infos: 0 };
  for (const p of problems) {
    if (p.severity === 'error') counts.errors++;
    else if (p.severity === 'warning') counts.warnings++;
    else counts.infos++;
  }
  return counts;
}

/** The only thing that may disable START ROUND / APPLY. */
export function hasErrors(problems: readonly Problem[]): boolean {
  return problems.some((p) => p.severity === 'error');
}

export function firstError(problems: readonly Problem[]): Problem | null {
  return problems.find((p) => p.severity === 'error') ?? null;
}

export function problemsForSegment(problems: readonly Problem[], segId: Id): Problem[] {
  return problems.filter(
    (p) => (p.ref.kind === 'segment' || p.ref.kind === 'cue') && p.ref.segId === segId,
  );
}

export function problemsForSpeaker(problems: readonly Problem[], speakerId: Id): Problem[] {
  return problems.filter((p) => p.ref.kind === 'speaker' && p.ref.speakerId === speakerId);
}

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** Errors first, then warnings, then facts — the order the strip renders chips in. */
export function sortProblems(problems: readonly Problem[]): Problem[] {
  return [...problems].sort((x, y) => RANK[x.severity] - RANK[y.severity]);
}
