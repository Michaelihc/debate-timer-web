import type { RoundConfig } from '../config';
import { SCHEMA_VERSION } from '../config';
import { COLOR_A, COLOR_B, rulesStd, side } from './common';

/** Two named sides, nothing else. The composer fills the rest. */
export const blank: RoundConfig = {
  v: SCHEMA_VERSION,
  id: 'blank',
  presetRef: 'blank',
  title: { en: 'New Round', zh: '新的比赛' },
  sides: [side('A', 'Side A', '正方', COLOR_A), side('B', 'Side B', '反方', COLOR_B)],
  speakers: [],
  segments: [],
  rules: rulesStd(),
};
