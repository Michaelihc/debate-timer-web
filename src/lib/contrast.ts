/**
 * Colour maths for the side-identity picker and the validator: WCAG relative
 * luminance, contrast ratio, dichromatic simulation, CIEDE2000, and the R10 gate.
 *
 * The original app fell back to undefined magenta on an unparseable hex with no
 * feedback at all; every entry point here either parses or reports that it did not.
 */

import type { Hex, L10n } from '../domain/config';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}
export interface Lab {
  l: number;
  a: number;
  b: number;
}

/** R10: block below this luminance separation, warn below `DELTA_L_WARN`. */
export const DELTA_L_BLOCK = 0.1;
export const DELTA_L_WARN = 0.18;
/** Simulated dichromatic separation below this reads as one colour to a dichromat. */
export const CVD_DELTA_E_BLOCK = 12;
/** A side colour dimmer than this against the stage black is illegible at range. */
export const MIN_CONTRAST_ON_BLACK = 3;
/** Hue of `--state-warn`; identity colours inside this arc get confused with it. */
export const WARN_HUE = 43;
export const NEAR_WARN_HUE_DEG = 20;

export const DARK_INK: Hex = '#08080A';
export const STAGE_INK: Hex = '#F5F3EC';
/** Slabs at or above this luminance take dark ink. */
export const INK_FLIP_LUMINANCE = 0.32;

