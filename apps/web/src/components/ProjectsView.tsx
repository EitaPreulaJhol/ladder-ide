import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createProject,
  DIALECTS,
  DIALECT_IDS,
  EXAMPLES,
  forkProject,
  getDialect,
  parseProject,
  type Project,
  exportPlcopen,
  importPlcopen,
} from '@ladder/core';
import { useProject } from '../store/project.ts';
import {
  deleteProject,
  downloadText,
  listProjects,
  loadProject,
  safeFileName,
  saveProject,
  type StoredProject,
} from '../storage/db.ts';
import { openProject } from '../session.ts';
import { LANGUAGES, locale, setLanguage, type Language } from '../i18n.ts';

export function ProjectsView() {
  const { t, i18n } = useTranslation();
  const project = useProject((s) => s.project);
  const readOnly = useProject((s) => s.sharedId !== null);
  const update = useProject((s) => s.update);
  const [list, setList] = useState<StoredProject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => void listProjects().then(setList);
  useEffect(refresh, [project.id]);

  const open = async (p: Project) => {
    await saveProject(p);
    openProject(p);
    refresh();
  };

  const onImport = async (file: File) => {
    try {
      const text = await file.text();
      setImportWarnings([]);
      if (text.trimStart().startsWith('<')) {
        // PLCopen XML (TC6) from another IEC 61131-3 tool.
        const { project: imported, warnings } = importPlcopen(text);
        // Same invariants as a JSON import (tag names, limits) before it reaches the editor.
        const r = parseProject(imported);
        if (!r.ok) throw new Error(r.error);
        await open(r.project);
        setImportWarnings(warnings);
      } else {
        const r = parseProject(JSON.parse(text));
        if (!r.ok) throw new Error(r.error);
        await open(forkProject(r.project));
      }
      setError(null);
    } catch (e) {
      setError(t('projects.importError', { error: (e as Error).message }));
    }
  };

  return (
    <div className="view projects">
      {!readOnly && (
        <section className="card">
          <h3>{t('projects.settings')}</h3>
          <div className="settings-grid">
            <label className="field">
              <span>{t('top.projectName')}</span>
              <input
                key={project.id + project.meta.name}
                defaultValue={project.meta.name}
                onBlur={(e) => update((d) => void (d.meta.name = e.target.value || 'Sem nome'))}
              />
            </label>
            <label className="field">
              <span>{t('top.dialect')}</span>
              <select
                value={project.dialect}
                disabled={project.hardware.family !== 'generic'}
                title={project.hardware.family !== 'generic' ? t('top.dialectLocked') : undefined}
                onChange={(e) => update((d) => void (d.dialect = e.target.value as Project['dialect']))}
              >
                {DIALECT_IDS.map((id) => (
                  <option key={id} value={id}>
                    {DIALECTS[id].name} — {DIALECTS[id].family}
                  </option>
                ))}
              </select>
              <small className="muted">{t('projects.dialectHelp')}</small>
            </label>
            <label className="field">
              <span>{t('projects.language')}</span>
              <select value={i18n.language} onChange={(e) => setLanguage(e.target.value as Language)}>
                {LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
              {i18n.language !== 'pt-BR' && <small className="muted">{t('projects.contentNote')}</small>}
            </label>
            <label className="field">
              <span>{t('projects.scanTime')}</span>
              <input
                type="number"
                min={1}
                max={1000}
                defaultValue={project.sim.scanTimeMs}
                key={project.id}
                onBlur={(e) => {
                  const v = Math.round(Number(e.target.value));
                  if (v >= 1 && v <= 1000) update((d) => void (d.sim.scanTimeMs = v));
                }}
              />
            </label>
            <label className="field wide">
              <span>{t('projects.description')}</span>
              <textarea
                key={project.id}
                defaultValue={project.meta.description ?? ''}
                rows={2}
                onBlur={(e) => update((d) => void (d.meta.description = e.target.value || undefined))}
              />
            </label>
          </div>
        </section>
      )}

      <section className="card">
        <div className="view-head">
          <h3>{t('projects.local')}</h3>
          <span className="grow" />
          <button
            onClick={() => open(createProject(t('projects.new'), project.dialect))}
            data-testid="new-project"
          >
            ＋ {t('projects.new')}
          </button>
          <button onClick={() => fileRef.current?.click()}>{t('projects.import')}</button>
          <button
            onClick={() =>
              downloadText(
                `${safeFileName(project.meta.name)}.plcopen.xml`,
                exportPlcopen(project),
                'application/xml',
              )
            }
            title={t('projects.exportPlcopenHint')}
            data-testid="export-plcopen"
          >
            {t('projects.exportPlcopen')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.xml,application/json,text/xml,application/xml"
            hidden
            onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])}
          />
        </div>
        <p className="muted small">{t('projects.privacy')}</p>
        {error && <p className="error-text">{error}</p>}
        {importWarnings.length > 0 && (
          <div className="notice warn" data-testid="import-warnings">
            <strong>{t('projects.importWarnings', { n: importWarnings.length })}</strong>
            <ul>
              {importWarnings.slice(0, 30).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {list.length === 0 && <p className="muted">{t('projects.empty')}</p>}
        <ul className="project-list">
          {list.map((p) => (
            <li key={p.id} className={p.id === project.id ? 'current' : ''}>
              <div>
                <strong>{p.name}</strong>{' '}
                {p.id === project.id && <span className="badge">{t('projects.current')}</span>}
                <div className="muted small">
                  {getDialect(p.project.dialect).name} ·{' '}
                  {t('projects.updated', { date: new Date(p.updatedAt).toLocaleString(locale()) })}
                </div>
              </div>
              <span className="grow" />
              {p.id !== project.id && (
                <button
                  onClick={async () => {
                    const loaded = await loadProject(p.id);
                    if (loaded) openProject(loaded);
                  }}
                >
                  {t('projects.open')}
                </button>
              )}
              {p.id !== project.id && (
                <button
                  className="danger"
                  onClick={async () => {
                    if (!confirm(t('projects.deleteConfirm', { name: p.name }))) return;
                    await deleteProject(p.id);
                    refresh();
                  }}
                >
                  {t('projects.delete')}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h3>{t('projects.examples')}</h3>
        <div className="example-grid">
          {EXAMPLES.map((ex) => {
            const sc = ex.id.startsWith('scenario:') ? ex.id.slice(9) : null;
            return (
              <div key={ex.id} className="scenario-card">
                <strong>{sc ? t(`plant.${sc}.title`) : t(`projects.ex.${ex.id}`)}</strong>
                {sc && <p className="muted small">{t(`plant.${sc}.summary`)}</p>}
                <button
                  data-testid={`example-${ex.id}`}
                  onClick={() => {
                    const p = ex.build();
                    p.dialect = project.dialect;
                    if (sc) p.meta.name = t(`plant.${sc}.title`);
                    void open(p);
                  }}
                >
                  {t('projects.useExample')}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
