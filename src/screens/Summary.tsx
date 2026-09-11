/**
 * SUMMARY `#/summary` — the box score.
 *
 * Every clock the round scheduled, in the operator's order, with what it was given,
 * what it actually took, and by how much it went past. A free-debate segment is two
 * rows because it is two clocks; a prep bank appears only if it was drawn.
 *
 * The screen is re-enterable at any time, not just at the end: a round that is still
 * running can be inspected and then stepped back into from the same page. Numbers all
 * come from `clockView`; nothing here re-derives a clock.
 *
 * The run order is reported exactly as it ran — repeats, omissions and out-of-sequence
 * speakers are the operator's decisions, and this screen never remarks on them.
 */

import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { SideId } from '../domain/config';
import { now } from '../engine/chronometer';
import { runningClockIds } from '../engine/chronometer';
import { clockView, roundElapsedMs, roundPhase } from '../engine/selectors';
import { useRound } from '../engine/store';
import { useLang } from '../i18n/useLang';
import { formatDelta, formatTime } from '../lib/format';
import { useConfirm } from '../ui/useConfirm';
import { Icon } from '../ui/Icons';

import { openConfig } from '../app/boot';
import { useHotkeys } from '../app/hotkeys';
import { ROUTES, navigate } from '../app/router';

import './screens.css';

const SIDES: readonly SideId[] = ['A', 'B'];

interface Row {
  key: string;
  /** 1-based position in the run order; null for a prep bank, which has no slot. */
  order: number | null;
  label: string;
  who: string;
  side: SideId | null;
  allottedMs: number;
  usedMs: number;
  overMs: number;
}

interface SideTotal {
  side: SideId;
  name: string;
  allottedMs: number;
  usedMs: number;
  overMs: number;
}

type CopyState = 'idle' | 'copied' | 'failed';

