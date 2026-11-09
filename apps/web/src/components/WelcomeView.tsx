import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getDialect } from '@ladder/core';
import { useProject } from '../store/project.ts';
import { useUi } from '../store/ui.ts';
import { lastProjectId, listProjects, loadProject, type StoredProject } from '../storage/db.ts';
import { blankProject, exampleProject, importProjectFile, openNewProject, openProject } from '../session.ts';
import { LANGUAGES, locale, setLanguage, type Language } from '../i18n.ts';
import { getThemePref, NEXT_THEME, setThemePref, THEME_ICON, type ThemePref } from '../theme.ts';
import { toast } from '../store/toast.ts';
import { ExampleGrid } from './ExampleGrid.tsx';

/**
 * First screen: continue where you left off, start a blank project, open a file
 * (button or drag and drop), pick a project saved in this browser, or an example.
 */
export function WelcomeView() {
  const { t, i18n } = useTranslation();
  // Back here from the logo: the open project is still in memory (with its undo history).
  const current = useProject((s) => s.project);
  const [saved, setSaved] = useState<StoredProject[] | null>(null);
  const [theme, setTheme] = useState<ThemePref>(getThemePref);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listProjects()
      .then(setSaved)
      .catch(() => setSaved([]));
  }, []);

  const last = current ? null : (saved?.find((p) => p.id === lastProjectId()) ?? null);
  const resumeName = current?.meta.name ?? last?.name;
  const resumeId = current?.id ?? last?.id;

  const resume = async () => {
    if (current) return useUi.getState().setWelcome(false);
    if (last) await openSaved(last);
  };
  const openSaved = async (p: StoredProject) => {
    if (current?.id === p.id) return useUi.getState().setWelcome(false);
    const loaded = await loadProject(p.id).catch(() => null);
    if (loaded) openProject(loaded);
    else toast(t('welcome.openFailed', { name: p.name }), { kind: 'error' });
  };
  const openFile = (file: File | undefined) => file && void importProjectFile(file);

  return (
    <div
      className={`welcome${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        openFile(e.dataTransfer.files[0]);
      }}
      data-testid="welcome"
    >
      <header className="welcome-head">
        <img src="/favicon.svg" alt="" width={40} height={40} />
        <div>
          <h1>{t('app.title')}</h1>
          <p className="muted">{t('app.tagline')}</p>
        </div>
        <span className="grow" />
        <span className="welcome-prefs">
          <select
            className="lang-select"
            value={i18n.language}
            onChange={(e) => setLanguage(e.target.value as Language)}
            aria-label={t('top.language')}
            data-testid="welcome-language"
          >
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          <button
            className="icon"
            title={t('top.theme', { mode: t(`top.theme_${theme}`) })}
            aria-label={t('top.theme', { mode: t(`top.theme_${theme}`) })}
            onClick={() => {
              const next = NEXT_THEME[theme];
              setThemePref(next);
              setTheme(next);
            }}
          >
            {THEME_ICON[theme]}
          </button>
        </span>
      </header>

      <main className="welcome-main">
        <section className="welcome-start">
          <h2>{t('welcome.start')}</h2>
          {resumeName && (
            <button
              className="welcome-action primary"
              onClick={() => void resume()}
              data-testid="welcome-continue"
            >
              <span className="welcome-icon">▶</span>
              <span>
                <strong>{t('welcome.continue', { name: resumeName })}</strong>
                <small>{t('welcome.continueHint')}</small>
              </span>
            </button>
          )}
          <button
            className={`welcome-action${resumeName ? '' : ' primary'}`}
            onClick={() => void openNewProject(blankProject())}
            data-testid="welcome-new"
          >
            <span className="welcome-icon">＋</span>
            <span>
              <strong>{t('welcome.new')}</strong>
              <small>{t('welcome.newHint')}</small>
            </span>
          </button>
          <button
            className="welcome-action"
            onClick={() => fileRef.current?.click()}
            data-testid="welcome-open"
          >
            <span className="welcome-icon">📂</span>
            <span>
              <strong>{t('welcome.open')}</strong>
              <small>{t('welcome.openHint')}</small>
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.xml,application/json,text/xml,application/xml"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              openFile(file);
            }}
            data-testid="welcome-file"
          />
        </section>

        <section className="welcome-saved">
          <h2>{t('welcome.saved')}</h2>
          {saved && saved.length === 0 && <p className="muted">{t('welcome.noSaved')}</p>}
          <ul className="welcome-list">
            {saved?.map((p) => (
              <li key={p.id}>
                <button onClick={() => void openSaved(p)} data-testid="welcome-saved-project">
                  <strong>
                    {p.name} {p.id === resumeId && <span className="badge">{t('projects.current')}</span>}
                  </strong>
                  <small className="muted">
                    {getDialect(p.project.dialect).name} ·{' '}
                    {t('projects.updated', { date: new Date(p.updatedAt).toLocaleString(locale()) })}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          <p className="muted small">{t('projects.privacy')}</p>
        </section>

        <section className="welcome-examples">
          <h2>{t('projects.examples')}</h2>
          <ExampleGrid
            onOpen={(id) => void openNewProject(exampleProject(id))}
            testIdPrefix="welcome-example-"
          />
        </section>
      </main>

      {dragging && (
        // Covers the page while dragging, so leaving the window is a single event on it.
        <div className="welcome-drop" aria-hidden="true" onDragLeave={() => setDragging(false)}>
          {t('welcome.drop')}
        </div>
      )}
    </div>
  );
}
