import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toCsv, type TrendEvent } from '@ladder/core';
import { useProject } from '../../store/project.ts';
import { liveTrend, useSim } from '../../store/sim.ts';
import { downloadText, safeFileName } from '../../storage/db.ts';
import { displayOperand, formatMs } from '../editor/format.ts';
import { formatTrendValue, TrendChart, valueAt, type TrendSeries } from './TrendChart.tsx';

const WINDOWS = [5_000, 10_000, 30_000, 60_000];

/** Signals offered in the "add" list: plain tags plus the useful timer/counter members. */
export function signalsForTag(name: string, type: string): string[] {
  return type === 'TIMER' || type === 'COUNTER' ? [`${name}.DN`, `${name}.ACC`] : [name];
}

/** Timer accumulators/presets are milliseconds: show them as time. */
function formatterFor(signal: string, project: { tags: { name: string; type: string }[] }) {
  const [name, member] = signal.split('.');
  const tag = project.tags.find((t) => t.name === name);
  if (tag?.type === 'TIMER' && member && /^(ACC|ET|PRE|PT)$/i.test(member))
    return (v: number | boolean) => formatMs(Number(v));
  return undefined;
}

function toCsvRows(series: TrendSeries[], start: number, end: number): string {
  const times = new Set<number>([start]);
  for (const s of series) for (const [tm] of s.events) if (tm >= start && tm <= end) times.add(tm);
  const sorted = [...times].sort((a, b) => a - b);
  return toCsv(
    ['t (ms)', ...series.map((s) => s.label)],
    sorted.map((tm) => [tm, ...series.map((s) => formatTrendValue(valueAt(s.events, tm)))]),
  );
}

export function TrendPanel() {
  const { t } = useTranslation();
  const project = useProject((s) => s.project);
  const setTrend = useProject((s) => s.setTrend);
  useSim((s) => s.trendVersion); // re-render on new data
  const capture = useSim((s) => s.capture);
  const showCapture = useSim((s) => s.showCapture);
  const [windowMs, setWindowMs] = useState(10_000);
  const signals = useMemo(() => project.trend ?? [], [project.trend]);

  const options = useMemo(
    () => project.tags.flatMap((tg) => signalsForTag(tg.name, tg.type)).filter((s) => !signals.includes(s)),
    [project.tags, signals],
  );

  let series: TrendSeries[];
  let start: number;
  let end: number;
  if (capture) {
    const tr = capture.result.trace;
    series = tr.signals.map((s) => ({
      signal: s,
      label: displayOperand(s, project),
      events: tr.events[s] ?? [],
      format: formatterFor(s, project),
    }));
    start = 0;
    end = Math.max(tr.endMs, 1);
  } else {
    series = signals.map((s) => ({
      signal: s,
      label: displayOperand(s, project),
      events: liveTrend.events[s] ?? ([] as TrendEvent[]),
      format: formatterFor(s, project),
    }));
    end = Math.max(liveTrend.endMs, windowMs);
    start = end - windowMs;
  }

  const exportCsv = () =>
    downloadText(
      `${safeFileName(project.meta.name)}-tendencia.csv`,
      toCsvRows(series, start, end),
      'text/csv',
    );

  return (
    <div className="panel-body trend-panel">
      {capture ? (
        <div className="trend-toolbar capture">
          <span>
            {t('trend.capture', { check: t(`checks.${capture.scenarioId}.${capture.result.id}`) })}
            {capture.result.failure && (
              <strong className="error-text">
                {' '}
                · {t('trend.failedAt', { time: formatMs(capture.result.failure.atMs) })}
              </strong>
            )}
          </span>
          <span className="grow" />
          <button onClick={exportCsv}>{t('trend.exportCsv')}</button>
          <button className="primary" onClick={() => showCapture(null)} data-testid="trend-live">
            {t('trend.backToLive')}
          </button>
        </div>
      ) : (
        <div className="trend-toolbar">
          <select
            value=""
            onChange={(e) => e.target.value && setTrend([...signals, e.target.value])}
            data-testid="trend-add"
            aria-label={t('trend.add')}
          >
            <option value="">＋ {t('trend.add')}</option>
            {options.map((s) => (
              <option key={s} value={s}>
                {displayOperand(s, project)}
              </option>
            ))}
          </select>
          <label className="field inline">
            <span>{t('trend.window')}</span>
            <select value={windowMs} onChange={(e) => setWindowMs(Number(e.target.value))}>
              {WINDOWS.map((w) => (
                <option key={w} value={w}>
                  {w / 1000} s
                </option>
              ))}
            </select>
          </label>
          <div className="trend-chips">
            {signals.map((s) => (
              <span key={s} className="chip">
                {displayOperand(s, project)}
                <button
                  className="chip-x"
                  aria-label={t('trend.remove', { signal: s })}
                  onClick={() => setTrend(signals.filter((x) => x !== s))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <span className="grow" />
          {signals.length > 0 && (
            <>
              <button onClick={exportCsv}>{t('trend.exportCsv')}</button>
              <button onClick={() => setTrend([])}>{t('trend.clear')}</button>
            </>
          )}
        </div>
      )}
      {series.length === 0 ? (
        <p className="muted pad">{t('trend.empty')}</p>
      ) : (
        <TrendChart
          series={series}
          startMs={start}
          endMs={end}
          markerMs={capture?.result.failure?.atMs}
          markerLabel={capture?.result.failure ? t('trend.failure') : undefined}
        />
      )}
    </div>
  );
}
