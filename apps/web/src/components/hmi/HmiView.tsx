import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  HMI_HEIGHT,
  HMI_WIDTH,
  newId,
  type HmiScreen,
  type HmiWidget,
  type HmiWidgetKind,
  type Project,
  type Value,
} from '@ladder/core';
import { useProject } from '../../store/project.ts';
import { liveTrend, useSim } from '../../store/sim.ts';
import { Widget } from '../IoPanel.tsx';
import { TrendChart } from '../trend/TrendChart.tsx';
import { formatValue } from '../editor/format.ts';
import { updateWithUndo } from '../../store/undoable.ts';

const GRID = 10;
const snap = (v: number) => Math.round(v / GRID) * GRID;

const DEFAULT_SIZE: Record<HmiWidgetKind, [number, number]> = {
  pushbutton: [110, 120],
  pushbuttonNC: [110, 120],
  toggle: [110, 110],
  selector: [110, 110],
  sensor: [110, 110],
  lamp: [100, 120],
  display: [160, 100],
  slider: [220, 100],
  text: [220, 40],
  bar: [90, 220],
  numeric: [180, 90],
  nav: [160, 60],
  trend: [400, 200],
};
const KINDS = Object.keys(DEFAULT_SIZE) as HmiWidgetKind[];
const NUMERIC_KINDS = new Set<HmiWidgetKind>(['display', 'slider', 'bar', 'numeric', 'trend']);
const needsTag = (k: HmiWidgetKind) => k !== 'text' && k !== 'nav';

/** First grid position where a w × h item does not overlap the others (top-left first). */
function freeSpot(widgets: HmiWidget[], w: number, h: number): { x: number; y: number } {
  const overlaps = (x: number, y: number) =>
    widgets.some(
      (o) => x < o.x + o.w + GRID && x + w + GRID > o.x && y < o.y + o.h + GRID && y + h + GRID > o.y,
    );
  for (let y = 20; y + h <= HMI_HEIGHT; y += GRID)
    for (let x = 20; x + w <= HMI_WIDTH; x += GRID) if (!overlaps(x, y)) return { x, y };
  return { x: 20, y: 20 };
}

const num = (v: Value | undefined) => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : 0);

/** Lays the I/O panel widgets out on a first screen. */
function screenFromPanel(project: Project, name: string): HmiScreen {
  let x = 20;
  let y = 20;
  let rowH = 0;
  const widgets: HmiWidget[] = project.ioPanel.map((w) => {
    const [ww, hh] = DEFAULT_SIZE[w.kind];
    if (x + ww > HMI_WIDTH - 20) {
      x = 20;
      y += rowH + 20;
      rowH = 0;
    }
    const placed: HmiWidget = { ...w, id: newId('h_'), x, y, w: ww, h: hh };
    x += ww + 20;
    rowH = Math.max(rowH, hh);
    return placed;
  });
  return { id: newId('scr_'), name, widgets };
}

