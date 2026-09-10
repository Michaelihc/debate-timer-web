/**
 * The validation strip: always visible, never blocking.
 *
 * It reports EXACTLY what `domain/validate.ts` returns, in that module's own words, and
 * nothing else. There is no notice here for a repeated speaker, an omitted speaker or an
 * order that runs 3 before 2 — those are not problems, they are the run sheet the
 * operator built, and no code in this file has an opinion about them.
 *
 * Errors are the only severity that can stop APPLY. Warnings and facts sit next to the
 * ready line without gating anything.
 */

import type { JSX } from 'react';
import type { SideId } from '../domain/config';
import type { Problem } from '../domain/validate';
import { countProblems, sortProblems } from '../domain/validate';
import { formatTime } from '../lib/format';
import { useLang } from '../i18n/useLang';
import { Icon } from './Icons';

import '../screens/editor.css';

export interface ValidationStripProps {
  problems: readonly Problem[];
  segmentCount: number;
  totalMs: number;
  speakingMs: Record<SideId, number>;
  sideLabels: Record<SideId, string>;
  secondsOnly: boolean;
  /** Segments whose speaker was deleted — the one bulk fix the strip offers. */
  danglingCount: number;
  onRemoveDangling: () => void;
  onFocusProblem: (problem: Problem) => void;
}

export function ValidationStrip({
  problems,
  segmentCount,
  totalMs,
  speakingMs,
  sideLabels,
  secondsOnly,
  danglingCount,
  onRemoveDangling,
  onFocusProblem,
}: ValidationStripProps): JSX.Element {
  const { t, l10n } = useLang();
  const counts = countProblems(problems);
  const ordered = sortProblems(problems);
  const showHours = totalMs >= 3_600_000;

  return (
    <div className="vstrip" role="group" aria-label={t('v.problems')}>
      <p className="vstrip__summary t-meta" data-state={counts.errors > 0 ? 'error' : 'ok'}>
        {counts.errors > 0 ? (
          <>
            <Icon name="alert" /> {t('v.fixToRun', { n: counts.errors })}
          </>
        ) : (
          <>
            <Icon name="check" /> {t('v.ready')}
          </>
        )}
        <span className="vstrip__facts num">
          {segmentCount} {t('ed.segments')} · {formatTime(totalMs, { secondsOnly, showHours })} ·{' '}
          {sideLabels.A} {formatTime(speakingMs.A, { secondsOnly, showHours })} / {sideLabels.B}{' '}
          {formatTime(speakingMs.B, { secondsOnly, showHours })}
        </span>
      </p>

      {ordered.length === 0 ? null : (
        <ul className="vstrip__chips" aria-label={t('v.problems')}>
          {ordered.map((problem, i) => (
            <li key={`${problem.code}-${i}`}>
              <button
                type="button"
                className="vstrip__chip t-meta"
                data-severity={problem.severity}
                onClick={() => onFocusProblem(problem)}
              >
                {l10n(problem.message)}
              </button>
            </li>
          ))}
        </ul>
      )}

      {danglingCount === 0 ? null : (
        <button type="button" className="btn btn--quiet vstrip__bulk t-meta" onClick={onRemoveDangling}>
          {t('ed.removeDangling', { n: danglingCount })}
        </button>
      )}
    </div>
  );
}
