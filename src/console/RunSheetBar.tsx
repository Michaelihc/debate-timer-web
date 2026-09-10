/**
 * Band 1: what round this is, where in it we are, and how the room's other machinery is
 * doing. Everything here is chrome the operator must be able to check without stopping.
 *
 * The audio state is permanently visible rather than buried: a muted or un-armed
 * AudioContext is the single most common reason a venue hears no bells, and finding that
 * out at the first speech is too late.
 *
 * The round readout ticks from the frame loop, so this component renders only when the
 * segment or the chrome state actually changes.
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
 * exact; this only governs when it is worth saying so. A second is far too tight — the
 * ordinary dead time while a speaker walks up would light the chip amber before anyone
 * had spoken. Half a minute is the point at which a chair would actually adjust.
 */
const ON_SCHEDULE_MS = 30_000;

export interface RunSheetBarProps {
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
  stageOpen: boolean;
  stageBlocked: boolean;
  onStage: () => void;
  onEditor: () => void;
}

function scheduleWord(deltaMs: number): 'ahead' | 'behind' | 'on' {
  if (deltaMs <= -ON_SCHEDULE_MS) return 'ahead';
  if (deltaMs >= ON_SCHEDULE_MS) return 'behind';
  return 'on';
}

export function RunSheetBar({
  title,
  subtitle,
  segmentIndex,
  segmentCount,
  scheduledMs,
  lang,
  onLang,
  audio,
  onAudio,
  stageOpen,
  stageBlocked,
  onStage,
  onEditor,
}: RunSheetBarProps): JSX.Element {
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
      // No forced hours: a 29-minute round reads `29:00`, and `formatTime` rolls over to
      // `1:02:00` on its own once the round actually passes an hour.
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
    <header className="bar">
      <div className="bar__id">
        <h2 className="bar__title t-ctl">{title}</h2>
        <span className="bar__sub t-cap">{subtitle}</span>
      </div>

      <p className="bar__seg t-cap">
        {t('r.segmentOf', { i: segmentIndex, n: segmentCount })}
      </p>

      <p className="bar__round t-meta">
        <span className="t-cap bar__roundlabel">{t('r.elapsed')}</span>
        <span ref={elapsedEl} data-numeric="">
          {formatTime(0)}
        </span>
        <span className="bar__slash" aria-hidden="true">
          /
        </span>
        <span data-numeric="">{formatTime(scheduledMs)}</span>
        <span ref={chipEl} className="bar__delta t-cap" data-schedule="on">
          <span ref={deltaEl} data-numeric="">
            {formatDelta(0)}
          </span>
          <span className="bar__deltaword" data-w="ahead">
            {t('r.ahead')}
          </span>
          <span className="bar__deltaword" data-w="behind">
            {t('r.behind')}
          </span>
          <span className="bar__deltaword" data-w="on">
            {t('r.onSchedule')}
          </span>
        </span>
      </p>

      <div className="bar__tools">
        {remote === null ? null : (
          <span className="bar__chip t-cap" data-tone="quiet">
            {t('sg.remote')} <kbd className="keycap">{remote}</kbd>
          </span>
        )}

        <button type="button" className="bar__btn t-cap" onClick={onLang} aria-label={t('kb.langToggle')}>
          {lang === 'zh' ? '中文' : 'EN'}
        </button>

        <button
          type="button"
          className="bar__btn t-cap"
          onClick={onEditor}
          aria-keyshortcuts="E"
        >
          <Icon name="edit" size={14} />
          {t('nav.editor')}
        </button>

        <button
          type="button"
          className="bar__btn t-cap"
          onClick={onStage}
          title={t('sg.sameBrowser')}
          aria-keyshortcuts="D"
        >
          <Icon name="stage" size={14} />
          {t('nav.stage')}
          <span className="bar__pip" data-live={stageOpen ? '' : undefined} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="app__audio"
          data-status={audio.status}
          onClick={onAudio}
          aria-keyshortcuts="M"
        >
          <Icon name={audio.muted || !audio.armed ? 'mute' : 'sound'} size={14} />
          {audioLabel}
        </button>
      </div>

      {stageBlocked ? (
        <p className="bar__blocked t-cap">
          <Icon name="alert" size={14} />
          <a className="bar__link" href="#/stage" target="_blank" rel="noreferrer">
            {t('sg.blocked')}
          </a>
        </p>
      ) : null}
    </header>
  );
}
