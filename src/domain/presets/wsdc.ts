import type { RoundConfig, Segment, SpeechSegment } from '../config';
import { SCHEMA_VERSION } from '../config';
import { COLOR_A, COLOR_B, CUES_SHORT, protectedCues, rulesStd, side } from './common';

const SUBSTANTIVE_MS = 480_000;
const REPLY_MS = 240_000;
const PROTECTED_MS = 60_000;

const substantive: SpeechSegment[] = (['p1', 'o1', 'p2', 'o2', 'p3', 'o3'] as const).map(
  (speakerId, i) => ({
    id: `s${i + 1}`,
    kind: 'speech',
    speakerId,
    allottedMs: null,
    protectedMs: PROTECTED_MS,
    cues: protectedCues(SUBSTANTIVE_MS, PROTECTED_MS),
  }),
);

// Reply speeches are protected throughout, so they carry the plain short ladder.
const replies: Segment[] = [
  { id: 's7', kind: 'speech', speakerId: 'or', allottedMs: null, cues: [...CUES_SHORT] },
  { id: 's8', kind: 'speech', speakerId: 'pr', allottedMs: null, cues: [...CUES_SHORT] },
];

export const wsdc: RoundConfig = {
  v: SCHEMA_VERSION,
  id: 'wsdc',
  presetRef: 'wsdc',
  title: { en: 'World Schools', zh: '世界学校辩论' },
  sides: [side('A', 'Proposition', '正方', COLOR_A), side('B', 'Opposition', '反方', COLOR_B)],
  speakers: [
    { id: 'p1', side: 'A', name: 'Prop 1', defaultMs: SUBSTANTIVE_MS },
    { id: 'p2', side: 'A', name: 'Prop 2', defaultMs: SUBSTANTIVE_MS },
    { id: 'p3', side: 'A', name: 'Prop 3', defaultMs: SUBSTANTIVE_MS },
    {
      id: 'pr',
      side: 'A',
      name: 'Prop Reply',
      role: { en: 'Reply (1st or 2nd speaker)', zh: '总结(一辩或二辩)' },
      defaultMs: REPLY_MS,
    },
    { id: 'o1', side: 'B', name: 'Opp 1', defaultMs: SUBSTANTIVE_MS },
    { id: 'o2', side: 'B', name: 'Opp 2', defaultMs: SUBSTANTIVE_MS },
    { id: 'o3', side: 'B', name: 'Opp 3', defaultMs: SUBSTANTIVE_MS },
    {
      id: 'or',
      side: 'B',
      name: 'Opp Reply',
      role: { en: 'Reply (1st or 2nd speaker)', zh: '总结(一辩或二辩)' },
      defaultMs: REPLY_MS,
    },
  ],
  segments: [...substantive, ...replies],
  rules: rulesStd(),
};
