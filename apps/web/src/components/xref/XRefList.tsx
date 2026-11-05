import { useTranslation } from 'react-i18next';
import { getDialect, type Project, type XRef } from '@ladder/core';
import { goToElement } from '../../navigation.ts';

const ACCESS_ICON = { read: '◁', write: '▷', readWrite: '◁▷' } as const;

/** Clickable list of the places where a tag is read and written. */
export function XRefList({
  refs,
  project,
  currentElementId,
}: {
  refs: XRef[];
  project: Project;
  currentElementId?: string;
}) {
  const { t } = useTranslation();
  const d = getDialect(project.dialect);
  const multiProgram = project.programs.length > 1;
  if (!refs.length) return <p className="muted small">{t('xref.none')}</p>;
  return (
    <ul className="xref-list">
      {refs.map((r) => (
        <li
          key={`${r.elementId}:${r.operandIndex}`}
          className={r.elementId === currentElementId ? 'current' : ''}
        >
          <button className="link" onClick={() => goToElement(r.programId, r.rungId, r.elementId)}>
            <span className={`xref-access ${r.access}`} aria-hidden>
              {ACCESS_ICON[r.access]}
            </span>
            {multiProgram ? `${r.programName} · ` : ''}
            {t('bottom.rung', { n: r.rungIndex + 1 })} · <span className="mono">{d.mnemonic(r.instr)}</span>{' '}
            <span className="mono">{r.operand}</span>
            <span className="muted"> — {t(`xref.${r.access}`)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function xrefSummary(refs: XRef[], t: (k: string, o?: Record<string, unknown>) => string): string {
  const r = refs.filter((x) => x.access !== 'write').length;
  const w = refs.filter((x) => x.access !== 'read').length;
  return t('xref.summary', { reads: r, writes: w });
}
