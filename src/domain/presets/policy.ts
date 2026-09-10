import type { RoundConfig, SharedSegment } from '../config';
import { SCHEMA_VERSION } from '../config';
import { COLOR_A, COLOR_B, CUES_SHORT, CX, rulesStd, side } from './common';

const cx = (id: string): SharedSegment => ({
  id,
  kind: 'shared',
  label: CX,
  allottedMs: 180_000,
  live: ['A', 'B'],
});

/** 8/3/5 with 8:00 prep banks per side, drawn on demand. */
export const policy: RoundConfig = {
  v: SCHEMA_VERSION,
  id: 'policy',
  presetRef: 'policy',
  title: { en: 'Policy (Cross-Examination)', zh: '政策辩论' },
  sides: [
    side('A', 'Affirmative', '正方', COLOR_A, 480_000),
    side('B', 'Negative', '反方', COLOR_B, 480_000),
  ],
  speakers: [
    { id: '1ac', side: 'A', name: '1AC', role: { en: 'First Aff Constructive', zh: '正方一辩立论' }, defaultMs: 480_000 },
    { id: '2ac', side: 'A', name: '2AC', role: { en: 'Second Aff Constructive', zh: '正方二辩立论' }, defaultMs: 480_000 },
    { id: '1ar', side: 'A', name: '1AR', role: { en: 'First Aff Rebuttal', zh: '正方一驳' }, defaultMs: 300_000 },
    { id: '2ar', side: 'A', name: '2AR', role: { en: 'Second Aff Rebuttal', zh: '正方二驳' }, defaultMs: 300_000 },
    { id: '1nc', side: 'B', name: '1NC', role: { en: 'First Neg Constructive', zh: '反方一辩立论' }, defaultMs: 480_000 },
    { id: '2nc', side: 'B', name: '2NC', role: { en: 'Second Neg Constructive', zh: '反方二辩立论' }, defaultMs: 480_000 },
    { id: '1nr', side: 'B', name: '1NR', role: { en: 'First Neg Rebuttal', zh: '反方一驳' }, defaultMs: 300_000 },
    { id: '2nr', side: 'B', name: '2NR', role: { en: 'Second Neg Rebuttal', zh: '反方二驳' }, defaultMs: 300_000 },
  ],
  segments: [
    { id: 's1', kind: 'speech', speakerId: '1ac', allottedMs: null },
    cx('s2'),
    { id: 's3', kind: 'speech', speakerId: '1nc', allottedMs: null },
    cx('s4'),
    { id: 's5', kind: 'speech', speakerId: '2ac', allottedMs: null },
    cx('s6'),
    { id: 's7', kind: 'speech', speakerId: '2nc', allottedMs: null },
    cx('s8'),
    { id: 's9', kind: 'speech', speakerId: '1nr', allottedMs: null },
    { id: 's10', kind: 'speech', speakerId: '1ar', allottedMs: null },
    { id: 's11', kind: 'speech', speakerId: '2nr', allottedMs: null },
    { id: 's12', kind: 'speech', speakerId: '2ar', allottedMs: null },
  ],
  rules: rulesStd({ cues: [...CUES_SHORT] }),
};
