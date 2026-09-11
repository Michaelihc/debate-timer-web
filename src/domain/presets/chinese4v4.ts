import type { RoundConfig } from '../config';
import { SCHEMA_VERSION } from '../config';
import { COLOR_A, COLOR_B, CUES_SHORT, FREE_DEBATE, PREP, rulesStd, side } from './common';

/**
 * The default preset: the format the operator actually runs.
 *
 * It opens on a scheduled 5:00 preparation phase, as the Unity app's default and the
 * operator's own save file both do — every figure holds a clipboard while it runs.
 * Free debate sits between the rebuttals and the closing summaries, and Pro closes
 * last.
 *
 * This order is a starting point, not a rule. Reorder, repeat or drop any speaker.
 */
export const chinese4v4: RoundConfig = {
  v: SCHEMA_VERSION,
  id: 'chinese4v4',
  presetRef: 'chinese4v4',
  title: { en: 'Chinese Academic Debate', zh: '华语辩论赛' },
  sides: [
    side('A', 'Proposition', '正方', COLOR_A),
    side('B', 'Opposition', '反方', COLOR_B),
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
    { id: 's0', kind: 'prep', label: PREP, side: 'both', allottedMs: 300_000 },
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
