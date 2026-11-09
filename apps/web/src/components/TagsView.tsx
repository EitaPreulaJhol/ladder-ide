import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  channelAddress,
  getDialect,
  ioList,
  isValidTagName,
  renameTag,
  tagAddress,
  tagsCsv,
  crossReference,
  type DataType,
  type Tag,
} from '@ladder/core';
import { useProject } from '../store/project.ts';
import { toast } from '../store/toast.ts';
import { updateWithUndo } from '../store/undoable.ts';
import { XRefList } from './xref/XRefList.tsx';
import { downloadText, safeFileName } from '../storage/db.ts';

const TYPES: DataType[] = ['BOOL', 'INT', 'DINT', 'REAL', 'TIMER', 'COUNTER'];
const EXAMPLE_ADDR = { iec: '%MX0.0', siemens: 'M0.0', ab: 'B3:0/0', schneider: '%M0', haiwell: 'M0' };

export function TagsView() {
  const { t } = useTranslation();
  const project = useProject((s) => s.project);
  const readOnly = useProject((s) => s.sharedId !== null);
  const update = useProject((s) => s.update);
  const xref = useMemo(() => crossReference(project), [project]);
  const [openRefs, setOpenRefs] = useState<string | null>(null);
  const rows = useMemo(() => ioList(project), [project]);
  /** Why a tag name is refused (null when it is fine). */
  const nameProblem = (name: string, current: string) =>
    !isValidTagName(name)
      ? t('tags.invalidName')
      : project.tags.some((x) => x.name === name && x.name !== current)
        ? t('tags.nameTaken', { name })
        : null;

  const addTag = () => {
    let i = 1;
    while (project.tags.some((tg) => tg.name === `TAG_${i}`)) i++;
    update((d) => {
      d.tags.push({ name: `TAG_${i}`, type: 'BOOL' });
    });
  };

  const edit = (name: string, fn: (tg: Tag) => void) =>
    update((d) => {
      const tg = d.tags.find((x) => x.name === name);
      if (tg) fn(tg);
    });

  return (
    <div className="view">
      <div className="view-head">
        <h2>{t('tags.title')}</h2>
        <span className="grow" />
        {!readOnly && (
          <button onClick={addTag} data-testid="add-tag">
            ＋ {t('tags.add')}
          </button>
        )}
        <button
          onClick={() =>
            downloadText(`${safeFileName(project.meta.name)}-tags.csv`, tagsCsv(project), 'text/csv')
          }
        >
          {t('tags.exportCsv')}
        </button>
      </div>
      <p className="muted small">{t('tags.help')}</p>
      <table className="grid tags-table">
        <thead>
          <tr>
            <th>{t('tags.name')}</th>
            <th>{t('tags.type')}</th>
            <th>{t('tags.io')}</th>
            <th>{t('tags.address')}</th>
            <th>{t('tags.initial')}</th>
            <th>{t('tags.comment')}</th>
            <th>{t('tags.inUse')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {project.tags.map((tg) => (
            <Fragment key={tg.name}>
              <tr>
                <td>
                  <input
                    className="mono"
                    defaultValue={tg.name}
                    readOnly={readOnly}
                    key={tg.name}
                    aria-label={t('tags.name')}
                    onChange={(e) => {
                      // Flag the problem while typing; the name is only refused on leaving the field.
                      const problem = nameProblem(e.target.value.trim(), tg.name);
                      e.target.setAttribute('aria-invalid', String(!!problem));
                      e.target.title = problem ?? '';
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      e.target.removeAttribute('aria-invalid');
                      e.target.title = '';
                      if (v === tg.name) return;
                      const problem = nameProblem(v, tg.name);
                      if (problem) {
                        toast(problem, { kind: 'error', detail: t('tags.nameKept', { name: tg.name }) });
                        e.target.value = tg.name;
                        return;
                      }
                      update((d) => renameTag(d, tg.name, v));
                    }}
                  />
                </td>
                <td>
                  <select
                    value={tg.type}
                    disabled={readOnly}
                    onChange={(e) =>
                      edit(tg.name, (x) => {
                        x.type = e.target.value as DataType;
                        delete x.initial;
                      })
                    }
                  >
                    {TYPES.map((ty) => (
                      <option key={ty}>{ty}</option>
                    ))}
                  </select>
                </td>
                <td>
                  {(tg.type === 'BOOL' || tg.type === 'INT') && (
                    <select
                      disabled={readOnly}
                      value={tg.io ? `${tg.io.module}:${tg.io.channel}` : ''}
                      onChange={(e) =>
                        edit(tg.name, (x) => {
                          if (!e.target.value) delete x.io;
                          else {
                            const [module, ch] = e.target.value.split(':');
                            x.io = { module: module!, channel: Number(ch) };
                            delete x.address;
                          }
                        })
                      }
                    >
                      <option value="">{t('tags.noIo')}</option>
                      {rows
                        .filter((r) =>
                          tg.type === 'BOOL'
                            ? r.kind === 'DI' || r.kind === 'DO'
                            : r.kind === 'AI' || r.kind === 'AO',
                        )
                        .filter((r) => !r.tag || r.tag.name === tg.name)
                        .map((r) => (
                          <option key={`${r.moduleId}:${r.channel}`} value={`${r.moduleId}:${r.channel}`}>
                            {channelAddress(project.hardware, r.moduleId, r.channel, project.dialect)} —{' '}
                            {r.kind} slot {r.slot} ch {r.channel}
                          </option>
                        ))}
                    </select>
                  )}
                </td>
                <td>
                  {tg.io ? (
                    <span className="mono muted">{tagAddress(tg, project)}</span>
                  ) : (
                    <input
                      className="mono"
                      key={`${tg.name}-${project.dialect}-${tagAddress(tg, project)}`}
                      defaultValue={tagAddress(tg, project)}
                      placeholder={EXAMPLE_ADDR[project.dialect]}
                      title={t('tags.addressHint', { example: EXAMPLE_ADDR[project.dialect] })}
                      readOnly={readOnly}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v === tagAddress(tg, project)) return;
                        if (!v) return edit(tg.name, (x) => delete x.address);
                        const parsed = getDialect(project.dialect).parseAddress(v);
                        if (!parsed) {
                          toast(t('tags.invalidAddress', { dialect: getDialect(project.dialect).name }), {
                            kind: 'error',
                            detail: t('tags.addressHint', { example: EXAMPLE_ADDR[project.dialect] }),
                          });
                          e.target.value = tagAddress(tg, project);
                          return;
                        }
                        edit(tg.name, (x) => (x.address = parsed.address));
                      }}
                    />
                  )}
                </td>
                <td>
                  {tg.type === 'BOOL' ? (
                    <input
                      type="checkbox"
                      checked={Boolean(tg.initial)}
                      disabled={readOnly}
                      onChange={(e) => edit(tg.name, (x) => (x.initial = e.target.checked))}
                    />
                  ) : tg.type === 'TIMER' || tg.type === 'COUNTER' ? null : (
                    <input
                      type="number"
                      className="num"
                      defaultValue={typeof tg.initial === 'number' ? tg.initial : 0}
                      readOnly={readOnly}
                      onBlur={(e) => edit(tg.name, (x) => (x.initial = Number(e.target.value)))}
                    />
                  )}
                </td>
                <td>
                  <input
                    defaultValue={tg.comment ?? ''}
                    readOnly={readOnly}
                    onBlur={(e) => edit(tg.name, (x) => (x.comment = e.target.value))}
                  />
                </td>
                <td>
                  <button
                    className="link"
                    onClick={() => setOpenRefs(openRefs === tg.name ? null : tg.name)}
                    aria-expanded={openRefs === tg.name}
                    data-testid={`xref-${tg.name}`}
                  >
                    {(xref.get(tg.name) ?? []).length || t('tags.unused')}
                  </button>
                </td>
                <td>
                  {!readOnly && (
                    <button
                      className="icon danger"
                      title={t('tags.delete')}
                      onClick={() => {
                        const uses = (xref.get(tg.name) ?? []).length;
                        updateWithUndo((d) => void (d.tags = d.tags.filter((x) => x.name !== tg.name)), {
                          message: t('tags.deleted', { name: tg.name }),
                          // References stay in the program and become errors: say so right away.
                          detail: uses ? t('tags.deletedInUse', { count: uses }) : undefined,
                        });
                      }}
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
              {openRefs === tg.name && (
                <tr className="xref-row">
                  <td colSpan={8}>
                    <XRefList refs={xref.get(tg.name) ?? []} project={project} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