const HEX_RE = /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `null` for anything that is not `#RGB` / `#RRGGBB`. This is the only validator. */
export function parseHex(hex: string): Rgb | null {
  const text = hex.trim();
  if (!HEX_RE.test(text)) return null;
  const body = text.startsWith('#') ? text.slice(1) : text;
  const full =
    body.length === 3
      ? `${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`
      : body;
  const n = Number.parseInt(full, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

export function isHex(hex: string): boolean {
  return parseHex(hex) !== null;
}

function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 255 ? 255 : Math.round(n);
}

export function toHex(rgb: Rgb): Hex {
  const part = (n: number) => clampByte(n).toString(16).padStart(2, '0');
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`.toUpperCase();
}

export type Color = Hex | Rgb;

/** An unparseable hex degrades to black rather than throwing mid-render. */
function asRgb(color: Color): Rgb {
  if (typeof color === 'string') return parseHex(color) ?? { r: 0, g: 0, b: 0 };
  return color;
}

function srgbToLinear(channel8: number): number {
  const c = clampByte(channel8) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(linear: number): number {
  const c = linear <= 0 ? 0 : linear >= 1 ? 1 : linear;
  const encoded = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return encoded * 255;
}

/** WCAG 2.x relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(color: Color): number {
  const { r, g, b } = asRgb(color);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(a: Color, b: Color): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** The figure that matters for the stage, whose ground is always true black. */
export function contrastOnBlack(color: Color): number {
  return (relativeLuminance(color) + 0.05) / 0.05;
}

/** The R10 gate axis: absolute difference in relative luminance. */
export function deltaL(a: Color, b: Color): number {
  return Math.abs(relativeLuminance(a) - relativeLuminance(b));
}

/** Text colour for a slab filled with `color`. Amber gets dark ink, azure light. */
export function autoInk(color: Color): Hex {
  return relativeLuminance(color) >= INK_FLIP_LUMINANCE ? DARK_INK : STAGE_INK;
}

// Dichromacy simulation (Vienot / Brettel / Mollon 1999, applied in linear light).

export type CvdType = 'deuteranopia' | 'protanopia' | 'tritanopia';

function rgbToLms(rgb: Rgb): [number, number, number] {
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  return [
    17.8824 * r + 43.5161 * g + 4.11935 * b,
    3.45565 * r + 27.1554 * g + 3.86714 * b,
    0.0299566 * r + 0.184309 * g + 1.46709 * b,
  ];
}

function lmsToRgb(lms: [number, number, number]): Rgb {
  const [l, m, s] = lms;
  return {
    r: clampByte(linearToSrgb(0.080944448 * l - 0.13050441 * m + 0.116721066 * s)),
    g: clampByte(linearToSrgb(-0.0102485335 * l + 0.0540193266 * m - 0.113614708 * s)),
    b: clampByte(linearToSrgb(-0.000365296938 * l - 0.00412161469 * m + 0.693511405 * s)),
  };
}

export function simulateCvd(color: Color, type: CvdType): Rgb {
  const [l, m, s] = rgbToLms(asRgb(color));
  switch (type) {
    case 'protanopia':
      return lmsToRgb([2.02344 * m - 2.52581 * s, m, s]);
    case 'deuteranopia':
      return lmsToRgb([l, 0.494207 * l + 1.24827 * s, s]);
    case 'tritanopia':
      return lmsToRgb([l, m, -0.395913 * l + 0.801109 * m]);
  }
}

// CIELAB / CIEDE2000.

const D65_X = 95.047;
const D65_Y = 100;
const D65_Z = 108.883;

export function rgbToLab(color: Color): Lab {
  const rgb = asRgb(color);
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) * 100;
  const y = (0.2126729 * r + 0.7151522 * g + 0.072175 * b) * 100;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) * 100;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const fx = f(x / D65_X);
  const fy = f(y / D65_Y);
  const fz = f(z / D65_Z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

const RAD = Math.PI / 180;
const POW25_7 = 25 ** 7;

/** CIEDE2000 perceptual distance. About 2.3 is a just-noticeable difference. */
export function deltaE2000(colorA: Color, colorB: Color): number {
  const p = rgbToLab(colorA);
  const q = rgbToLab(colorB);

  const c1 = Math.hypot(p.a, p.b);
  const c2 = Math.hypot(q.a, q.b);
  const cBar = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + POW25_7)));

  const a1 = (1 + g) * p.a;
  const a2 = (1 + g) * q.a;
  const c1p = Math.hypot(a1, p.b);
  const c2p = Math.hypot(a2, q.b);

  const hp = (b: number, a: number): number => {
    if (a === 0 && b === 0) return 0;
    const deg = Math.atan2(b, a) / RAD;
    return deg < 0 ? deg + 360 : deg;
  };
  const h1p = hp(p.b, a1);
  const h2p = hp(q.b, a2);

  const dLp = q.l - p.l;
  const dCp = c2p - c1p;

  let dhp = 0;
  if (c1p * c2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((dhp / 2) * RAD);

  const lBarp = (p.l + q.l) / 2;
  const cBarp = (c1p + c2p) / 2;

  let hBarp: number;
  if (c1p * c2p === 0) hBarp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hBarp = (h1p + h2p) / 2;
  else hBarp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;

  const t =
    1 -
    0.17 * Math.cos((hBarp - 30) * RAD) +
    0.24 * Math.cos(2 * hBarp * RAD) +
    0.32 * Math.cos((3 * hBarp + 6) * RAD) -
    0.2 * Math.cos((4 * hBarp - 63) * RAD);

  const dTheta = 30 * Math.exp(-(((hBarp - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(cBarp ** 7 / (cBarp ** 7 + POW25_7));
  const sl = 1 + (0.015 * (lBarp - 50) ** 2) / Math.sqrt(20 + (lBarp - 50) ** 2);
  const sc = 1 + 0.045 * cBarp;
  const sh = 1 + 0.015 * cBarp * t;
  const rt = -Math.sin(2 * dTheta * RAD) * rc;

  const kl = dLp / sl;
  const kc = dCp / sc;
  const kh = dHp / sh;
  return Math.sqrt(kl * kl + kc * kc + kh * kh + rt * kc * kh);
}

/** HSL hue in degrees, 0 to 360. Grey returns 0. */
export function hue(color: Color): number {
  const { r, g, b } = asRgb(color);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** Shortest angular distance between two hues, 0 to 180. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

export type PairVerdict = 'ok' | 'warn' | 'block';

export type PairReason =
  | 'UNPARSEABLE_A'
  | 'UNPARSEABLE_B'
  | 'DELTA_L_BLOCK'
  | 'DELTA_L_WARN'
  | 'CVD_DEUTERANOPIA'
  | 'CVD_PROTANOPIA'
  | 'CONTRAST_A'
  | 'CONTRAST_B'
  | 'NEAR_WARN_HUE_A'
  | 'NEAR_WARN_HUE_B';

export interface PairCheck {
  verdict: PairVerdict;
  deltaL: number;
  /** Simulated CIEDE2000 separation under each dichromacy. */
  deltaE: Record<'deuteranopia' | 'protanopia', number>;
  contrastA: number;
  contrastB: number;
  /** Every finding, blocking first, then warnings, then notes. */
  reasons: PairReason[];
}

/**
 * The whole picker verdict in one call. A failing pair is always reported with its
 * reason; nothing here silently substitutes a safe colour.
 */
export function checkPair(a: Hex, b: Hex): PairCheck {
  const rgbA = parseHex(a);
  const rgbB = parseHex(b);
  const blocking: PairReason[] = [];
  const warning: PairReason[] = [];
  const notes: PairReason[] = [];

  if (!rgbA) blocking.push('UNPARSEABLE_A');
  if (!rgbB) blocking.push('UNPARSEABLE_B');

  const ca = rgbA ?? { r: 0, g: 0, b: 0 };
  const cb = rgbB ?? { r: 0, g: 0, b: 0 };

  const dl = deltaL(ca, cb);
  const deltaE = {
    deuteranopia: deltaE2000(simulateCvd(ca, 'deuteranopia'), simulateCvd(cb, 'deuteranopia')),
    protanopia: deltaE2000(simulateCvd(ca, 'protanopia'), simulateCvd(cb, 'protanopia')),
  };
  const contrastA = contrastOnBlack(ca);
  const contrastB = contrastOnBlack(cb);

  if (dl < DELTA_L_BLOCK) blocking.push('DELTA_L_BLOCK');
  else if (dl < DELTA_L_WARN) warning.push('DELTA_L_WARN');

  if (deltaE.deuteranopia < CVD_DELTA_E_BLOCK) blocking.push('CVD_DEUTERANOPIA');
  if (deltaE.protanopia < CVD_DELTA_E_BLOCK) blocking.push('CVD_PROTANOPIA');

  if (contrastA < MIN_CONTRAST_ON_BLACK) warning.push('CONTRAST_A');
  if (contrastB < MIN_CONTRAST_ON_BLACK) warning.push('CONTRAST_B');

  // Reported, never a verdict: the canonical Okabe-Ito amber sits 1.5 degrees off
  // the warning hue, so gating on this would fail the app's own default pair. The
  // periphery/core rule already keeps identity and state colour off the same
  // element, which is what actually prevents the confusion.
  if (rgbA && hueDistance(hue(ca), WARN_HUE) < NEAR_WARN_HUE_DEG) notes.push('NEAR_WARN_HUE_A');
  if (rgbB && hueDistance(hue(cb), WARN_HUE) < NEAR_WARN_HUE_DEG) notes.push('NEAR_WARN_HUE_B');

  const reasons = [...blocking, ...warning, ...notes];
  const verdict: PairVerdict = blocking.length > 0 ? 'block' : warning.length > 0 ? 'warn' : 'ok';
  return { verdict, deltaL: dl, deltaE, contrastA, contrastB, reasons };
}

export interface VettedPair {
  a: Hex;
  b: Hex;
  labelA: L10n;
  labelB: L10n;
}

/**
 * The shipped duos, default first, then the original's own pair.
 *
 * The first six are the colour-vision-safe set. The last is `#0000FF` / `#FF0000` — what
 * the Unity app shipped and what every legacy `save.json` carries, so it has to be
 * reachable by name rather than only by typing hex. It is offered, not endorsed: the
 * picker measures whatever is selected and names the reason a pair falls short. Blue on
 * black is a low-contrast figure and the readout says so; it is still applied, because a
 * round imported from the original must be able to look like the original.
 */
export const VETTED_PAIRS: readonly VettedPair[] = [
  { a: '#E69F00', b: '#0072B2', labelA: { en: 'Amber', zh: '琥珀' }, labelB: { en: 'Azure', zh: '天青' } },
  { a: '#F0E442', b: '#0072B2', labelA: { en: 'Yellow', zh: '明黄' }, labelB: { en: 'Azure', zh: '天青' } },
  { a: '#56B4E9', b: '#D55E00', labelA: { en: 'Sky', zh: '晴空' }, labelB: { en: 'Vermilion', zh: '朱红' } },
  { a: '#F0E442', b: '#009E73', labelA: { en: 'Yellow', zh: '明黄' }, labelB: { en: 'Teal', zh: '青碧' } },
  { a: '#F0E442', b: '#CC79A7', labelA: { en: 'Yellow', zh: '明黄' }, labelB: { en: 'Orchid', zh: '藕荷' } },
  // Slate is lightened from the spec's #3C5A73, which lands at 2.90:1 on black and
  // so trips this file's own 3:1 warning. A shipped swatch must clear its own gate.
  { a: '#EDE7D3', b: '#43627C', labelA: { en: 'Ivory', zh: '象牙' }, labelB: { en: 'Slate', zh: '石青' } },
  { a: '#0000FF', b: '#FF0000', labelA: { en: 'Classic Blue', zh: '经典蓝' }, labelB: { en: 'Classic Red', zh: '经典红' } },
];
