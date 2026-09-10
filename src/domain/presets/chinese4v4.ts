import type { RoundConfig } from '../config';
import { SCHEMA_VERSION } from '../config';
import { COLOR_A, COLOR_B, CUES_SHORT, FREE_DEBATE, rulesStd, side } from './common';

/**
 * The default preset: the format the operator actually runs.
 *
 * Free debate sits between the rebuttals and the closing summaries so the summary
 * speakers can answer it, and Pro closes last. Prep is a 1:00 bank per side drawn
 * on demand, not a scheduled slot — the shipped Unity order scheduled two prep
 * blocks and ran free debate dead last.
 *
 * This order is a starting point, not a rule. Reorder, repeat or drop any speaker.
 */
export const chinese4v4: RoundConfig = {
  v: SCHEMA_VERSION,
  id: 'chinese4v4',
  presetRef: 'chinese4v4',
  title: { en: 'Chinese Academic Debate', zh: '华语辩论赛' },
  sides: [
    side('A', 'Proposition', '正方', COLOR_A, 60_000),
    side('B', 'Opposition', '反方', COLOR_B, 60_000),
  ],
  speakers: [
    { id: 'a1', side: 'A', name: '正一', role: { en: 'Opening Constructive', zh: '开篇立论' }, defaultMs: 180_000 },
    { id: 'a2', side: 'A', name: '正二', role: { en: 'Cross-Examination', zh: '质询' }, defaultMs: 90_000 },
    { id: 'a3', side: 'A', name: '正三', role: { en: 'Rebuttal', zh: '驳论' }, defaultMs: 120_000 },
    { id: 'a4', side: 'A', name: '正四', role: { en: 'Closing Summary', zh: '总结陈词' }, defaultMs: 240_000 },
    { id: 'b1', side: 'B', name: '反一', role: { en: 'Opening Constructive', zh: '开篇立论' }, defaultMs: 180_000 },
    { id: 'b2', side: 'B', name: '反二', role: { en: 'Cross-Examination', zh: '质询' }, defaultMs: 90_000 },
    { id: 'b3', side: 'B', name: '反三', role: { en: 'Rebuttal', zh: '驳论' }, defaultMs: 120_000 },
    { id: 'b4', side: 'B', name: '反四', role: { en: 'Closing Summary', zh: '总结陈词' }, defaultMs: 240_000 },
  ],
  segments: [
    { id: 's1', kind: 'speech', speakerId: 'a1', allottedMs: null },
    { id: 's2', kind: 'speech', speakerId: 'b1', allottedMs: null },
    {
      id: 's3',
      kind: 'speech',
      speakerId: 'b2',
      allottedMs: null,
      label: { en: 'Con 2 cross-examines Pro 1', zh: '反二质询正一' },
    },
    {
      id: 's4',
      kind: 'speech',
      speakerId: 'a2',
      allottedMs: null,
      label: { en: 'Pro 2 cross-examines Con 1', zh: '正二质询反一' },
    },
    { id: 's5', kind: 'speech', speakerId: 'a3', allottedMs: null },
    { id: 's6', kind: 'speech', speakerId: 'b3', allottedMs: null },
    { id: 's7', kind: 'chess', label: FREE_DEBATE, perSideMs: 240_000, firstFloor: 'A' },
    { id: 's8', kind: 'speech', speakerId: 'b4', allottedMs: null },
    { id: 's9', kind: 'speech', speakerId: 'a4', allottedMs: null },
  ],
  rules: rulesStd({ lang: 'zh', cues: [...CUES_SHORT] }),
};
