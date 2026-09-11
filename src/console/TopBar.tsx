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
import { roundElapsedMs, scheduleDelta } from '../engine/selectors';
import type { AudioState } from '../engine/sound';
import { getSession } from '../engine/store';
import { useLang } from '../i18n/useLang';
import { formatDelta, formatTime } from '../lib/format';
import { Icon } from '../ui/Icons';

import './console.css';

/**
 * Deadband before the bar claims a round is running early or late. The delta itself stays
 * exact; this only governs when it is worth saying so. Half a minute is the point at which
 * a chair would actually adjust — a second would light amber while a speaker walked up.
 */
const ON_SCHEDULE_MS = 30_000;

export interface TopBarProps {
  title: string;
  subtitle: string;
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

function scheduleWord(deltaMs: number): 'ahead' | 'behind' | 'on' {
  if (deltaMs <= -ON_SCHEDULE_MS) return 'ahead';
  if (deltaMs >= ON_SCHEDULE_MS) return 'behind';
  return 'on';
}

export function TopBar({
  title,
  subtitle,
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
  const deltaEl = useRef<HTMLSpanElement>(null);
  const chipEl = useRef<HTMLSpanElement>(null);
  const remote = useSyncExternalStore(subscribeRemote, getLastRemoteKey, getLastRemoteKey);

  useEffect(() => {
    let lastElapsed = '';
    let lastDelta = '';
    let lastWord = '';
    return registerTick((n) => {
      const s = getSession();
      const elapsed = formatTime(roundElapsedMs(s.state, n));
      if (elapsed !== lastElapsed) {
        lastElapsed = elapsed;
        if (elapsedEl.current) elapsedEl.current.textContent = elapsed;
      }
      const deltaMs = scheduleDelta(s.state, s.plan, n);
      const delta = formatDelta(deltaMs);
      if (delta !== lastDelta) {
        lastDelta = delta;
        if (deltaEl.current) deltaEl.current.textContent = delta;
      }
      const word = scheduleWord(deltaMs);
      if (word !== lastWord) {
        lastWord = word;
        if (chipEl.current) chipEl.current.dataset['schedule'] = word;
      }
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
          <span className="utop__sub">{subtitle}</span>
          <span className="utop__dot utop__sub" aria-hidden="true">·</span>
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
          <span ref={chipEl} className="utop__delta" data-schedule="on">
            <span ref={deltaEl} data-numeric="">
              {formatDelta(0)}
            </span>
            <span className="utop__deltaword" data-w="ahead">
              {t('r.ahead')}
            </span>
            <span className="utop__deltaword" data-w="behind">
              {t('r.behind')}
            </span>
            <span className="utop__deltaword" data-w="on">
              {t('r.onSchedule')}
            </span>
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
