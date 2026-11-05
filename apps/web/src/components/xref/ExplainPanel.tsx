import { useTranslation } from 'react-i18next';
import { explainTag, getDialect, type ExplainStep, type Explanation, type Project } from '@ladder/core';
import { useProject } from '../../store/project.ts';
import { useSim } from '../../store/sim.ts';
import { useUi } from '../../store/ui.ts';
import { goToElement } from '../../navigation.ts';
import { displayOperand, formatValue } from '../editor/format.ts';

/** Explanation for the tag in `useUi().explain`, recomputed from the live snapshot. */
export function useExplanation(): Explanation | null {
  const tag = useUi((s) => s.explain);
  const project = useProject((s) => s.project);
  const snapshot = useSim((s) => s.snapshot);
  const status = useSim((s) => s.status);
  if (!tag || !snapshot || status === 'stopped' || !project.tags.some((t) => t.name === tag)) return null;
  return explainTag(project, snapshot, tag);
}

/** Marks for the rung view: elements on the explained path. */
export function explainMarks(e: Explanation | null): Map<string, 'ok' | 'block' | 'idle' | 'target'> {
  const m = new Map<string, 'ok' | 'block' | 'idle' | 'target'>();
  const path = e?.paths[0];
  if (!path) return m;
  for (const s of path.steps)
    if (s.instr !== 'PAR') m.set(s.elementId, s.ok === true ? 'ok' : s.ok === false ? 'block' : 'idle');
  m.set(path.ref.elementId, 'target');
  return m;
}

function StepRow({
  step,
  project,
  blocking,
  programId,
  rungId,
}: {
  step: ExplainStep;
  project: Project;
  blocking: boolean;
  programId: string;
  rungId: string;
}) {
  const { t } = useTranslation();
  const d = getDialect(project.dialect);
  const icon = step.ok === true ? '✓' : step.ok === false ? '✗' : '–';
  const cls = step.ok === true ? 'ok' : step.ok === false ? 'block' : 'idle';
  return (
    <li className={`explain-step ${cls}`} style={{ paddingLeft: 4 + step.depth * 16 }}>
      <span className="explain-icon" aria-label={t(`explain.state.${cls}`)}>
        {icon}
      </span>
      {step.instr === 'PAR' ? (
        <span>{t('explain.branch')}</span>
      ) : (
        <button className="link" onClick={() => goToElement(programId, rungId, step.elementId)}>
          <span className="mono">{d.mnemonic(step.instr)}</span>{' '}
          <span className="mono">{displayOperand(step.operand, project)}</span>
          {step.value !== undefined && <span className="muted"> = {formatValue(step.value)}</span>}
        </button>
      )}
      {blocking && <strong className="explain-blocker"> ← {t('explain.blocksHere')}</strong>}
    </li>
  );
}

export function ExplainPanel() {
  const { t } = useTranslation();
  const tag = useUi((s) => s.explain);
  const setExplain = useUi((s) => s.setExplain);
  const project = useProject((s) => s.project);
  const status = useSim((s) => s.status);
  const e = useExplanation();
  if (!tag) return null;
  const d = getDialect(project.dialect);

  return (
    <section className="explain" aria-live="polite" data-testid="explain">
      <div className="explain-head">
        <strong>{t('explain.title', { tag })}</strong>
        <button className="icon" onClick={() => setExplain(null)} aria-label={t('explain.close')}>
          ×
        </button>
      </div>
      {!e ? (
        <p className="muted small">
          {status === 'stopped' ? t('explain.needsRun') : t('explain.unknownTag')}
        </p>
      ) : (
        <>
          <p className="explain-value">
            <span className="mono">{tag}</span> = <strong className="mono">{formatValue(e.value)}</strong>
          </p>
          <p className="small">
            {e.source === 'program' && e.lastWriter
              ? t('explain.source.program', {
                  n: e.lastWriter.rungIndex + 1,
                  instr: d.mnemonic(e.lastWriter.instr),
                })
              : t(`explain.source.${e.source}`)}
          </p>
          {e.duplicateCoils && <p className="small warn-text">⚠ {t('explain.duplicateCoils')}</p>}
          {e.paths.map((p, i) => (
            <div key={p.ref.elementId} className="explain-path">
              <div className="small">
                <button
                  className="link"
                  onClick={() => goToElement(p.ref.programId, p.ref.rungId, p.ref.elementId)}
                >
                  {t('bottom.rung', { n: p.ref.rungIndex + 1 })} ·{' '}
                  <span className="mono">{d.mnemonic(p.ref.instr)}</span>
                </button>{' '}
                <span className={p.powered ? 'badge-on' : 'badge-off'}>
                  {p.powered ? t('explain.powered') : t('explain.unpowered')}
                </span>
                {i === 0 && e.lastWriter?.elementId === p.ref.elementId && (
                  <span className="muted"> · {t('explain.lastWriter')}</span>
                )}
              </div>
              {p.steps.length === 0 ? (
                <p className="muted small">{t('explain.directRail')}</p>
              ) : (
                <ul className="explain-steps">
                  {p.steps.map((s) => (
                    <StepRow
                      key={s.elementId}
                      step={s}
                      project={project}
                      blocking={s.elementId === p.blockedBy}
                      programId={p.ref.programId}
                      rungId={p.ref.rungId}
                    />
                  ))}
                </ul>
              )}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
