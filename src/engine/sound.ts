// §5.6 — synthesised bells, no audio assets, no CORS, no network.
//
// Two scheduling paths exist and they must never both sound the same cue:
//   scheduleCue(tone, inMs, key)  — pre-schedules on the AudioContext timeline (R15), so a
//                                   throttled background tab still rings on time.
//   playCue(tone, key?)           — sounds now; a key that was already scheduled or played
//                                   is skipped, so the cue evaluator can call it blindly.

import type { CueTone } from '../domain/config';
import { readPrefs, writePrefs } from './persist';

export const PRESCHEDULE_HORIZON_MS = 30_000;

export type AudioStatus = 'unsupported' | 'locked' | 'muted' | 'armed';

export interface AudioState {
  supported: boolean;
  armed: boolean;
  muted: boolean;
  volume: number;
  status: AudioStatus;
}

interface ToneSpec {
  base: number;
  level: number;
  decay: number;
  hits: number;
  gap: number;
}

// Convention (§5.6): one knock at each warning, two lower knocks at time,
// three soft knocks at the end of grace.
const TONES: Record<CueTone, ToneSpec> = {
  soft: { base: 783.99, level: 0.16, decay: 1.5, hits: 1, gap: 0 },
  single: { base: 659.25, level: 0.3, decay: 2.4, hits: 1, gap: 0 },
  double: { base: 440, level: 0.34, decay: 2.2, hits: 2, gap: 0.19 },
  triple: { base: 329.63, level: 0.2, decay: 1.9, hits: 3, gap: 0.16 },
};

// Inharmonic partials — a struck bell, not a beep. The cents offsets put the
// pairs slightly out of tune with each other so the tail beats instead of
// sitting dead still.
const PARTIALS: ReadonlyArray<{ ratio: number; amp: number; decay: number; cents: number }> = [
  { ratio: 1, amp: 1, decay: 1, cents: -4 },
  { ratio: 2.0, amp: 0.42, decay: 0.72, cents: 6 },
  { ratio: 2.76, amp: 0.24, decay: 0.5, cents: -9 },
  { ratio: 5.4, amp: 0.09, decay: 0.26, cents: 11 },
];

const FLOOR = 0.0001;
const ATTACK = 0.004;

type Ctor = new () => AudioContext;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let armed = false;
let muted = readPrefsSafe().muted;
let volume = readPrefsSafe().volume;

const scheduled = new Map<string, { nodes: OscillatorNode[]; at: number }>();
/** cue key -> wall time it rang. A key that rang moments ago cannot be re-armed,
 *  which is what stops a bell from doubling when a dispatch lands in the same frame. */
const sounded = new Map<string, number>();
const REARM_LOCKOUT_MS = 3000;
const listeners = new Set<(s: AudioState) => void>();

function readPrefsSafe(): { muted: boolean; volume: number } {
  const p = readPrefs();
  return { muted: p.muted, volume: p.volume };
}

