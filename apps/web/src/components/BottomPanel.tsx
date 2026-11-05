import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { crossReference, tagAddress, validateProject, type Tag, type Value } from '@ladder/core';
import { useProject } from '../store/project.ts';
import { useSim } from '../store/sim.ts';
import { formatMs, formatValue } from './editor/format.ts';
import { signalsForTag, TrendPanel } from './trend/TrendPanel.tsx';
import { useUi } from '../store/ui.ts';
import { goToElement } from '../navigation.ts';

const HEIGHT_KEY = 'ladder-ide:bottom-height';
function loadHeight(): number {
  try {
    const v = Number(localStorage.getItem(HEIGHT_KEY));
    return v >= 120 && v <= 2000 ? v : 260;
  } catch {
    return 260;
  }
}

export function BottomPanel() {
  const { t } = useTranslation();
  const project = useProject((s) => s.project);
  const diagnostics = useMemo(() => validateProject(project), [project]);
  const tab = useSim((s) => s.bottomTab);
  const setTab = useSim((s) => s.setBottomTab);
  const [collapsed, setCollapsed] = useState(false);
  const [height, setHeight] = useState(loadHeight);
  const errors = diagnostics.filter((d) => d.severity === 'error').length;

  /** Drag the top edge to resize; the height is remembered in this browser. */
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const max = window.innerHeight * 0.75;
    let last = startH;
    const move = (ev: PointerEvent) => {
      last = Math.round(Math.max(120, Math.min(max, startH + startY - ev.clientY)));
      setHeight(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try {
        localStorage.setItem(HEIGHT_KEY, String(last));
      } catch {
        /* storage blocked: keep for this session only */
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const nudge = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') setHeight((h) => Math.min(window.innerHeight * 0.75, h + 24));
    else if (e.key === 'ArrowDown') setHeight((h) => Math.max(120, h - 24));
  };

  return (
    <div className={`bottom${collapsed ? ' collapsed' : ''}`} style={collapsed ? undefined : { height }}>
      {!collapsed && (
        <div
          className="bottom-resizer"
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('bottom.resize')}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={nudge}
        />
      )}
      <div className="tabs">
        <button
          className={tab === 'watch' ? 'active' : ''}
          onClick={() => (setTab('watch'), setCollapsed(false))}
        >
          {t('bottom.watch')}
        </button>
        <button
          className={tab === 'trend' ? 'active' : ''}
          onClick={() => (setTab('trend'), setCollapsed(false))}
          data-testid="trend-tab"
        >
          {t('bottom.trend')}
        </button>
        <button
          className={`${tab === 'problems' ? 'active' : ''} ${errors ? 'has-errors' : ''}`}
          onClick={() => (setTab('problems'), setCollapsed(false))}
          data-testid="problems-tab"
        >
          {t('bottom.problems', { count: diagnostics.length })}
        </button>
        <span className="grow" />
        <button className="icon" onClick={() => setCollapsed(!collapsed)} title="▾">
          {collapsed ? '▴' : '▾'}
        </button>
      </div>
      {!collapsed && tab === 'watch' && <WatchTable />}
      {!collapsed && tab === 'trend' && <TrendPanel />}
      {!collapsed && tab === 'problems' && <Problems diagnostics={diagnostics} />}
    </div>
  );
}

function Problems({ diagnostics }: { diagnostics: ReturnType<typeof validateProject> }) {
  const { t } = useTranslation();
  const project = useProject((s) => s.project);
  const { select, setView, setProgram } = useProject.getState();
  if (!diagnostics.length) return <div className="panel-body muted pad">{t('bottom.noProblems')}</div>;
  return (
    <div className="panel-body">
      <table className="grid">
        <tbody>
          {diagnostics.map((d, i) => {
            const prog = project.programs.find((p) => p.id === d.programId);
            const rungIdx = prog ? prog.rungs.findIndex((r) => r.id === d.rungId) : -1;
            return (
              <tr
                key={i}
                className="clickable"
                onClick={() => {
                  if (d.rungId && prog) {
                    setProgram(prog.id);
                    setView('editor');
                    select({ rungId: d.rungId, nodeId: d.elementId });
                    setTimeout(
                      () =>
                        document
                          .querySelector(`[data-rung="${rungIdx + 1}"]`)
                          ?.scrollIntoView({ block: 'center' }),
                      0,
                    );
                  } else if (d.tag) setView('tags');
                }}
              >
                <td className={d.severity === 'error' ? 'sev error' : 'sev warning'}>
                  {d.severity === 'error' ? '✖' : '⚠'}
                </td>
                <td>
                  {t(`diag.${d.code}`, {
                    ...d.params,
                    operand: d.params?.operand ? t(`operand.${d.params.operand}`) : '',
                  })}
                </td>
                <td className="muted">{rungIdx >= 0 ? t('bottom.rung', { n: rungIdx + 1 }) : d.tag}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** "Por que?" from the watch table: explain the tag and jump to the instruction that wrote it last. */
function explainFromWatch(tag: string) {
  useUi.getState().setExplain(tag);
  useUi.getState().setDock('props');
  const project = useProject.getState().project;
  const writerId = useSim.getState().snapshot?.writers?.[tag];
  const refs = crossReference(project).get(tag) ?? [];
  const ref = refs.find((r) => r.elementId === writerId) ?? refs.find((r) => r.access !== 'read');
  if (ref) goToElement(ref.programId, ref.rungId, ref.elementId);
}

function WatchTable() {
  const { t } = useTranslation();
  const project = useProject((s) => s.project);
  const snapshot = useSim((s) => s.snapshot);
  const { setInput, force } = useSim.getState();
  const trend = project.trend ?? [];
  const setTrend = useProject((s) => s.setTrend);
  const [filter, setFilter] = useState('');
  const f = filter.trim().toLowerCase();
  const tags = project.tags.filter(
    (tg) => !f || tg.name.toLowerCase().includes(f) || (tg.comment ?? '').toLowerCase().includes(f),
  );
  const forces = snapshot?.forces ?? {};

  return (
    <div className="panel-body">
      <table className="grid watch">
        <thead>
          <tr>
            <th>
              <input
                className="filter"
                placeholder={t('bottom.filter')}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </th>
            <th>{t('bottom.type')}</th>
            <th>{t('bottom.address')}</th>
            <th>{t('bottom.value')}</th>
            <th>{t('bottom.force')}</th>
            <th>{t('bottom.comment')}</th>
          </tr>
        </thead>
        <tbody>
          {tags.map((tg) => (
            <WatchRow
              key={tg.name}
              tag={tg}
              address={tagAddress(tg, project)}
              value={snapshot?.values[tg.name]}
              forced={forces[tg.name]}
              onToggle={(v) => setInput(tg.name, v)}
              onForce={(v) => force(tg.name, v)}
              inTrend={signalsForTag(tg.name, tg.type).every((x) => trend.includes(x))}
              onTrend={() => {
                const sigs = signalsForTag(tg.name, tg.type);
                const on = sigs.every((x) => trend.includes(x));
                setTrend(
                  on
                    ? trend.filter((x) => !sigs.includes(x))
                    : [...trend, ...sigs.filter((x) => !trend.includes(x))],
                );
              }}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WatchRow({
  tag,
  address,
  value,
  forced,
  onToggle,
  onForce,
  inTrend,
  onTrend,
}: {
  inTrend: boolean;
  onTrend: () => void;
  tag: Tag;
  address: string;
  value: Value | undefined;
  forced: boolean | number | undefined;
  onToggle: (v: boolean | number) => void;
  onForce: (v?: boolean | number) => void;
}) {
  const { t } = useTranslation();
  const isForced = forced !== undefined;
  let shown: React.ReactNode = formatValue(value);
  if (value && typeof value === 'object') {
    const acc = tag.type === 'TIMER' ? formatMs(value.acc) : value.acc;
    const pre = tag.type === 'TIMER' ? formatMs(value.pre) : value.pre;
    shown = (
      <>
        {acc} / {pre} <span className={value.dn ? 'bit on' : 'bit'}>DN</span>
      </>
    );
  }
  return (
    <tr className={isForced ? 'forced' : ''}>
      <td className="mono">
        <button
          className={inTrend ? 'trend-btn active' : 'trend-btn'}
          onClick={onTrend}
          title={t(inTrend ? 'trend.removeFromChart' : 'trend.addToChart')}
          aria-pressed={inTrend}
          data-testid={`trend-toggle-${tag.name}`}
        >
          📈
        </button>
        <button
          className="trend-btn explain-btn"
          onClick={() => explainFromWatch(tag.name)}
          title={t('explain.button', { tag: tag.name })}
          data-testid={`explain-watch-${tag.name}`}
        >
          🔎
        </button>{' '}
        {tag.name}
      </td>
      <td className="muted">{tag.type}</td>
      <td className="mono muted">{address}</td>
      <td className="mono" data-testid={`watch-${tag.name}`}>
        {tag.type === 'BOOL' ? (
          <button className={value ? 'bit on' : 'bit'} onClick={() => onToggle(!value)} title="Alternar">
            {value ? '1' : '0'}
          </button>
        ) : (
          shown
        )}
      </td>
      <td className="force-cell">
        {tag.type === 'BOOL' && (
          <>
            <button className={forced === true ? 'active' : ''} onClick={() => onForce(true)}>
              {t('bottom.forceOn')}
            </button>
            <button className={forced === false ? 'active' : ''} onClick={() => onForce(false)}>
              {t('bottom.forceOff')}
            </button>
          </>
        )}
        {(tag.type === 'INT' || tag.type === 'DINT' || tag.type === 'REAL') && (
          <input
            className="num"
            type="number"
            placeholder={t('bottom.forceValue')}
            defaultValue={typeof forced === 'number' ? forced : ''}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const v = (e.target as HTMLInputElement).value;
                onForce(v === '' ? undefined : Number(v));
              }
            }}
          />
        )}
        {isForced && (
          <button onClick={() => onForce(undefined)} className="danger">
            {t('bottom.unforce')}
          </button>
        )}
      </td>
      <td className="muted">{tag.comment}</td>
    </tr>
  );
}
