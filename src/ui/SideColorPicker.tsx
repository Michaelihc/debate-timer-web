/**
 * The side-identity colour control.
 *
 * Six vetted duos first, then a hex field per side. Everything below the swatches is
 * measured, not asserted: the live ΔL figure, both contrast ratios on black, and a
 * deuteranopia / protanopia simulation strip of the actual pair.
 *
 * A failing pair is FLAGGED WITH ITS REASON and still applied — the operator may have a
 * school colour they are required to use, and silently substituting a "safe" colour is
 * how the original lost people's branding. What this control will not do is let a
 * failure pass unremarked.
 *
 * Identity colour is periphery: these swatches are frames and slabs, never a clock core.
 */

import type { ChangeEvent, JSX } from 'react';
import { useId } from 'react';
import type { Hex, SideId } from '../domain/config';
import type { PairReason } from '../lib/contrast';
import {
  DELTA_L_WARN,
  MIN_CONTRAST_ON_BLACK,
  VETTED_PAIRS,
  autoInk,
  checkPair,
  isHex,
  simulateCvd,
  toHex,
} from '../lib/contrast';
import { useLang } from '../i18n/useLang';
import { Icon } from './Icons';

import '../screens/editor.css';

export interface SideColorPickerProps {
  colorA: Hex;
  colorB: Hex;
  labelA: string;
  labelB: string;
  onChange: (colorA: Hex, colorB: Hex) => void;
}

/** Every reason `checkPair` can return, in the operator's words. */
const REASON_KEY = {
  UNPARSEABLE_A: 'v.colorUnreadable',
  UNPARSEABLE_B: 'v.colorUnreadable',
  DELTA_L_BLOCK: 'v.colorTooClose',
  DELTA_L_WARN: 'v.colorTooClose',
  CVD_DEUTERANOPIA: 'v.colorCvd',
  CVD_PROTANOPIA: 'v.colorCvd',
  CONTRAST_A: 'v.colorLowContrast',
  CONTRAST_B: 'v.colorLowContrast',
} as const;

type ReportedReason = keyof typeof REASON_KEY;

function isReported(reason: PairReason): reason is ReportedReason {
  return reason in REASON_KEY;
}

function round2(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

export function SideColorPicker({
  colorA,
  colorB,
  labelA,
  labelB,
  onChange,
}: SideColorPickerProps): JSX.Element {
  const { t, l10n } = useLang();
  const uid = useId();
  const check = checkPair(colorA, colorB);

  // De-duplicated: DELTA_L_BLOCK and DELTA_L_WARN say the same sentence, and both
  // dichromacies collapse to one line about red-green vision.
  const messages: string[] = [];
  for (const reason of check.reasons) {
    if (!isReported(reason)) continue;
    const text = t(REASON_KEY[reason]);
    if (!messages.includes(text)) messages.push(text);
  }

  function setHex(side: SideId, raw: string): void {
    const value = raw.startsWith('#') ? raw : `#${raw}`;
    if (!isHex(value)) return; // an unreadable entry never becomes the colour
    if (side === 'A') onChange(value, colorB);
    else onChange(colorA, value);
  }

  return (
    <div className="scp">
      <ul className="scp__pairs" aria-label={t('ed.color')}>
        {VETTED_PAIRS.map((pair) => {
          const active = pair.a.toLowerCase() === colorA.toLowerCase() && pair.b.toLowerCase() === colorB.toLowerCase();
          const name = `${l10n(pair.labelA)} / ${l10n(pair.labelB)}`;
          return (
            <li key={`${pair.a}${pair.b}`}>
              <button
                type="button"
                className="scp__pair"
                aria-pressed={active}
                title={name}
                onClick={() => onChange(pair.a, pair.b)}
              >
                <span className="scp__duo" aria-hidden="true">
                  <span style={{ background: pair.a }} />
                  <span style={{ background: pair.b }} />
                </span>
                <span className="scp__pair-name t-cap">{name}</span>
                {active ? <Icon name="check" className="scp__tick" title={t('ed.color')} /> : null}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="scp__hexes">
        <HexField id={`${uid}-a`} label={labelA} value={colorA} onCommit={(v) => setHex('A', v)} />
        <HexField id={`${uid}-b`} label={labelB} value={colorB} onCommit={(v) => setHex('B', v)} />
      </div>

      {messages.length === 0 ? (
        <p className="scp__verdict t-meta" data-verdict="ok">
          <Icon name="check" /> {t('ed.pairOk')}
        </p>
      ) : (
        <ul className="scp__verdict t-meta" data-verdict={check.verdict}>
          {messages.map((message) => (
            <li key={message}>
              <Icon name="alert" /> {message}
            </li>
          ))}
        </ul>
      )}

      {/* The verdict above is the answer; the measurements behind it stay one click away. */}
      <details className="scp__more">
        <summary className="scp__summary t-meta">{t('ed.contrastFigures')}</summary>
        <ul className="scp__figures t-meta">
          <li data-flag={check.deltaL < DELTA_L_WARN ? 'warn' : undefined}>
            {t('ed.lightnessGap', { v: round2(check.deltaL) })}
          </li>
          <li data-flag={check.contrastA < MIN_CONTRAST_ON_BLACK ? 'warn' : undefined}>
            {labelA} · {t('ed.onBlack', { v: round2(check.contrastA) })}
          </li>
          <li data-flag={check.contrastB < MIN_CONTRAST_ON_BLACK ? 'warn' : undefined}>
            {labelB} · {t('ed.onBlack', { v: round2(check.contrastB) })}
          </li>
        </ul>

        <div className="scp__cvd">
          <p className="t-cap scp__cvd-head">{t('ed.cvd')}</p>
          <CvdRow label={t('ed.deuteranopia')} a={colorA} b={colorB} type="deuteranopia" />
          <CvdRow label={t('ed.protanopia')} a={colorA} b={colorB} type="protanopia" />
        </div>
      </details>
    </div>
  );
}

function HexField({
  id,
  label,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  value: Hex;
  onCommit: (value: string) => void;
}): JSX.Element {
  const { t } = useLang();
  return (
    <p className="scp__hex">
      <label className="t-cap" htmlFor={id}>
        {label} · {t('ed.customColor')}
      </label>
      <span className="scp__hex-row">
        <span className="scp__chip" style={{ background: value, color: autoInk(value) }} aria-hidden="true">
          Aa
        </span>
        <input
          id={id}
          type="text"
          className="scp__hex-input"
          value={value}
          spellCheck={false}
          autoComplete="off"
          inputMode="text"
          maxLength={7}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onCommit(e.target.value)}
        />
      </span>
    </p>
  );
}

function CvdRow({
  label,
  a,
  b,
  type,
}: {
  label: string;
  a: Hex;
  b: Hex;
  type: 'deuteranopia' | 'protanopia';
}): JSX.Element {
  const simA = toHex(simulateCvd(a, type));
  const simB = toHex(simulateCvd(b, type));
  return (
    <p className="scp__cvd-row">
      <span className="t-cap scp__cvd-label">{label}</span>
      <span className="scp__cvd-strip" role="img" aria-label={`${label}: ${simA} / ${simB}`}>
        <span style={{ background: simA }} />
        <span style={{ background: simB }} />
      </span>
    </p>
  );
}