function audioCtor(): Ctor | null {
  const w = globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function isSupported(): boolean {
  return audioCtor() !== null;
}

function targetGain(): number {
  return muted ? 0 : volume;
}

function emit(): void {
  const s = audioState();
  for (const fn of listeners) fn(s);
}

export function subscribeAudio(fn: (s: AudioState) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function audioState(): AudioState {
  const supported = isSupported();
  return {
    supported,
    armed,
    muted,
    volume,
    status: !supported ? 'unsupported' : !armed ? 'locked' : muted ? 'muted' : 'armed',
  };
}

export function audioStatus(): AudioStatus {
  return audioState().status;
}

export function isArmed(): boolean {
  return armed;
}

export function isMuted(): boolean {
  return muted;
}

export function getVolume(): number {
  return volume;
}

/** Must be called from a user gesture — browsers refuse to start an AudioContext otherwise. */
export async function armAudio(): Promise<boolean> {
  const Ctor = audioCtor();
  if (!Ctor) return false;
  if (!ctx) {
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.setValueAtTime(targetGain(), ctx.currentTime);
      master.connect(ctx.destination);
    } catch {
      ctx = null;
      master = null;
      return false;
    }
  }
  try {
    if (ctx.state !== 'running') await ctx.resume();
  } catch {
    /* resume can reject when the call did not originate in a gesture */
  }
  // An inaudible one-frame source is what actually unlocks iOS Safari.
  try {
    const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch {
    /* not fatal */
  }
  const next = ctx.state === 'running';
  if (next !== armed) {
    armed = next;
    emit();
  }
  return armed;
}

export function setMuted(next: boolean): void {
  if (muted === next) return;
  muted = next;
  writePrefs({ muted: next });
  applyMasterGain();
  emit();
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

export function setVolume(next: number): void {
  const v = Number.isFinite(next) ? Math.min(1, Math.max(0, next)) : volume;
  if (v === volume) return;
  volume = v;
  writePrefs({ volume: v });
  applyMasterGain();
  emit();
}

function applyMasterGain(): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  master.gain.cancelScheduledValues(t);
  master.gain.setValueAtTime(master.gain.value, t);
  master.gain.linearRampToValueAtTime(targetGain(), t + 0.03);
}

// ------------------------------------------------------------------ synthesis

function strike(when: number, spec: ToneSpec): OscillatorNode[] {
  const c = ctx;
  const out = master;
  if (!c || !out) return [];
  const nodes: OscillatorNode[] = [];
  for (const p of PARTIALS) {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(spec.base * p.ratio, when);
    osc.detune.setValueAtTime(p.cents, when);

    const g = c.createGain();
    const peak = Math.max(FLOOR * 2, spec.level * p.amp);
    const tail = spec.decay * p.decay;
    g.gain.setValueAtTime(FLOOR, when);
    g.gain.exponentialRampToValueAtTime(peak, when + ATTACK);
    g.gain.exponentialRampToValueAtTime(FLOOR, when + ATTACK + tail);

    osc.connect(g);
    g.connect(out);
    osc.start(when);
    osc.stop(when + ATTACK + tail + 0.05);
    nodes.push(osc);
  }
  return nodes;
}

function ring(tone: CueTone, when: number): OscillatorNode[] {
  const spec = TONES[tone];
  const nodes: OscillatorNode[] = [];
  for (let i = 0; i < spec.hits; i++) {
    // Later knocks sit a touch quieter so the group reads as one gesture.
    const hit: ToneSpec = { ...spec, level: spec.level * (i === 0 ? 1 : 0.86) };
    nodes.push(...strike(when + i * spec.gap, hit));
  }
  return nodes;
}

// ------------------------------------------------------------------ scheduling

/** Pre-schedule `tone` to sound `inMs` from now. Idempotent per `key`. */
export function scheduleCue(tone: CueTone, inMs: number, key: string): void {
  if (!ctx || !master || !armed || muted) return;
  if (sounded.has(key) || scheduled.has(key)) return;
  if (!Number.isFinite(inMs) || inMs < 0 || inMs > PRESCHEDULE_HORIZON_MS) return;
  const at = ctx.currentTime + inMs / 1000;
  const nodes = ring(tone, at);
  if (nodes.length === 0) return;
  scheduled.set(key, { nodes, at });
}

/** Sound `tone` immediately. With a `key`, a cue already scheduled or already
 *  sounded is skipped — the pre-scheduled bell has it. */
export function playCue(tone: CueTone, key?: string): void {
  if (key !== undefined) {
    if (sounded.has(key)) return;
    const pending = scheduled.get(key);
    if (pending) {
      // Already on the audio timeline. Mark it spent so a later cancel-all
      // does not stop a bell that is mid-ring.
      sounded.set(key, Date.now());
      scheduled.delete(key);
      return;
    }
    sounded.set(key, Date.now());
  }
  if (!ctx || !master || !armed || muted) return;
  ring(tone, ctx.currentTime + 0.01);
}

export function hasScheduled(key: string): boolean {
  return scheduled.has(key);
}

/** Cancel one key, or every pending cue. Bells already ringing are left alone —
 *  stopping a source mid-decay is an audible click in a silent room. */
export function cancelScheduled(key?: string): void {
  if (key !== undefined) {
    stopEntry(key);
    return;
  }
  for (const k of [...scheduled.keys()]) stopEntry(k);
}

function stopEntry(key: string): void {
  const entry = scheduled.get(key);
  if (!entry) return;
  scheduled.delete(key);
  const nowT = ctx ? ctx.currentTime : 0;
  if (entry.at <= nowT + 0.005) {
    sounded.set(key, Date.now());
    return;
  }
  for (const osc of entry.nodes) {
    try {
      osc.stop();
      osc.disconnect();
    } catch {
      /* already stopped */
    }
  }
}

/** Forget which cue keys have sounded — used when a rewind re-arms the ladder
 *  (`RESET_SEGMENT`, `PREV`, `ADJUST`) or a new round is loaded. */
export function forgetCue(keyOrPrefix: string, prefix = false): void {
  const cutoff = Date.now() - REARM_LOCKOUT_MS;
  const unsound = (k: string): void => {
    const at = sounded.get(k);
    if (at !== undefined && at > cutoff) return;
    sounded.delete(k);
  };
  if (!prefix) {
    cancelScheduled(keyOrPrefix);
    unsound(keyOrPrefix);
    return;
  }
  for (const k of [...scheduled.keys()]) if (k.startsWith(keyOrPrefix)) stopEntry(k);
  for (const k of [...sounded.keys()]) if (k.startsWith(keyOrPrefix)) unsound(k);
}

export function resetCueAudio(): void {
  cancelScheduled();
  sounded.clear();
}

/** Test/teardown hook. */
export function closeAudio(): void {
  resetCueAudio();
  const c = ctx;
  ctx = null;
  master = null;
  armed = false;
  if (c) void c.close().catch(() => undefined);
  emit();
}
