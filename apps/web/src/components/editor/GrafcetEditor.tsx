import { useTranslation } from 'react-i18next';
import {
  newId,
  parseCondition,
  readOperandValue,
  stepTag,
  stepTimer,
  type Grafcet,
  type ParsedCondition,
  type Value,
} from '@ladder/core';
import { useProject } from '../../store/project.ts';
import { useSim } from '../../store/sim.ts';

const bitOf = (v: number | boolean | undefined) =>
  typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : false;

/** Live value of a transition condition (for highlighting a fireable transition). */
function conditionTrue(p: ParsedCondition, g: Grafcet, i: number, values: Record<string, Value>): boolean {
  if (!p.ok) return false;
  return p.groups.some((group) =>
    group.every((l) => {
      if (l.kind === 'true') return true;
      if (l.kind === 'time') return bitOf(readOperandValue(values, `${stepTimer(g, i)}.DN`));
      const v = bitOf(readOperandValue(values, l.operand));
      return l.negated ? !v : v;
    }),
  );
}

const splitActions = (text: string) =>
  text
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

export function GrafcetEditor({ grafcet: g }: { grafcet: Grafcet }) {
  const { t } = useTranslation();
  const readOnly = useProject((s) => s.sharedId !== null);
  const update = useProject((s) => s.updateGrafcet);
  const values = useSim((s) => s.snapshot?.values);
  const status = useSim((s) => s.status);
  const live = status !== 'stopped' && values;
  const edit = (fn: (x: Grafcet) => void) => update(g.id, fn);

  const insertAfter = (i: number) =>
    edit((x) => {
      x.steps.splice(i + 1, 0, { id: newId('s_'), actions: [] });
      x.transitions.splice(i + 1, 0, { id: newId('t_'), condition: '' });
      if (x.loopTo > i) x.loopTo++;
    });
  const removeStep = (i: number) =>
    edit((x) => {
      if (x.steps.length <= 2 || i === 0) return;
      x.steps.splice(i, 1);
      x.transitions.splice(i, 1);
      if (x.loopTo >= i) x.loopTo = Math.max(0, x.loopTo - 1);
    });

  return (
    <div className="grafcet" data-testid="grafcet">
      <div className="grafcet-head">
        <label className="field inline">
          <span>{t('grafcet.name')}</span>
          <input
            key={g.name}
            defaultValue={g.name}
            readOnly={readOnly}
            onBlur={(e) =>
              e.target.value.trim() &&
              e.target.value !== g.name &&
              edit((x) => void (x.name = e.target.value.trim()))
            }
          />
        </label>
        <span className="muted small">{t('grafcet.prefix', { prefix: g.prefix })}</span>
        <span className="grow" />
        <span className="muted small hide-narrow">{t('grafcet.help')}</span>
      </div>

      <ol className="grafcet-chart">
        {g.steps.map((step, i) => {
          const active = live && bitOf(values[stepTag(g, i)] as boolean | undefined);
          const tr = g.transitions[i];
          const parsed = parseCondition(tr?.condition ?? '');
          const fireable = live && active && conditionTrue(parsed, g, i, values);
          const to = i + 1 < g.steps.length ? i + 1 : g.loopTo;
          return (
            <li key={step.id} className="g-item">
              <div className="g-step-row">
                <div
                  className={`g-step${i === 0 ? ' initial' : ''}${active ? ' active' : ''}`}
                  data-testid={`g-step-${i}`}
                  aria-label={t(active ? 'grafcet.stepActive' : 'grafcet.step', { n: i })}
                >
                  {i}
                </div>
                <div className="g-actions">
                  <span className="g-actions-link" aria-hidden />
                  <input
                    key={step.actions.join(',')}
                    className="mono"
                    defaultValue={step.actions.join(', ')}
                    placeholder={t('grafcet.actionsPlaceholder')}
                    aria-label={t('grafcet.actions', { n: i })}
                    readOnly={readOnly}
                    data-testid={`g-actions-${i}`}
                    onBlur={(e) => {
                      const next = splitActions(e.target.value);
                      if (next.join() !== step.actions.join()) edit((x) => void (x.steps[i]!.actions = next));
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                  <input
                    key={`c-${step.comment ?? ''}`}
                    className="g-comment"
                    defaultValue={step.comment ?? ''}
                    placeholder={t('grafcet.comment')}
                    readOnly={readOnly}
                    onBlur={(e) =>
                      e.target.value !== (step.comment ?? '') &&
                      edit((x) => {
                        if (e.target.value.trim()) x.steps[i]!.comment = e.target.value.trim();
                        else delete x.steps[i]!.comment;
                      })
                    }
                  />
                </div>
                {!readOnly && (
                  <div className="g-tools">
                    <button className="small-btn" onClick={() => insertAfter(i)} data-testid={`g-add-${i}`}>
                      ＋ {t('grafcet.addStep')}
                    </button>
                    <button
                      className="icon danger"
                      disabled={i === 0 || g.steps.length <= 2}
                      onClick={() => removeStep(i)}
                      title={t('grafcet.removeStep', { n: i })}
                    >
                      🗑
                    </button>
                  </div>
                )}
              </div>
              {tr && (
                <div className={`g-transition${fireable ? ' fireable' : ''}`}>
                  <span className="g-bar" aria-hidden />
                  <span className="g-tnum">
                    ({i}→{to})
                  </span>
                  <input
                    key={tr.condition}
                    className="mono"
                    defaultValue={tr.condition}
                    placeholder={t('grafcet.conditionPlaceholder')}
                    aria-label={t('grafcet.condition', { from: i, to })}
                    readOnly={readOnly}
                    data-testid={`g-cond-${i}`}
                    onBlur={(e) =>
                      e.target.value !== tr.condition &&
                      edit((x) => void (x.transitions[i]!.condition = e.target.value))
                    }
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                  {!parsed.ok && (
                    <small className="error-text">
                      {t(`diag.grafcet_${parsed.error}`, {
                        term: parsed.term ?? '',
                        transition: i,
                        grafcet: g.name,
                      })}
                    </small>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="g-loop">
        ↺ {t('grafcet.loopTo')}{' '}
        <select
          value={g.loopTo}
          disabled={readOnly}
          onChange={(e) => edit((x) => void (x.loopTo = Number(e.target.value)))}
        >
          {g.steps.map((_, i) => (
            <option key={i} value={i}>
              {t('grafcet.step', { n: i })}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
