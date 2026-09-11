/**
 * The serialized round. This is exactly what a share URL and a `.debate.json` file contain.
 * Nothing here depends on React, the DOM, or the engine.
 */

export const SCHEMA_VERSION = 3 as const;

export type Lang = 'en' | 'zh';
export type SideId = 'A' | 'B';

/** 8 chars, [0-9a-z]. See `domain/id.ts`. */
export type Id = string;

/** Every operator-visible label in the data carries both languages. */
export interface L10n {
  en: string;
  zh: string;
}
/** Alias kept because both names appear across the spec. */
export type L10nText = L10n;

/** '#RRGGBB', uppercase or lowercase; validated in `lib/contrast.ts`. */
export type Hex = string;

export type CueTone = 'soft' | 'single' | 'double' | 'triple';

export interface CueSpec {
  /** Remaining-time threshold in ms. `0` is expiry. */
  atMs: number;
  tone: CueTone;
  /** Optional caption, e.g. { en: 'POIs open', zh: '可提问' }. */
  label?: L10n;
}

export interface SpeakerCfg {
  id: Id;
  side: SideId;
  /** Typed by the operator; rendered as typed in both languages. */
  name: string;
  role?: L10n;
  /** This speaker's usual allotment; a speech segment may override it. */
  defaultMs: number;
}
export type Speaker = SpeakerCfg;

export interface SideCfg {
  id: SideId;
  label: L10n;
  color: Hex;
  /** 0 means this side has no prep bank. Banks are drawn at will (Q/W), never scheduled. */
  prepBankMs: number;
}

export type SegmentKind = 'speech' | 'shared' | 'prep' | 'chess' | 'break';

interface SegmentBase {
  id: Id;
  /** undefined === fall back to `rules.cues`. */
  cues?: CueSpec[];
}

/** One person holds the floor for the whole segment. */
export interface SpeechSegment extends SegmentBase {
  kind: 'speech';
  speakerId: Id;
  label?: L10n;
  /** null === inherit the speaker's defaultMs. */
  allottedMs: number | null;
  /** Symmetric protected window at each end; adds two cues at edit time. */
  protectedMs?: number;
}

/** One clock, several named participants (cross-ex, crossfire, grand crossfire). */
export interface SharedSegment extends SegmentBase {
  kind: 'shared';
  label: L10n;
  allottedMs: number;
  /** Which floor bars light. */
  live: SideId[];
  speakerIds?: Id[];
}

/** A scheduled prep block in the run order — distinct from the drawable prep bank. */
export interface PrepSegment extends SegmentBase {
  kind: 'prep';
  label: L10n;
  side: SideId | 'both';
  allottedMs: number;
}

/** Free debate / 自由辩论: two independent banks, one floor, handoff by Space. */
export interface ChessSegment extends SegmentBase {
  kind: 'chess';
  label: L10n;
  /** EACH side receives this in full. Not a shared pool. */
  perSideMs: number;
  /** 'operator' means nobody starts until ←/→ picks a side. */
  firstFloor: SideId | 'operator';
}

export interface BreakSegment extends SegmentBase {
  kind: 'break';
  label: L10n;
  allottedMs: number;
}

export type Segment =
  | SpeechSegment
  | SharedSegment
  | PrepSegment
  | ChessSegment
  | BreakSegment;

export type TimeDisplay = 'mm:ss' | 'seconds';

export interface Rules {
  /** Default cue ladder for any segment that does not carry its own. */
  cues: CueSpec[];
  /** A soft triple fires once at +grace past expiry. */
  graceMs: number;
  display: TimeDisplay;
  lang: Lang;
  sound: boolean;
  /** Stop escalating cues past this much overtime; the number keeps counting. */
  overtimeCapMs: number;
  /**
   * `false` (default): ADVANCE arms the next segment showing its full time, transport
   * paused; Space starts it. `true`: ADVANCE also starts the clock (the Unity behaviour).
   * A first-class operator preference, not a compatibility shim.
   */
  advanceStartsClock?: boolean;
  /**
   * `true` (default): the two free-debate side clocks are mutually exclusive.
   * `false`: both may run at once; SWAP still hands the floor over.
   */
  freeDebateExclusive?: boolean;
}

export interface RoundConfig {
  v: typeof SCHEMA_VERSION;
  id: Id;
  /** The motion / topic. */
  title: L10n;
  /** Index 0 is always side 'A'. */
  sides: [SideCfg, SideCfg];
  speakers: SpeakerCfg[];
  /**
   * The run order, verbatim as the operator arranged it. Any speaker may appear any
   * number of times or not at all; prep/chess/break blocks may sit anywhere. Nothing
   * in this app reorders, dedupes or completes this array.
   */
  segments: Segment[];
  rules: Rules;
  /** Provenance only — applying a preset never locks anything. */
  presetRef?: string;
}

/** Okabe–Ito amber / azure: DL 0.264, both >= 3:1 on black. */
export const DEFAULT_COLOR_A: Hex = '#E69F00';
export const DEFAULT_COLOR_B: Hex = '#0072B2';

export function defaultRules(): Rules {
  return {
    cues: [
      { atMs: 60_000, tone: 'soft' },
      { atMs: 30_000, tone: 'soft' },
      { atMs: 0, tone: 'double' },
    ],
    graceMs: 15_000,
    display: 'mm:ss',
    lang: 'en',
    sound: true,
    overtimeCapMs: 300_000,
    advanceStartsClock: false,
    freeDebateExclusive: true,
  };
}

export function defaultSides(): [SideCfg, SideCfg] {
  return [
    { id: 'A', label: { en: 'Proposition', zh: '正方' }, color: DEFAULT_COLOR_A, prepBankMs: 0 },
    { id: 'B', label: { en: 'Opposition', zh: '反方' }, color: DEFAULT_COLOR_B, prepBankMs: 0 },
  ];
}

export function sideOf(config: RoundConfig, side: SideId): SideCfg {
  return side === 'A' ? config.sides[0] : config.sides[1];
}

export function speakerById(config: RoundConfig, id: Id): SpeakerCfg | undefined {
  return config.speakers.find((s) => s.id === id);
}

export function isSpeech(seg: Segment): seg is SpeechSegment {
  return seg.kind === 'speech';
}
export function isChess(seg: Segment): seg is ChessSegment {
  return seg.kind === 'chess';
}
export function isShared(seg: Segment): seg is SharedSegment {
  return seg.kind === 'shared';
}

/** The cue ladder a segment actually runs: its own, or the round default. */
export function cuesFor(seg: Segment, rules: Rules): CueSpec[] {
  return seg.cues ?? rules.cues;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    // Sorted keys, undefined dropped: two configs that differ only in key order must
    // hash identically, or configHash and the URL self-write guard both misfire.
    for (const key of Object.keys(src).sort()) {
      const v = canonicalize(src[key]);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  return value;
}

/** Key-order-stable, whitespace-free JSON. The input to configHash and the URL codec. */
export function canonicalJson(config: unknown): string {
  return JSON.stringify(canonicalize(config)) ?? 'null';
}
