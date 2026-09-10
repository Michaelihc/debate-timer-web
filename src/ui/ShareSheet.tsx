/**
 * Export and import, in one sheet.
 *
 * Import is the half that matters. Pasted text — a share link, a v3 `.debate.json`, or a
 * legacy Unity `save.json` — is sniffed, migrated and validated into a STAGING BUFFER.
 * The editor's own config is not touched until the operator looks at the report and the
 * diff and says yes. A parse failure produces a list of problems and leaves the draft
 * exactly as it was; the original wrote its error message into the textarea the user was
 * editing and then saved that string over their file.
 */

import type { DragEvent as ReactDragEvent, JSX } from 'react';
import { useEffect, useState } from 'react';
import type { RoundConfig } from '../domain/config';
import { canonicalJson } from '../domain/config';
import type { MigrationProblem } from '../domain/migrate';
import { importText } from '../app/boot';
import { LINK_BUDGET, buildShareLink } from '../lib/urlState';
import { useLang } from '../i18n/useLang';
import { Icon } from './Icons';
import { Overlay } from './Overlay';

import '../screens/editor.css';

export interface ShareSheetProps {
  open: boolean;
  onClose: () => void;
  config: RoundConfig;
  onImport: (config: RoundConfig) => void;
}

interface Staged {
  config: RoundConfig;
  problems: MigrationProblem[];
}

function fileName(config: RoundConfig, lang: 'en' | 'zh'): string {
  const raw = (lang === 'zh' ? config.title.zh : config.title.en).trim();
  const safe = raw.replace(/[\\/:*?"<>|]+/g, ' ').trim();
  return `${safe === '' ? 'round' : safe}.debate.json`;
}

export function ShareSheet({ open, onClose, config, onImport }: ShareSheetProps): JSX.Element | null {
  const { t, l10n, lang } = useLang();
  const [link, setLink] = useState<{ url: string; length: number; over: boolean } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [staged, setStaged] = useState<Staged | null>(null);
  const [problems, setProblems] = useState<MigrationProblem[]>([]);
  const [dragging, setDragging] = useState(false);

  // The link is rebuilt whenever the sheet is open and the config moves; encoding is
  // async because the deflate codec is.
  useEffect(() => {
    if (!open) return;
    let live = true;
    void buildShareLink(config).then((built) => {
      if (live) setLink({ url: built.url, length: built.length, over: built.overBudget });
    });
    return () => {
      live = false;
    };
  }, [open, config]);

  useEffect(() => {
    if (copied === null) return;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy(what: string, value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
    } catch {
      setCopied('failed');
    }
  }

  function download(): void {
    const blob = new Blob([`${JSON.stringify(config, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName(config, lang);
    a.click();
    URL.revokeObjectURL(url);
  }

  async function stage(raw: string): Promise<void> {
    const outcome = await importText(raw);
    setProblems(outcome.problems);
    setStaged(outcome.config === null ? null : { config: outcome.config, problems: outcome.problems });
  }

  async function onDrop(e: ReactDragEvent<HTMLDivElement>): Promise<void> {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files.item(0);
    if (!file) return;
    const raw = await file.text();
    setText(raw);
    await stage(raw);
  }

  return (
    <Overlay open={open} onClose={onClose} title={t('sh.title')} size="lg" className="sheet">
      <section className="sheet__block">
        <h3 className="t-cap">{t('sh.copyLink')}</h3>
        <p className="sheet__link t-meta num" data-over={link?.over === true ? '' : undefined}>
          {link === null
            ? t('ui.loading')
            : `${t('sh.chars', { n: link.length })}${link.over ? ` · ${t('v.linkTooLong')}` : ''}`}
        </p>
        <div className="sheet__actions">
          <button
            type="button"
            className="btn"
            disabled={link === null}
            onClick={() => void copy('link', link?.url ?? '')}
          >
            <Icon name="link" /> {copied === 'link' ? t('sh.copied') : t('sh.copyLink')}
          </button>
          <button type="button" className="btn" onClick={() => void copy('json', canonicalJson(config))}>
            <Icon name="copy" /> {copied === 'json' ? t('sh.copied') : t('sh.copyJson')}
          </button>
          <button type="button" className="btn" onClick={download}>
            <Icon name="download" /> {t('sh.download')}
          </button>
        </div>
        {copied === 'failed' ? <p className="sheet__warn t-meta">{t('sh.copyFailed')}</p> : null}
        {link !== null && link.length > LINK_BUDGET ? (
          <p className="sheet__warn t-meta">{t('v.linkTooLong')}</p>
        ) : null}
      </section>

      <section className="sheet__block">
        <h3 className="t-cap">{t('sh.import')}</h3>
        <div
          className="sheet__drop"
          data-dragging={dragging ? '' : undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => void onDrop(e)}
        >
          <p className="t-meta">{t('ed.dropHere')}</p>
          <label className="btn btn--quiet t-meta sheet__file">
            {t('ed.chooseFile')}
            <input
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.item(0);
                if (!file) return;
                void file.text().then((raw) => {
                  setText(raw);
                  return stage(raw);
                });
              }}
            />
          </label>
        </div>

        <label className="sheet__paste">
          <span className="sr-only">{t('sh.import')}</span>
          <textarea
            className="sheet__textarea t-meta"
            rows={4}
            value={text}
            spellCheck={false}
            placeholder={t('ed.importPlaceholder')}
            onChange={(e) => setText(e.target.value)}
          />
        </label>

        <div className="sheet__actions">
          <button type="button" className="btn" disabled={text.trim() === ''} onClick={() => void stage(text)}>
            {t('sh.import')}
          </button>
          {staged === null ? null : (
            <>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  onImport(staged.config);
                  setStaged(null);
                  setProblems([]);
                  setText('');
                }}
              >
                {t('ed.useImport')}
              </button>
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => {
                  setStaged(null);
                  setProblems([]);
                }}
              >
                {t('ed.discardImport')}
              </button>
            </>
          )}
        </div>

        {staged === null ? null : (
          <p className="sheet__diff t-meta num" data-staged="">
            <Icon name="check" /> {t('ed.staged')} ·{' '}
            {t('ed.importDiff', {
              sa: config.segments.length,
              sb: staged.config.segments.length,
              pa: config.speakers.length,
              pb: staged.config.speakers.length,
            })}
          </p>
        )}

        {problems.length === 0 ? null : (
          <>
            <h4 className="t-cap sheet__report-head">{t('sh.migrationReport')}</h4>
            <ul className="sheet__report t-meta">
              {problems.map((problem, i) => (
                <li key={`${problem.code}-${i}`} data-severity={problem.severity}>
                  {l10n(problem.message)}
                </li>
              ))}
            </ul>
          </>
        )}

        {staged === null && problems.some((p) => p.severity === 'error') ? (
          <p className="sheet__warn t-meta">{t('ed.importFailed')}</p>
        ) : null}
      </section>
    </Overlay>
  );
}
