/**
 * The composer — the fast path and the discoverable path in one control.
 *
 * Type `p1 ⏎ c1 ⏎ c2 ⏎ p2 ⏎ …` and the run sheet fills as fast as the operator can
 * think. Below it, the same additions as a wrapped chip row, so a mouse user never has
 * to learn the shorthand and a keyboard user never has to reach for the mouse.
 *
 * It appends. It never reorders, completes or deduplicates: `p1 p1 p1` is three speeches
 * by the same debater, and that is a legal run sheet the operator meant to build.
 */

import type { JSX, KeyboardEvent as ReactKeyboardEvent, Ref } from 'react';
import { useMemo, useState } from 'react';
import type { Id, RoundConfig, SegmentKind, SideId, SpeakerCfg } from '../domain/config';
import { KIND_LABELS } from '../domain/plan';
import { autoInk } from '../lib/contrast';
import { formatTime } from '../lib/format';
import { useLang } from '../i18n/useLang';

import '../screens/editor.css';

export type ComposerPick =
  | { kind: 'speech'; speakerId: Id }
  | { kind: 'prep' }
  | { kind: 'chess' }
  | { kind: 'shared' }
  | { kind: 'break' };

export interface ComposerProps {
  config: RoundConfig;
  onAppend: (pick: ComposerPick) => void;
  onAlternate: () => void;
  onFreeBeforeSummaries: () => void;
  secondsOnly: boolean;
  inputRef?: Ref<HTMLInputElement>;
}

interface Candidate {
  key: string;
  pick: ComposerPick;
  /** Everything the operator might type to reach this entry, lower-cased. */
  tokens: string[];
  label: string;
  meta: string;
  color: string | null;
}

/** Both Latin conventions plus the Chinese ones, because both are typed in the room. */
const SIDE_TOKENS: Record<SideId, string[]> = {
  A: ['p', 'a', '正'],
  B: ['c', 'b', '反'],
};

const BLOCK_TOKENS: Record<Exclude<SegmentKind, 'speech'>, string[]> = {
  prep: ['prep', '准备', '准备时间'],
  chess: ['free', 'freedebate', 'chess', '自由', '自由辩论'],
  shared: ['cross', 'crossfire', 'shared', 'cx', '质询', '对辩', '共用'],
  break: ['break', 'pause', '休息'],
};

function speakerCandidates(config: RoundConfig, lang: 'en' | 'zh', secondsOnly: boolean): Candidate[] {
  const seen: Record<SideId, number> = { A: 0, B: 0 };
  return config.speakers.map((speaker) => {
    const ordinal = ++seen[speaker.side];
    const tokens = SIDE_TOKENS[speaker.side].flatMap((letter) => [
      `${letter}${ordinal}`,
      letter,
    ]);
    const name = speaker.name.trim();
    if (name !== '') tokens.push(name.toLowerCase());
    const role = speaker.role ? (lang === 'zh' ? speaker.role.zh : speaker.role.en) : '';
    if (role !== '') tokens.push(role.toLowerCase());
    const side = speaker.side === 'A' ? config.sides[0] : config.sides[1];
    return {
      key: speaker.id,
      pick: { kind: 'speech', speakerId: speaker.id },
      tokens,
      label: name === '' ? `${lang === 'zh' ? side.label.zh : side.label.en} ${ordinal}` : name,
      meta: formatTime(speaker.defaultMs, { secondsOnly }),
      color: side.color,
    };
  });
}

function blockCandidates(lang: 'en' | 'zh'): Candidate[] {
  const kinds: Exclude<SegmentKind, 'speech'>[] = ['prep', 'chess', 'shared', 'break'];
  return kinds.map((kind) => ({
    key: kind,
    pick: { kind } as ComposerPick,
    tokens: BLOCK_TOKENS[kind],
    label: lang === 'zh' ? KIND_LABELS[kind].zh : KIND_LABELS[kind].en,
    meta: '',
    color: null,
  }));
}

