import type { RoundConfig, SpeechSegment } from '../config';
import { SCHEMA_VERSION } from '../config';
import { COLOR_A, COLOR_B, protectedCues, rulesStd, side } from './common';

const SPEECH_MS = 420_000;
const PROTECTED_MS = 60_000;

/**
 * Eight seven-minute speeches alternating Gov/Opp. Protected time is first-class:
 * one knock at 1:00 elapsed when POIs open, one at 6:00 when they close, two at
 * time. A single global warning threshold cannot express that at all.
 */
const order = ['g1', 'o1', 'g2', 'o2', 'g3', 'o3', 'g4', 'o4'] as const;

const segments: SpeechSegment[] = order.map((speakerId, i) => ({
  id: `s${i + 1}`,
  kind: 'speech',
  speakerId,
  allottedMs: null,
  protectedMs: PROTECTED_MS,
  cues: protectedCues(SPEECH_MS, PROTECTED_MS),
}));

export const bp: RoundConfig = {
  v: SCHEMA_VERSION,
  id: 'bp',
  presetRef: 'bp',
  title: { en: 'British Parliamentary', zh: '英国议会制' },
  sides: [
    side('A', 'Government', '正方(政府)', COLOR_A),
    side('B', 'Opposition', '反方(反对党)', COLOR_B),
  ],
  speakers: [
    { id: 'g1', side: 'A', name: 'PM', role: { en: 'Prime Minister (OG)', zh: '首相' }, defaultMs: SPEECH_MS },
    { id: 'g2', side: 'A', name: 'DPM', role: { en: 'Deputy PM (OG)', zh: '副首相' }, defaultMs: SPEECH_MS },
    { id: 'g3', side: 'A', name: 'MG', role: { en: 'Member for Gov (CG)', zh: '政府议员' }, defaultMs: SPEECH_MS },
    { id: 'g4', side: 'A', name: 'GW', role: { en: 'Government Whip (CG)', zh: '政府党鞭' }, defaultMs: SPEECH_MS },
    { id: 'o1', side: 'B', name: 'LO', role: { en: 'Leader of Opposition (OO)', zh: '反对党领袖' }, defaultMs: SPEECH_MS },
    { id: 'o2', side: 'B', name: 'DLO', role: { en: 'Deputy LO (OO)', zh: '副领袖' }, defaultMs: SPEECH_MS },
    { id: 'o3', side: 'B', name: 'MO', role: { en: 'Member for Opp (CO)', zh: '反对党议员' }, defaultMs: SPEECH_MS },
    { id: 'o4', side: 'B', name: 'OW', role: { en: 'Opposition Whip (CO)', zh: '反对党党鞭' }, defaultMs: SPEECH_MS },
  ],
  segments,
  rules: rulesStd({ graceMs: 15_000 }),
};