export function HmiView() {
  const { t } = useTranslation();
  const project = useProject((s) => s.project);
  const update = useProject((s) => s.update);
  const readOnly = useProject((s) => s.sharedId !== null);
  const screens = project.hmi?.screens ?? [];
  const [screenId, setScreenId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const screen = screens.find((s) => s.id === screenId) ?? screens[0];
  const screenNameTaken = (name: string) =>
    screens.some((s) => s.id !== screen?.id && s.name.trim().toLowerCase() === name.trim().toLowerCase());
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setScale(Math.max(0.4, Math.min(1.6, (el.clientWidth - 8) / HMI_WIDTH))),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [screen?.id]);

  const editScreen = (fn: (s: HmiScreen) => void) =>
    update((d) => {
      const sc = d.hmi?.screens.find((s) => s.id === screen?.id);
      if (sc) fn(sc);
    });
  const editWidget = (id: string, fn: (w: HmiWidget) => void) =>
    editScreen((sc) => {
      const w = sc.widgets.find((x) => x.id === id);
      if (w) fn(w);
    });

  // Delete removes the selected widget while editing (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!editing || !selected || (e.target as HTMLElement).closest('input, select, textarea')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        editScreen((sc) => void (sc.widgets = sc.widgets.filter((w) => w.id !== selected)));
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const addScreen = (fromPanel: boolean) => {
    // First "Screen N" not in use (numbers can repeat after a screen is deleted).
    let n = screens.length + 1;
    while (screens.some((s) => s.name === t('hmi.defaultName', { n }))) n++;
    const defaultName = t('hmi.defaultName', { n });
    const sc = fromPanel
      ? screenFromPanel(project, defaultName)
      : { id: newId('scr_'), name: defaultName, widgets: [] };
    update((d) => {
      d.hmi = { screens: [...(d.hmi?.screens ?? []), sc] };
    });
    setScreenId(sc.id);
    setEditing(!fromPanel);
  };

  if (!screen)
    return (
      <div className="view hmi">
        <div className="view-head">
          <h2>{t('hmi.title')}</h2>
        </div>
        <p className="muted">{t('hmi.empty')}</p>
        {!readOnly && (
          <div className="row">
            <button
              className="primary"
              onClick={() => addScreen(true)}
              disabled={!project.ioPanel.length}
              data-testid="hmi-from-panel"
            >
              {t('hmi.createFromPanel')}
            </button>
            <button onClick={() => addScreen(false)} data-testid="hmi-new-screen">
              {t('hmi.createEmpty')}
            </button>
          </div>
        )}
      </div>
    );

  const sel = editing ? screen.widgets.find((w) => w.id === selected) : undefined;
  const addWidget = (kind: HmiWidgetKind) => {
    const [w, h] = DEFAULT_SIZE[kind];
    const widget: HmiWidget = {
      id: newId('h_'),
      kind,
      tag: '',
      label: kind === 'text' ? t('hmi.newText') : t(`hmi.kinds.${kind}`),
      ...freeSpot(screen.widgets, w, h),
      w,
      h,
      ...(kind === 'bar' || kind === 'slider' || kind === 'trend' ? { min: 0, max: 100 } : {}),
      ...(kind === 'lamp' ? { color: '#16a34a' } : {}),
      ...(kind === 'nav' ? { target: screens.find((s) => s.id !== screen.id)?.id ?? screen.id } : {}),
    };
    editScreen((sc) => void sc.widgets.push(widget));
    setSelected(widget.id);
  };

  return (
    <div className="view hmi">
      <div className="hmi-toolbar">
        <div className="hmi-tabs" role="tablist">
          {screens.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={s.id === screen.id}
              className={s.id === screen.id ? 'active' : ''}
              onClick={() => (setScreenId(s.id), setSelected(null))}
            >
              {s.name}
            </button>
          ))}
          {!readOnly && (
            <button className="program-add" onClick={() => addScreen(false)}>
              ＋ {t('hmi.addScreen')}
            </button>
          )}
        </div>
        <span className="grow" />
        {!readOnly && (
          <button
            className={editing ? 'active' : ''}
            onClick={() => (setEditing(!editing), setSelected(null))}
            data-testid="hmi-edit"
          >
            {editing ? `▶ ${t('hmi.run')}` : `✎ ${t('hmi.edit')}`}
          </button>
        )}
      </div>

      {editing && (
        <div className="hmi-palette">
          {KINDS.map((k) => (
            <button
              key={k}
              className="palette-item"
              onClick={() => addWidget(k)}
              data-testid={`hmi-add-${k}`}
            >
              {t(`hmi.kinds.${k}`)}
            </button>
          ))}
        </div>
      )}

      <div className={`hmi-layout${editing ? ' editing' : ''}`}>
        <div className="hmi-wrap" ref={wrap}>
          <div className="hmi-frame" style={{ width: HMI_WIDTH * scale, height: HMI_HEIGHT * scale }}>
            <div
              className={`hmi-screen${editing ? ' editing' : ''}`}
              style={{ width: HMI_WIDTH, height: HMI_HEIGHT, transform: `scale(${scale})` }}
              onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}
              data-testid="hmi-screen"
            >
              {screen.widgets.map((w) => (
                <HmiItem
                  key={w.id}
                  w={w}
                  scale={scale}
                  editing={editing}
                  selected={w.id === selected}
                  onSelect={() => setSelected(w.id)}
                  onGeometry={(g) => editWidget(w.id, (x) => Object.assign(x, g))}
                  onNavigate={(target) => setScreenId(target)}
                />
              ))}
            </div>
          </div>
        </div>

        {editing && (
          <aside className="hmi-props">
            <label className="field">
              <span>{t('hmi.screenName')}</span>
              <input
                key={screen.id + screen.name}
                defaultValue={screen.name}
                aria-invalid={!!nameError}
                aria-describedby={nameError ? 'hmi-name-error' : undefined}
                onChange={(e) => setNameError(screenNameTaken(e.target.value) ? t('hmi.nameTaken') : null)}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  setNameError(null);
                  // Blank or taken: keep the current name (the screen list would be ambiguous).
                  if (!v || screenNameTaken(v)) e.target.value = screen.name;
                  else if (v !== screen.name) editScreen((sc) => void (sc.name = v));
                }}
              />
              {nameError && (
                <small className="error-text" id="hmi-name-error">
                  {nameError}
                </small>
              )}
            </label>
            {screens.length > 1 && (
              <button
                className="danger"
                onClick={() => {
                  const { id, name } = screen;
                  updateWithUndo(
                    (d) => {
                      if (d.hmi) d.hmi.screens = d.hmi.screens.filter((s) => s.id !== id);
                    },
                    t('hmi.screenDeleted', { name }),
                    { afterUndo: () => setScreenId(id) },
                  );
                  setScreenId(null);
                }}
              >
                {t('hmi.deleteScreen')}
              </button>
            )}
            <hr />
            {!sel ? (
              <p className="muted small">{t('hmi.help')}</p>
            ) : (
              <WidgetProps
                w={sel}
                project={project}
                screens={screens}
                onChange={(fn) => editWidget(sel.id, fn)}
                onDelete={() => (
                  editScreen((sc) => void (sc.widgets = sc.widgets.filter((x) => x.id !== sel.id))),
                  setSelected(null)
                )}
              />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function HmiItem({
  w,
  scale,
  editing,
  selected,
  onSelect,
  onGeometry,
  onNavigate,
}: {
  w: HmiWidget;
  scale: number;
  editing: boolean;
  selected: boolean;
  onSelect: () => void;
  onGeometry: (g: Partial<Pick<HmiWidget, 'x' | 'y' | 'w' | 'h'>>) => void;
  onNavigate: (screenId: string) => void;
}) {
  const [drag, setDrag] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const g = drag ?? { x: w.x, y: w.y, w: w.w, h: w.h };

  const startDrag = (e: React.PointerEvent, mode: 'move' | 'resize') => {
    if (!editing) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect();
    const start = { px: e.clientX, py: e.clientY, ...g };
    let last = g;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.px) / scale;
      const dy = (ev.clientY - start.py) / scale;
      last =
        mode === 'move'
          ? {
              ...start,
              x: Math.max(0, Math.min(HMI_WIDTH - start.w, snap(start.x + dx))),
              y: Math.max(0, Math.min(HMI_HEIGHT - start.h, snap(start.y + dy))),
            }
          : {
              ...start,
              w: Math.max(40, Math.min(HMI_WIDTH - start.x, snap(start.w + dx))),
              h: Math.max(30, Math.min(HMI_HEIGHT - start.y, snap(start.h + dy))),
            };
      setDrag(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      if (last.x !== w.x || last.y !== w.y || last.w !== w.w || last.h !== w.h)
        onGeometry({ x: last.x, y: last.y, w: last.w, h: last.h });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      className={`hmi-item${selected ? ' selected' : ''}`}
      style={{ left: g.x, top: g.y, width: g.w, height: g.h }}
      data-testid={`hmi-w-${w.kind}-${w.tag || w.label}`}
    >
      <HmiContent w={w} onNavigate={onNavigate} />
      {editing && (
        <>
          <div className="hmi-drag" onPointerDown={(e) => startDrag(e, 'move')} />
          <div className="hmi-resize" onPointerDown={(e) => startDrag(e, 'resize')} />
        </>
      )}
    </div>
  );
}

function HmiContent({ w, onNavigate }: { w: HmiWidget; onNavigate: (id: string) => void }) {
  const { t } = useTranslation();
  const values = useSim((s) => s.snapshot?.values);
  const fieldOutputs = useSim((s) => s.faults.outputs);
  const setInput = useSim((s) => s.setInput);
  useSim((s) => (w.kind === 'trend' ? s.trendVersion : 0));
  const value = fieldOutputs[w.tag] ?? values?.[w.tag];
  const min = w.min ?? 0;
  const max = w.max ?? 100;

  switch (w.kind) {
    case 'text':
      return (
        <div className="hmi-text" style={{ fontSize: Math.max(12, w.h * 0.45), color: w.color }}>
          {w.label}
        </div>
      );
    case 'nav':
      return (
        <button
          className="hmi-nav"
          onClick={() => w.target && onNavigate(w.target)}
          style={w.color ? { background: w.color } : undefined}
        >
          {w.label} ➜
        </button>
      );
    case 'bar': {
      const pct = Math.max(0, Math.min(1, (num(value) - min) / (max - min || 1)));
      return (
        <div className="hmi-bar">
          <div className="hmi-bar-track">
            <div
              className="hmi-bar-fill"
              style={{ height: `${pct * 100}%`, background: w.color ?? 'var(--trend-analog)' }}
            />
          </div>
          <span className="widget-label">{w.label}</span>
          <span className="mono small">{formatValue(value)}</span>
        </div>
      );
    }
    case 'numeric':
      return (
        <div className="widget hmi-numeric">
          <span className="widget-label">{w.label}</span>
          <input
            type="number"
            key={String(value)}
            defaultValue={typeof value === 'number' ? value : 0}
            aria-label={w.label}
            onKeyDown={(e) =>
              e.key === 'Enter' && w.tag && setInput(w.tag, Number((e.target as HTMLInputElement).value))
            }
            onBlur={(e) => w.tag && setInput(w.tag, Number(e.target.value))}
          />
          <span className="widget-tag">{w.tag}</span>
        </div>
      );
    case 'trend': {
      const events = liveTrend.events[w.tag] ?? [];
      const end = Math.max(liveTrend.endMs, 30_000);
      return (
        <div className="hmi-trend">
          <span className="widget-label">{w.label}</span>
          {w.tag ? (
            <TrendChart
              series={[{ signal: w.tag, label: w.tag, events }]}
              startMs={end - 30_000}
              endMs={end}
            />
          ) : (
            <p className="muted small">{t('hmi.noTag')}</p>
          )}
        </div>
      );
    }
    default:
      return (
        <Widget
          w={{ id: w.id, kind: w.kind, tag: w.tag, label: w.label, color: w.color, min: w.min, max: w.max }}
          value={value}
          setInput={setInput}
        />
      );
  }
}

function WidgetProps({
  w,
  project,
  screens,
  onChange,
  onDelete,
}: {
  w: HmiWidget;
  project: Project;
  screens: HmiScreen[];
  onChange: (fn: (w: HmiWidget) => void) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const tags = project.tags.filter((tg) =>
    NUMERIC_KINDS.has(w.kind)
      ? tg.type === 'INT' || tg.type === 'DINT' || tg.type === 'REAL'
      : tg.type === 'BOOL',
  );
  return (
    <div className="hmi-widget-props" data-testid="hmi-props">
      <strong>{t(`hmi.kinds.${w.kind}`)}</strong>
      <label className="field">
        <span>{t('panel.label')}</span>
        <input
          key={w.id + w.label}
          defaultValue={w.label}
          onBlur={(e) => onChange((x) => void (x.label = e.target.value))}
          data-testid="hmi-prop-label"
        />
      </label>
      {needsTag(w.kind) && (
        <label className="field">
          <span>{t('panel.tag')}</span>
          <select
            value={w.tag}
            onChange={(e) => onChange((x) => void (x.tag = e.target.value))}
            data-testid="hmi-prop-tag"
          >
            <option value="">{t('hmi.noTag')}</option>
            {tags.map((tg) => (
              <option key={tg.name} value={tg.name}>
                {tg.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {w.kind === 'nav' && (
        <label className="field">
          <span>{t('hmi.target')}</span>
          <select value={w.target ?? ''} onChange={(e) => onChange((x) => void (x.target = e.target.value))}>
            {screens.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {(w.kind === 'bar' || w.kind === 'slider') && (
        <div className="row">
          <label className="field">
            <span>{t('operand.min')}</span>
            <input
              type="number"
              className="num"
              defaultValue={w.min ?? 0}
              onBlur={(e) => onChange((x) => void (x.min = Number(e.target.value)))}
            />
          </label>
          <label className="field">
            <span>{t('operand.max')}</span>
            <input
              type="number"
              className="num"
              defaultValue={w.max ?? 100}
              onBlur={(e) => onChange((x) => void (x.max = Number(e.target.value)))}
            />
          </label>
        </div>
      )}
      {['lamp', 'bar', 'text', 'nav', 'pushbutton', 'pushbuttonNC'].includes(w.kind) && (
        <label className="field">
          <span>{t('hmi.color')}</span>
          <input
            type="color"
            value={w.color ?? '#16a34a'}
            onChange={(e) => onChange((x) => void (x.color = e.target.value))}
          />
        </label>
      )}
      <p className="muted small mono">
        x {w.x} · y {w.y} · {w.w}×{w.h}
      </p>
      <button className="danger" onClick={onDelete}>
        {t('hmi.deleteWidget')}
      </button>
    </div>
  );
}
