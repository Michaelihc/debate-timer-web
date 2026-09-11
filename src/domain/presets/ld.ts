import type { RoundConfig } from '../config';
import { SCHEMA_VERSION } from '../config';
import { COLOR_A, COLOR_B, CUES_SHORT, rulesStd, side } from './common';

/**
 * One debater per side. The three Aff entries are the same person with different
 * allocations, which is exactly why a speech carries its own speaker reference
 * rather than a signed roster index.
 */
export const ld: RoundConfig = {
  v: SCHEMA_VERSION,
  id: 'ld',
  presetRef: 'ld',
  title: { en: 'Lincoln-Douglas', zh: '林肯-道格拉斯制' },
  sides: [
    side('A', 'Affirmative', '正方', COLOR_A),
    side('B', 'Negative', '反方', COLOR_B),
  ],
  speakers: [
    { id: 'ac', side: 'A', name: 'Aff', role: { en: 'Affirmative Constructive (AC)', zh: '正方立论' }, defaultMs: 360_000 },
    { id: '1ar', side: 'A', name: 'Aff', role: { en: 'First Aff Rebuttal (1AR)', zh: '正方一驳' }, defaultMs: 240_000 },
    { id: '2ar', side: 'A', name: 'Aff', role: { en: 'Second Aff Rebuttal (2AR)', zh: '正方二驳' }, defaultMs: 180_000 },
    { id: 'nc', side: 'B', name: 'Neg', role: { en: 'Negative Constructive (NC)', zh: '反方立论' }, defaultMs: 420_000 },
    { id: 'nr', side: 'B', name: 'Neg', role: { en: 'Negative Rebuttal (NR)', zh: '反方驳论' }, defaultMs: 360_000 },
  ],
  segments: [
    { id: 's1', kind: 'speech', speakerId: 'ac', allottedMs: null },
    {
      id: 's2',
      kind: 'shared',
      label: { en: 'Cross-Examination (Neg asks)', zh: '质询(反方提问)' },
      allottedMs: 180_000,
      live: ['A', 'B'],
      speakerIds: ['ac', 'nc'],
    },
    { id: 's3', kind: 'speech', speakerId: 'nc', allottedMs: null },
    {
      id: 's4',
      kind: 'shared',
      label: { en: 'Cross-Examination (Aff asks)', zh: '质询(正方提问)' },
      allottedMs: 180_000,
      live: ['A', 'B'],
      speakerIds: ['ac', 'nc'],
    },
    { id: 's5', kind: 'speech', speakerId: '1ar', allottedMs: null },
    { id: 's6', kind: 'speech', speakerId: 'nr', allottedMs: null },
    { id: 's7', kind: 'speech', speakerId: '2ar', allottedMs: null },
  ],
  rules: rulesStd({ cues: [...CUES_SHORT] }),
};