/** Exact token, then prefix, then substring. Nothing else ranks. */
function score(candidate: Candidate, query: string): number {
  let best = -1;
  for (const token of candidate.tokens) {
    if (token === query) return 3;
    if (token.startsWith(query)) best = Math.max(best, 2);
    else if (token.includes(query)) best = Math.max(best, 1);
  }
  return best;
}

export function Composer({
  config,
  onAppend,
  onAlternate,
  onFreeBeforeSummaries,
  secondsOnly,
  inputRef,
}: ComposerProps): JSX.Element {
  const { t, lang } = useLang();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const candidates = useMemo(
    () => [...speakerCandidates(config, lang, secondsOnly), ...blockCandidates(lang)],
    [config, lang, secondsOnly],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return [];
    return candidates
      .map((c) => ({ c, s: score(c, q) }))
      .filter((entry) => entry.s > 0)
      .sort((x, y) => y.s - x.s)
      .map((entry) => entry.c)
      .slice(0, 8);
  }, [candidates, query]);

  const index = matches.length === 0 ? -1 : Math.min(active, matches.length - 1);

  function commit(candidate: Candidate | undefined): void {
    if (!candidate) return;
    onAppend(candidate.pick);
    setQuery('');
    setActive(0);
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((v) => (matches.length === 0 ? 0 : (v + 1) % matches.length));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((v) => (matches.length === 0 ? 0 : (v - 1 + matches.length) % matches.length));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(matches[index]);
      return;
    }
    if (e.key === 'Escape' && query !== '') {
      e.preventDefault();
      e.stopPropagation();
      setQuery('');
    }
  }

  return (
    <div className="composer">
      <div className="composer__helpers">
        <button type="button" className="btn btn--quiet t-meta" onClick={onAlternate}>
          {t('ed.alternate')}
        </button>
        <button type="button" className="btn btn--quiet t-meta" onClick={onFreeBeforeSummaries}>
          {t('ed.freeBeforeSummaries')}
        </button>
      </div>

      <div className="composer__box">
        <input
          ref={inputRef}
          type="text"
          className="composer__input t-ctl"
          value={query}
          placeholder={t('ed.composerHint')}
          aria-label={t('ed.addSegment')}
          aria-expanded={matches.length > 0}
          aria-controls="composer-matches"
          aria-autocomplete="list"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />

        <ul
          id="composer-matches"
          className="composer__matches"
          role="listbox"
          aria-label={t('ed.matches')}
        >
          {matches.map((candidate, i) => (
            <li key={candidate.key} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={i === index}
                className="composer__match t-ctl"
                data-active={i === index ? '' : undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(candidate)}
              >
                <span
                  className="composer__swatch"
                  style={candidate.color === null ? undefined : { background: candidate.color }}
                  aria-hidden="true"
                />
                <span className="composer__match-label">{candidate.label}</span>
                <span className="composer__match-meta t-meta num">{candidate.meta}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <ul className="composer__chips" aria-label={t('ed.quickAdd')}>
        {config.speakers.map((speaker) => (
          <SpeakerChip
            key={speaker.id}
            speaker={speaker}
            color={(speaker.side === 'A' ? config.sides[0] : config.sides[1]).color}
            fallback={
              (speaker.side === 'A' ? config.sides[0] : config.sides[1]).label[lang === 'zh' ? 'zh' : 'en']
            }
            onClick={() => onAppend({ kind: 'speech', speakerId: speaker.id })}
          />
        ))}
        {blockCandidates(lang).map((block) => (
          <li key={block.key}>
            <button type="button" className="composer__chip composer__chip--block t-cap" onClick={() => onAppend(block.pick)}>
              {block.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SpeakerChip({
  speaker,
  color,
  fallback,
  onClick,
}: {
  speaker: SpeakerCfg;
  color: string;
  fallback: string;
  onClick: () => void;
}): JSX.Element {
  const name = speaker.name.trim();
  return (
    <li>
      <button
        type="button"
        className="composer__chip t-cap"
        style={{ background: color, color: autoInk(color) }}
        onClick={onClick}
      >
        {name === '' ? fallback : name}
      </button>
    </li>
  );
}
