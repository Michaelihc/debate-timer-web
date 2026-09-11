/**
 * The top band: the motion, centred and large, with the menu-ish actions at the corners.
 *
 * That is the original's chrome exactly — `Topic` at (0, 193.5) in a 450x50 box, the `Menu
 * Button` at (-349.7, 202.6) top-left and the `Reload` button at (333.4, 193.5) top-right.
 * The motion is the biggest thing on the screen after the clock, because in the room it is
 * the one piece of text an audience reads.
 *
 * Home sits beside the lime button as a quiet outline: the way back to the formats and
 * recent rounds, without competing with the one loud action in the corner.
 *
 * Under the motion, one quiet line: which segment the round is on, and how long the round
 * has run against its scheduled length. The side names are not repeated there, since the
 * rosters already carry them, and there is no ahead-or-behind verdict: skipping segments
 * makes one meaningless.
 *
 * The audio state stays permanently visible rather than buried: a muted or un-armed
 * AudioContext is the commonest reason a venue hears no bells, and finding that out at the
 * first speech is too late. The round readout ticks from the frame loop, so this component
 * renders only when the segment or the chrome state actually changes.
 */

import type { JSX } from 'react';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Lang } from '../domain/config';
import { getLastRemoteKey, subscribeRemote } from '../app/hotkeys';
import { registerTick } from '../engine/loop';
import { roundElapsedMs } from '../engine/selectors';
import type { AudioState } from '../engine/sound';
import { getSession } from '../engine/store';
import { useLang } from '../i18n/useLang';
import { formatTime } from '../lib/format';
import { Icon } from '../ui/Icons';

import './console.css';

export interface TopBarProps {
  title: string;
  /** 1-based for display; pass 0 before the round starts. */
  segmentIndex: number;
  segmentCount: number;
  scheduledMs: number;
  lang: Lang;
  onLang: () => void;
  audio: AudioState;
  onAudio: () => void;
  onEditor: () => void;
  /** Back to the launch screen. The round keeps its place. */
  onHome: () => void;
}

export function TopBar({
  title,
  segmentIndex,
  segmentCount,
  scheduledMs,
  lang,
  onLang,
  audio,
  onAudio,
  onEditor,
  onHome,
}: TopBarProps): JSX.Element {
  const { t } = useLang();
  const elapsedEl = useRef<HTMLSpanElement>(null);
  const remote = useSyncExternalStore(subscribeRemote, getLastRemoteKey, getLastRemoteKey);

  useEffect(() => {
    let lastElapsed = '';
    return registerTick((n) => {
      const elapsed = formatTime(roundElapsedMs(getSession().state, n));
      if (elapsed === lastElapsed) return;
      lastElapsed = elapsed;
      if (elapsedEl.current) elapsedEl.current.textContent = elapsed;
    });
  }, []);

  const audioLabel =
    audio.status === 'armed'
      ? t('au.armed')
      : audio.status === 'muted'
        ? t('au.muted')
        : t('au.enable');

  return (
    <header className="utop">
      <div className="utop__side utop__side--left">
        <button type="button" className="ubtn ubtn--lime" onClick={onEditor} aria-keyshortcuts="E">
          <Icon name="edit" size={14} />
          <span>{t('nav.editor')}</span>
        </button>
        <button type="button" className="ubtn" onClick={onHome}>
          <span>{t('nav.home')}</span>
        </button>
      </div>

      <div className="utop__mid">
        <h1 className="utop__title">{title}</h1>
        <p className="utop__meta">
          <span>{t('r.segmentOf', { i: segmentIndex, n: segmentCount })}</span>
          <span className="utop__dot" aria-hidden="true">·</span>
          <span className="utop__round">
            <span className="utop__roundlabel">{t('r.elapsed')}</span>
            <span ref={elapsedEl} data-numeric="">
              {formatTime(0)}
            </span>
            <span className="utop__slash" aria-hidden="true">/</span>
            <span data-numeric="">{formatTime(scheduledMs)}</span>
          </span>
        </p>
      </div>

      <div className="utop__side utop__side--right">
        {remote === null ? null : (
          <span className="utop__chip">
            {t('nav.remote')} <kbd className="keycap">{remote}</kbd>
          </span>
        )}

        <button
          type="button"
          className="ubtn"
          data-status={audio.status}
          onClick={onAudio}
          aria-keyshortcuts="M"
        >
          <Icon name={audio.muted || !audio.armed ? 'mute' : 'sound'} size={14} />
          <span>{audioLabel}</span>
        </button>

        <button type="button" className="ubtn" onClick={onLang} aria-label={t('kb.langToggle')}>
          {lang === 'zh' ? '中文' : 'EN'}
        </button>
      </div>
    </header>
  );
}
