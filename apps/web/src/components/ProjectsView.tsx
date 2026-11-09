import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DIALECTS, DIALECT_IDS, getDialect, type Project, exportPlcopen } from '@ladder/core';
import { useProject } from '../store/project.ts';
import {
  deleteProject,
  downloadText,
  listProjects,
  listTrash,
  loadProject,
  restoreProject,
  safeFileName,
  trashProject,
  TRASH_DAYS,
  type StoredProject,
} from '../storage/db.ts';
import {
  blankProject,
  exampleProject,
  importProjectFile,
  openNewProject,
  openProject,
  renameProject,
} from '../session.ts';
import { LANGUAGES, locale, setLanguage, type Language } from '../i18n.ts';
import { confirmDialog } from './ConfirmDialog.tsx';
import { toast } from '../store/toast.ts';
import { ExampleGrid } from './ExampleGrid.tsx';

export function ProjectsView() {
  const { t, i18n } = useTranslation();
  const project = useProject((s) => s.project);
  const readOnly = useProject((s) => s.sharedId !== null);
  const update = useProject((s) => s.update);
  const [list, setList] = useState<StoredProject[]>([]);
  const [trash, setTrash] = useState<StoredProject[]>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    void listProjects().then(setList);
    void listTrash().then(setTrash);
  };
  useEffect(refresh, [project.id]);

  const open = async (p: Project) => {
    await openNewProject(p);
    refresh();
  };

  const moveToTrash = async (p: StoredProject) => {
    await trashProject(p.id);
    refresh();
    toast(t('projects.trashed', { name: p.name }), {
      kind: 'success',
      detail: t('projects.trashHint', { count: TRASH_DAYS }),
      action: {
        label: t('common.undo'),
        run: () => void restoreProject(p.id).then(refresh),
      },
    });
  };

  const restore = async (p: StoredProject) => {
    await restoreProject(p.id);
    refresh();
    toast(t('projects.restored', { name: p.name }), { kind: 'success' });
  };

  const deleteForever = async (p: StoredProject) => {
    if (!(await confirmDialog(t('projects.deleteForeverConfirm', { name: p.name }), { danger: true })))
      return;
    await deleteProject(p.id);
    refresh();
  };

  const emptyTrash = async () => {
    if (!(await confirmDialog(t('projects.emptyTrashConfirm', { count: trash.length }), { danger: true })))
      return;
    for (const p of trash) await deleteProject(p.id);
    refresh();
  };

  const onImport = async (file: File) => {
    setImportWarnings([]);
    const warnings = await importProjectFile(file);
    if (warnings) setImportWarnings(warnings);
    refresh();
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
                onBlur={(e) => void renameProject(e.target.value)}
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
          <button onClick={() => open(blankProject(project.dialect))} data-testid="new-project">
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
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Clear it, so importing the same file again still fires onChange.
              e.target.value = '';
              if (file) void onImport(file);
            }}
          />
        </div>
        <p className="muted small">{t('projects.privacy')}</p>
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
                <button className="danger" onClick={() => void moveToTrash(p)} data-testid="project-delete">
                  {t('projects.delete')}
                </button>
              )}
            </li>
          ))}
        </ul>
        {trash.length > 0 && (
          <details className="trash" data-testid="trash">
            <summary>{t('projects.trash', { count: trash.length })}</summary>
            <p className="muted small">{t('projects.trashHint', { count: TRASH_DAYS })}</p>
            <ul className="project-list">
              {trash.map((p) => (
                <li key={p.id}>
                  <div>
                    <strong>{p.name}</strong>
                    <div className="muted small">
                      {t('projects.deletedOn', { date: new Date(p.deletedAt!).toLocaleString(locale()) })}
                    </div>
                  </div>
                  <span className="grow" />
                  <button onClick={() => void restore(p)} data-testid="project-restore">
                    {t('projects.restore')}
                  </button>
                  <button className="danger" onClick={() => void deleteForever(p)}>
                    {t('projects.deleteForever')}
                  </button>
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <button className="danger" onClick={() => void emptyTrash()}>
                {t('projects.emptyTrash')}
              </button>
            </div>
          </details>
        )}
      </section>

      <section className="card">
        <h3>{t('projects.examples')}</h3>
        <ExampleGrid
          onOpen={(id) => void open(exampleProject(id, project.dialect))}
          testIdPrefix="example-"
        />
      </section>
    </div>
  );
}
