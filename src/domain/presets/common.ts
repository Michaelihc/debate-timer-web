import type { CueSpec, Hex, L10n, Rules, SideCfg, SideId } from '../config';
import { defaultRules } from '../config';

/** 1:00 / 0:30 warnings then a double knock at time. */
export const CUES_STD: readonly CueSpec[] = [
  { atMs: 60_000, tone: 'soft' },
  { atMs: 30_000, tone: 'soft' },
  { atMs: 0, tone: 'double' },
];

/** The shorter ladder for formats whose speeches run under three minutes. */
export const CUES_SHORT: readonly CueSpec[] = [
  { atMs: 30_000, tone: 'soft' },
  { atMs: 0, tone: 'double' },
];

/** One knock when protected time lifts, one when it resumes, two at time. */
export function protectedCues(allottedMs: number, protectedMs: number): CueSpec[] {
  return [
    { atMs: allottedMs - protectedMs, tone: 'single', label: { en: 'POIs open', zh: '可提问' } },
    { atMs: protectedMs, tone: 'single', label: { en: 'POIs close', zh: '停止提问' } },
    { atMs: 0, tone: 'double' },
  ];
}

export function rulesStd(over: Partial<Rules> = {}): Rules {
  return { ...defaultRules(), cues: [...CUES_STD], ...over };
}

export function side(id: SideId, en: string, zh: string, color: Hex, prepBankMs = 0): SideCfg {
  return { id, label: { en, zh }, color, prepBankMs };
}

export const CX: L10n = { en: 'Cross-Examination', zh: '质询' };
export const FREE_DEBATE: L10n = { en: 'Free Debate', zh: '自由辩论' };
/** The Unity app's own label for the prep phase (MenuController: 准备时间). */
export const PREP: L10n = { en: 'Preparation Time', zh: '准备时间' };
export const COLOR_A: Hex = '#E69F00';
export const COLOR_B: Hex = '#0072B2';