export default function Summary(): JSX.Element {
  const { t, l10n, lang } = useLang();
  const { config, plan, state } = useRound();
  const { ask, dialog } = useConfirm();
  const [tick, setTick] = useState(0);
  const [copy, setCopy] = useState<CopyState>('idle');
  const [fallback, setFallback] = useState('');

  // Visiting mid-round is legal, so the page has to keep up with a live clock — once a
  // second, never per frame: there is no running digit on this screen.
  useEffect(() => {
    if (runningClockIds(state).length === 0) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      clearInterval(id);
    };
  }, [state]);

  useHotkeys('summary', {
    editor: () => navigate(ROUTES.edit),
  });

  const rows = useMemo<Row[]>(() => {
    void tick;
    const n = now();
    const out: Row[] = [];
    const join = lang === 'zh' ? '、' : ', ';

    for (const ps of plan.segments) {
      for (const clock of ps.clocks) {
        const view = clockView(state, plan, clock.id, n);
        if (!view) continue;
        const sideCfg = config.sides.find((s) => s.id === clock.side);
        const base = l10n(ps.label);
        const label =
          ps.clocks.length > 1 && sideCfg ? `${base} · ${l10n(sideCfg.label)}` : base;
        let who = ps.speaker?.name ?? '';
        if (who === '' && ps.participants.length > 0) {
          who = ps.participants.map((p) => p.name).join(join);
        }
        if (who === '' && sideCfg) who = l10n(sideCfg.label);
        out.push({
          key: clock.id,
          order: ps.index + 1,
          label,
          who,
          side: clock.side,
          allottedMs: view.allottedMs,
          usedMs: view.elapsedMs,
          overMs: view.overtimeMs,
        });
      }
    }

    // A bank that was never drawn is not part of the story of the round.
    for (const side of SIDES) {
      const bank = plan.banks[side];
      if (!bank) continue;
      const view = clockView(state, plan, bank.id, n);
      if (!view || view.elapsedMs <= 0) continue;
      const sideCfg = config.sides.find((s) => s.id === side);
      out.push({
        key: bank.id,
        order: null,
        label: l10n(bank.label),
        who: sideCfg ? l10n(sideCfg.label) : '',
        side,
        allottedMs: view.allottedMs,
        usedMs: view.elapsedMs,
        overMs: view.overtimeMs,
      });
    }

    return out;
  }, [config, plan, state, l10n, lang, tick]);

  const totals = useMemo(() => {
    let allotted = 0;
    let used = 0;
    let over = 0;
    for (const row of rows) {
      allotted += row.allottedMs;
      used += row.usedMs;
      over += row.overMs;
    }
    return { allotted, used, over };
  }, [rows]);

  const sideTotals = useMemo<SideTotal[]>(
    () =>
      SIDES.map((side) => {
        const cfg = config.sides.find((s) => s.id === side);
        const total: SideTotal = {
          side,
          name: cfg ? l10n(cfg.label) : side,
          allottedMs: 0,
          usedMs: 0,
          overMs: 0,
        };
        for (const row of rows) {
          if (row.side !== side) continue;
          total.allottedMs += row.allottedMs;
          total.usedMs += row.usedMs;
          total.overMs += row.overMs;
        }
        return total;
      }),
    [rows, config, l10n],
  );

  const scheduledMs = plan.totalMs;
  const actualMs = useMemo(() => {
    void tick;
    return roundElapsedMs(state, now());
  }, [state, tick]);
  const deltaMs = actualMs - scheduledMs;

  const asText = useCallback((): string => {
    const head = [t('sum.order'), t('sum.segment'), t('sum.speaker'), t('sum.allotted'), t('sum.used'), t('sum.over')];
    const lines: string[] = [
      l10n(config.title) || t('lc.untitled'),
      `${t('r.scheduled')} ${formatTime(scheduledMs)}\t${t('sum.actual')} ${formatTime(actualMs)}\t${formatDelta(deltaMs)}`,
      '',
      head.join('\t'),
    ];
    for (const row of rows) {
      lines.push(
        [
          row.order === null ? '—' : String(row.order),
          row.label,
          row.who,
          formatTime(row.allottedMs),
          formatTime(row.usedMs),
          row.overMs > 0 ? formatDelta(row.overMs) : '—',
        ].join('\t'),
      );
    }
    lines.push('');
    for (const side of sideTotals) {
      lines.push(
        `${side.name}\t${formatTime(side.usedMs)} / ${formatTime(side.allottedMs)}\t${side.overMs > 0 ? formatDelta(side.overMs) : '—'}`,
      );
    }
    lines.push(
      `${t('sum.total')}\t${formatTime(totals.used)} / ${formatTime(totals.allotted)}\t${totals.over > 0 ? formatDelta(totals.over) : '—'}`,
    );
    return lines.join('\n');
  }, [actualMs, config, deltaMs, l10n, rows, scheduledMs, sideTotals, t, totals]);

  const onCopy = useCallback(async (): Promise<void> => {
    const text = asText();
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setFallback('');
      setCopy('copied');
    } catch {
      // Never a dead end: the text is put on the page so it can be selected by hand.
      setFallback(text);
      setCopy('failed');
    }
  }, [asText]);

  const runAgain = useCallback(async (): Promise<void> => {
    if (roundPhase(state, plan) === 'in') {
      const ok = await ask({ title: t('d.restartTitle'), body: t('d.restartBody'), confirmLabel: t('sum.runAgain') });
      if (!ok) return;
    }
    openConfig(config);
  }, [ask, config, plan, state, t]);

  const empty = plan.segments.length === 0;

  return (
    <section className="scr" aria-labelledby="sum-title">
      <header className="scr__bar">
        <div className="scr__brand">
          <span id="sum-title" className="scr__brandname t-name">
            {t('sum.title')}
          </span>
          <span className="scr__brandsub">{l10n(config.title) || t('lc.untitled')}</span>
        </div>
        <div className="scr__tools">
          <button type="button" className="btn btn--quiet" onClick={() => navigate(ROUTES.launch)}>
            {t('nav.launch')}
          </button>
          <button type="button" className="btn" onClick={() => navigate(ROUTES.console)}>
            {t('sum.reenter')}
          </button>
        </div>
      </header>

      <div className="scr__scroll">
        <div className="scr__inner">
          {empty ? (
            <section className="scr__sec">
              <p className="scr__note">{t('sum.empty')}</p>
              <div className="scr__acts">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => navigate(ROUTES.launch)}
                >
                  {t('nav.launch')}
                </button>
              </div>
            </section>
          ) : (
            <>
              <div className="sum__head">
                <div className="sum__figures">
                  <span className="sum__figure">
                    <span className="t-cap">{t('r.scheduled')}</span>
                    <span className="sum__figureval">{formatTime(scheduledMs)}</span>
                  </span>
                  <span className="sum__figure">
                    <span className="t-cap">{t('sum.actual')}</span>
                    <span className="sum__figureval">{formatTime(actualMs)}</span>
                  </span>
                  <span className="sum__figure sum__delta" data-over={deltaMs > 0 ? '' : undefined}>
                    <span className="t-cap">
                      {deltaMs === 0
                        ? t('r.onSchedule')
                        : deltaMs > 0
                          ? t('r.behind')
                          : t('r.ahead')}
                    </span>
                    <span className="sum__figureval">{formatDelta(deltaMs)}</span>
                  </span>
                </div>
              </div>

              <section className="scr__sec" aria-labelledby="sum-sheet">
                <div className="scr__sechead">
                  <h2 id="sum-sheet" className="scr__sectitle t-row">
                    {t('ed.runsheet')}
                  </h2>
                </div>
                <div className="sum__tablewrap">
                  <table className="sum__table">
                    <thead>
                      <tr>
                        <th scope="col" className="sum__order">
                          <span aria-hidden="true">#</span>
                          <span className="sr-only">{t('sum.order')}</span>
                        </th>
                        <th scope="col">{t('sum.segment')}</th>
                        <th scope="col">{t('sum.speaker')}</th>
                        <th scope="col" className="sum__num">
                          {t('sum.allotted')}
                        </th>
                        <th scope="col" className="sum__num">
                          {t('sum.used')}
                        </th>
                        <th scope="col" className="sum__num">
                          {t('sum.over')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.key}>
                          <td className="sum__order">{row.order === null ? '—' : row.order}</td>
                          <td className="sum__label">
                            <span
                              className="sum__tick"
                              data-side={row.side ?? undefined}
                              aria-hidden="true"
                            />
                            {row.label}
                          </td>
                          <td className="sum__who">{row.who}</td>
                          <td className="sum__num">{formatTime(row.allottedMs)}</td>
                          <td className="sum__num">{formatTime(row.usedMs)}</td>
                          <td className={row.overMs > 0 ? 'sum__num sum__over' : 'sum__num sum__none'}>
                            {row.overMs > 0 ? formatDelta(row.overMs) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className="sum__order" />
                        <td className="sum__label">{t('sum.total')}</td>
                        <td className="sum__who" />
                        <td className="sum__num">{formatTime(totals.allotted)}</td>
                        <td className="sum__num">{formatTime(totals.used)}</td>
                        <td className={totals.over > 0 ? 'sum__num sum__over' : 'sum__num sum__none'}>
                          {totals.over > 0 ? formatDelta(totals.over) : '—'}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>

              <section className="scr__sec" aria-labelledby="sum-sides">
                <div className="scr__sechead">
                  <h2 id="sum-sides" className="scr__sectitle t-row">
                    {t('ed.sideTotals')}
                  </h2>
                </div>
                <div className="sum__totals">
                  {sideTotals.map((side) => (
                    <div key={side.side} className="sum__total" data-side={side.side}>
                      <span className="sum__totalname t-cap">{side.name}</span>
                      <span className="sum__totalval">{formatTime(side.usedMs)}</span>
                      <span
                        className="sum__totalnote"
                        data-over={side.overMs > 0 ? '' : undefined}
                      >
                        {t('sum.allotted')} {formatTime(side.allottedMs)}
                        {side.overMs > 0 ? ` · ${t('sum.over')} ${formatDelta(side.overMs)}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="scr__sec">
                <div className="scr__acts">
                  <button type="button" className="btn" onClick={() => void onCopy()}>
                    <Icon name="copy" />
                    {copy === 'copied' ? t('sh.copied') : t('sum.copyText')}
                  </button>
                  <button type="button" className="btn" onClick={() => navigate(ROUTES.edit)}>
                    <Icon name="edit" />
                    {t('nav.editor')}
                  </button>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => void runAgain()}
                  >
                    {t('sum.runAgain')}
                  </button>
                </div>
                <span className="sr-only" aria-live="polite">
                  {copy === 'copied' ? t('sh.copied') : copy === 'failed' ? t('sh.copyFailed') : ''}
                </span>
                {copy === 'failed' ? (
                  <>
                    <p className="scr__note">{t('sh.copyFailed')}</p>
                    <label className="sr-only" htmlFor="sum-fallback">
                      {t('sum.copyText')}
                    </label>
                    <textarea
                      id="sum-fallback"
                      className="sum__fallback"
                      readOnly
                      value={fallback}
                      onFocus={(event) => event.target.select()}
                    />
                  </>
                ) : null}
              </section>
            </>
          )}
        </div>
      </div>

      {dialog}
    </section>
  );
}
