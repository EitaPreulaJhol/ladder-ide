import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  crossReference,
  familyCpu,
  getDialect,
  getFamily,
  ioList,
  tagAddress,
  validateProject,
  type XRef,
} from '@ladder/core';
import { useProject } from '../store/project.ts';
import { RungView } from './editor/RungView.tsx';

/** Printable documentation of the whole project (print / save as PDF from the browser). */
export function DocView() {
  const { t } = useTranslation();
  const project = useProject((s) => s.project);
  const xref = useMemo(() => crossReference(project), [project]);
  const io = useMemo(() => ioList(project), [project]);
  const diagnostics = useMemo(() => validateProject(project), [project]);
  const d = getDialect(project.dialect);
  const family = getFamily(project.hardware.family);
  const cpu = familyCpu(project.hardware);
  const rungLabel = (r: XRef) =>
    `${project.programs.length > 1 ? `${r.programName} ` : ''}R${r.rungIndex + 1}${r.access === 'read' ? '' : '*'}`;
  const errors = diagnostics.filter((x) => x.severity === 'error').length;

  return (
    <div className="view doc">
      <div className="view-head no-print">
        <h2>{t('doc.title')}</h2>
        <span className="grow" />
        <button className="primary" onClick={() => window.print()} data-testid="doc-print">
          🖨 {t('doc.print')}
        </button>
      </div>
      <p className="muted small no-print">{t('doc.help')}</p>

      <header className="doc-cover">
        <h1>{project.meta.name}</h1>
        {project.meta.description && <p>{project.meta.description}</p>}
        <dl>
          <dt>{t('doc.plc')}</dt>
          <dd>{family && cpu ? `${family.vendor} ${family.name} — ${cpu.name}` : t('hw.generic')}</dd>
          <dt>{t('top.dialect')}</dt>
          <dd>{d.name}</dd>
          <dt>{t('doc.programs')}</dt>
          <dd>
            {project.programs
              .map((p) => `${p.name}${p.kind === 'sub' ? ` (${t('doc.sub')})` : ''}`)
              .join(', ')}
          </dd>
          <dt>{t('doc.counts')}</dt>
          <dd>
            {t('doc.countsValue', {
              rungs: project.programs.reduce((a, p) => a + p.rungs.length, 0),
              tags: project.tags.length,
              io: io.filter((r) => r.tag).length,
            })}
          </dd>
          <dt>{t('doc.status')}</dt>
          <dd className={errors ? 'error-text' : ''}>
            {errors ? t('doc.withErrors', { n: errors }) : t('doc.noErrors')}
          </dd>
          <dt>{t('doc.generated')}</dt>
          <dd>{new Date().toLocaleString('pt-BR')}</dd>
        </dl>
      </header>

      {project.programs.map((prog) => (
        <section key={prog.id} className="doc-program">
          <h2>
            {prog.kind === 'sub' ? 'ƒ' : '▶'} {prog.name}
            <small className="muted"> — {prog.kind === 'sub' ? t('doc.sub') : t('doc.main')}</small>
          </h2>
          {prog.rungs.map((r, i) => (
            <div key={r.id} className="doc-rung">
              <RungView
                rung={r}
                index={i}
                project={project}
                snapshot={null}
                live={false}
                selection={null}
                cursor={null}
                readOnly
                minCols={7}
              />
            </div>
          ))}
        </section>
      ))}

      <section className="doc-section">
        <h2>{t('doc.tags')}</h2>
        <table className="grid doc-table">
          <thead>
            <tr>
              <th>{t('tags.name')}</th>
              <th>{t('tags.type')}</th>
              <th>{t('tags.address')}</th>
              <th>{t('tags.comment')}</th>
              <th>{t('doc.usedIn')}</th>
            </tr>
          </thead>
          <tbody>
            {project.tags.map((tg) => (
              <tr key={tg.name}>
                <td className="mono">{tg.name}</td>
                <td>{tg.type}</td>
                <td className="mono">{tagAddress(tg, project)}</td>
                <td>{tg.comment}</td>
                <td className="mono small">{(xref.get(tg.name) ?? []).map(rungLabel).join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">{t('doc.xrefLegend')}</p>
      </section>

      {io.length > 0 && (
        <section className="doc-section">
          <h2>{t('hw.ioList')}</h2>
          <table className="grid doc-table">
            <thead>
              <tr>
                <th>{t('hw.slot')}</th>
                <th>{t('hw.module')}</th>
                <th>{t('hw.channel')}</th>
                <th>{t('hw.address')}</th>
                <th>{t('hw.tag')}</th>
                <th>{t('hw.comment')}</th>
              </tr>
            </thead>
            <tbody>
              {io.map((r) => (
                <tr key={`${r.moduleId}:${r.channel}`} className={r.tag ? '' : 'unused'}>
                  <td>{r.slot}</td>
                  <td>{r.moduleName}</td>
                  <td>{r.channel}</td>
                  <td className="mono">{r.address}</td>
                  <td className="mono">{r.tag?.name ?? '—'}</td>
                  <td>{r.tag?.comment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
