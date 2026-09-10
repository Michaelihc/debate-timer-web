import type { RoundConfig } from '../config';
import { SCHEMA_VERSION } from '../config';
import { COLOR_A, COLOR_B, CUES_SHORT, rulesStd, side } from './common';

const CROSSFIRE = { en: 'Crossfire', zh: '对辩' };
const GRAND_CROSSFIRE = { en: 'Grand Crossfire', zh: '全体对辩' };

/**
 * Both speakers appear twice, which is the format, not a mistake. The 0:30 warning
 * on the 2:00 Final Focus is well inside the segment; raise it to 1:00 and the
 * validator says so at 3pm instead of mid-round.
 */
export const pf: RoundConfig = {
  v: SCHEMA_VERSION,
  id: 'pf',
  presetRef: 'pf',
  title: { en: 'Public Forum', zh: '公众论坛制' },
  sides: [side('A', 'Pro', '正方', COLOR_A, 180_000), side('B', 'Con', '反方', COLOR_B, 180_000)],
  speakers: [
    { id: 'a1', side: 'A', name: 'Pro 1', role: { en: 'Constructive', zh: '立论' }, defaultMs: 240_000 },
    { id: 'a2', side: 'A', name: 'Pro 2', role: { en: 'Rebuttal', zh: '驳论' }, defaultMs: 240_000 },
    { id: 'a3', side: 'A', name: 'Pro 1', role: { en: 'Summary', zh: '总结' }, defaultMs: 120_000 },
    { id: 'a4', side: 'A', name: 'Pro 2', role: { en: 'Final Focus', zh: '结辩' }, defaultMs: 120_000 },
    { id: 'b1', side: 'B', name: 'Con 1', role: { en: 'Constructive', zh: '立论' }, defaultMs: 240_000 },
    { id: 'b2', side: 'B', name: 'Con 2', role: { en: 'Rebuttal', zh: '驳论' }, defaultMs: 240_000 },
    { id: 'b3', side: 'B', name: 'Con 1', role: { en: 'Summary', zh: '总结' }, defaultMs: 120_000 },
    { id: 'b4', side: 'B', name: 'Con 2', role: { en: 'Final Focus', zh: '结辩' }, defaultMs: 120_000 },
  ],
  segments: [
    { id: 's1', kind: 'speech', speakerId: 'a1', allottedMs: null },
    { id: 's2', kind: 'speech', speakerId: 'b1', allottedMs: null },
    {
      id: 's3',
      kind: 'shared',
      label: CROSSFIRE,
      allottedMs: 180_000,
      live: ['A', 'B'],
      speakerIds: ['a1', 'b1'],
    },
    { id: 's4', kind: 'speech', speakerId: 'a2', allottedMs: null },
    { id: 's5', kind: 'speech', speakerId: 'b2', allottedMs: null },
    {
      id: 's6',
      kind: 'shared',
      label: CROSSFIRE,
      allottedMs: 180_000,
      live: ['A', 'B'],
      speakerIds: ['a2', 'b2'],
    },
    { id: 's7', kind: 'speech', speakerId: 'a3', allottedMs: null },
    { id: 's8', kind: 'speech', speakerId: 'b3', allottedMs: null },
    {
      id: 's9',
      kind: 'shared',
      label: GRAND_CROSSFIRE,
      allottedMs: 180_000,
      live: ['A', 'B'],
      speakerIds: ['a1', 'a2', 'b1', 'b2'],
    },
    { id: 's10', kind: 'speech', speakerId: 'a4', allottedMs: null },
    { id: 's11', kind: 'speech', speakerId: 'b4', allottedMs: null },
  ],
  rules: rulesStd({ cues: [...CUES_SHORT] }),
};
