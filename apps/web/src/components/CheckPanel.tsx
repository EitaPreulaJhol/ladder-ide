import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { runScenarioChecks, type CheckResult, type Project } from '@ladder/core';
import { useProject } from '../store/project.ts';
import { useSim } from '../store/sim.ts';
import { formatMs } from './editor/format.ts';

/** "Verificar solução": runs the scenario checks on an isolated, accelerated simulation. */
export function CheckPanel({ scenarioId }: { scenarioId: string }) {
  const { t } = useTranslation();
  const project = useProject((s) => s.project);
  const showCapture = useSim((s) => s.showCapture);
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<{ results: CheckResult[]; project: Project; scenarioId: string } | null>(
    null,
  );

  const check = () => {
    setBusy(true);
    // Let the button repaint before the (synchronous, ~100 ms) simulation.
    setTimeout(() => {
      try {
        setRun({ results: runScenarioChecks(project, scenarioId), project, scenarioId });
      } finally {
        setBusy(false);
      }
    }, 20);
  };

  const current = run && run.scenarioId === scenarioId ? run : null;
  const stale =
    current && (current.project.programs !== project.programs || current.project.tags !== project.tags);
  const passed = current?.results.filter((r) => r.passed).length ?? 0;
  const total = current?.results.length ?? 0;

  return (
    <section className="checks">
      <div className="checks-head">
        <button className="primary" onClick={check} disabled={busy} data-testid="run-checks">
          {busy ? t('checks.running') : t('checks.run')}
        </button>
        {current && (
          <span className={passed === total ? 'checks-score ok' : 'checks-score'} data-testid="checks-score">
            {passed === total ? '✓ ' : ''}
            {t('checks.score', { passed, total })}
          </span>
        )}
      </div>
      {!current && <p className="muted small">{t('checks.help')}</p>}
      {stale && <p className="small warn-text">{t('checks.stale')}</p>}
      {current && (
        <ul className="check-list">
          {current.results.map((r) => (
            <li key={r.id} className={r.passed ? 'pass' : 'fail'} data-testid={`check-${r.id}`}>
              <span className="check-icon" aria-hidden>
                {r.passed ? '✓' : '✗'}
              </span>
              <div className="check-body">
                <span>
                  <span className="sr-only">{r.passed ? t('checks.passed') : t('checks.failed')}: </span>
                  {t(`checks.${scenarioId}.${r.id}`)}
                </span>
                {r.failure && (
                  <small>
                    {t(`check.${r.failure.code}`, r.failure.params)} · t = {formatMs(r.failure.atMs)}
                  </small>
                )}
              </div>
              <button
                className="link"
                onClick={() => showCapture({ scenarioId, result: r })}
                data-testid={`check-trace-${r.id}`}
              >
                {t('checks.showTrace')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
