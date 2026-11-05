import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { newId, type IoWidget, type Value, type WidgetKind } from '@ladder/core';
import { useProject } from '../store/project.ts';
import { useSim } from '../store/sim.ts';
import { formatValue } from './editor/format.ts';

const KINDS: WidgetKind[] = [
  'pushbutton',
  'pushbuttonNC',
  'toggle',
  'selector',
  'sensor',
  'lamp',
  'display',
  'slider',
];
const COLORS = ['#16a34a', '#dc2626', '#facc15', '#3b82f6', '#f97316', '#e5e7eb'];

export function IoPanel() {
  const { t } = useTranslation();
  const widgets = useProject((s) => s.project.ioPanel);
  const tags = useProject((s) => s.project.tags);
  const readOnly = useProject((s) => s.sharedId !== null);
  const update = useProject((s) => s.update);
  const values = useSim((s) => s.snapshot?.values);
  // Field devices show the field: a faulty output (welded / burnt) overrides the PLC value.
  const fieldOutputs = useSim((s) => s.faults.outputs);
  const setInput = useSim((s) => s.setInput);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ kind: WidgetKind; tag: string; label: string }>({
    kind: 'pushbutton',
    tag: '',
    label: '',
  });

  const add = () => {
    if (!draft.tag) return;
    const w: IoWidget = {
      id: newId('w_'),
      kind: draft.kind,
      tag: draft.tag,
      label: draft.label || draft.tag,
    };
    if (draft.kind === 'lamp') w.color = '#16a34a';
    if (draft.kind === 'slider') Object.assign(w, { min: 0, max: 27648 });
    update((d) => {
      d.ioPanel.push(w);
    });
    setDraft({ ...draft, tag: '', label: '' });
  };

  return (
    <div className="io-panel">
      <div className="panel-head">
        <span>{t('panel.title')}</span>
        {!readOnly && (
          <button onClick={() => setEditing(!editing)} data-testid="edit-panel">
            {editing ? t('panel.done') : t('panel.edit')}
          </button>
        )}
      </div>
      {widgets.length === 0 && !editing && <p className="muted pad">{t('panel.empty')}</p>}
      <div className="widgets">
        {widgets.map((w) => (
          <div key={w.id} className="widget-wrap">
            <Widget w={w} value={fieldOutputs[w.tag] ?? values?.[w.tag]} setInput={setInput} />
            {editing && (
              <div className="widget-edit">
                <input
                  defaultValue={w.label}
                  onBlur={(e) =>
                    update((d) => {
                      const x = d.ioPanel.find((i) => i.id === w.id);
                      if (x) x.label = e.target.value;
                    })
                  }
                />
                {w.kind === 'lamp' && (
                  <div className="colors">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        className="swatch"
                        style={{ background: c }}
                        onClick={() =>
                          update((d) => {
                            const x = d.ioPanel.find((i) => i.id === w.id);
                            if (x) x.color = c;
                          })
                        }
                      />
                    ))}
                  </div>
                )}
                <button
                  className="danger"
                  onClick={() =>
                    update((d) => {
                      d.ioPanel = d.ioPanel.filter((i) => i.id !== w.id);
                    })
                  }
                >
                  {t('panel.remove')}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <div className="widget-add">
          <select
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value as WidgetKind })}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`panel.kinds.${k}`)}
              </option>
            ))}
          </select>
          <select
            value={draft.tag}
            onChange={(e) => setDraft({ ...draft, tag: e.target.value })}
            data-testid="widget-tag"
          >
            <option value="">{t('panel.tag')}…</option>
            {tags
              .filter((tg) =>
                ['lamp', 'pushbutton', 'pushbuttonNC', 'toggle', 'selector', 'sensor'].includes(draft.kind)
                  ? tg.type === 'BOOL'
                  : tg.type === 'INT' || tg.type === 'DINT' || tg.type === 'REAL',
              )
              .map((tg) => (
                <option key={tg.name} value={tg.name}>
                  {tg.name}
                </option>
              ))}
          </select>
          <input
            placeholder={t('panel.label')}
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          />
          <button onClick={add} disabled={!draft.tag} data-testid="add-widget">
            {t('panel.add')}
          </button>
        </div>
      )}
    </div>
  );
}

function Widget({
  w,
  value,
  setInput,
}: {
  w: IoWidget;
  value: Value | undefined;
  setInput: (n: string, v: boolean | number) => void;
}) {
  const { t } = useTranslation();
  const on = typeof value === 'boolean' ? value : typeof value === 'number' ? value !== 0 : false;
  const press = (v: boolean) => setInput(w.tag, v);
  const momentary = (activeValue: boolean) => ({
    onPointerDown: (e: React.PointerEvent) => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      press(activeValue);
    },
    onPointerUp: () => press(!activeValue),
    onPointerCancel: () => press(!activeValue),
    onKeyDown: (e: React.KeyboardEvent) =>
      (e.key === ' ' || e.key === 'Enter') && !e.repeat && press(activeValue),
    onKeyUp: (e: React.KeyboardEvent) => (e.key === ' ' || e.key === 'Enter') && press(!activeValue),
  });

  switch (w.kind) {
    case 'pushbutton':
    case 'pushbuttonNC': {
      const nc = w.kind === 'pushbuttonNC';
      const pressed = nc ? !on : on;
      return (
        <div className="widget">
          <button
            className={`pb${pressed ? ' pressed' : ''}`}
            style={{ '--pb': w.color ?? (nc ? '#dc2626' : '#16a34a') } as React.CSSProperties}
            data-testid={`pb-${w.tag}`}
            {...momentary(!nc)}
          />
          <span className="widget-label">{w.label}</span>
          <span className="widget-tag">
            {w.tag}
            {nc ? ' (NF)' : ''}
          </span>
        </div>
      );
    }
    case 'toggle':
    case 'selector':
    case 'sensor':
      return (
        <div className="widget">
          <button
            className={`${w.kind}${on ? ' on' : ''}`}
            onClick={() => press(!on)}
            role="switch"
            aria-checked={on}
            data-testid={`sw-${w.tag}`}
          >
            <span className="knob" />
          </button>
          <span className="widget-label">{w.label}</span>
          <span className="widget-tag">{w.tag}</span>
        </div>
      );
    case 'lamp':
      return (
        <div className="widget">
          <div
            className={`lamp${on ? ' on' : ''}`}
            style={{ '--lamp': w.color ?? '#16a34a' } as React.CSSProperties}
            data-testid={`lamp-${w.tag}`}
            aria-label={on ? t('widgets.on') : t('widgets.off')}
          />
          <span className="widget-label">{w.label}</span>
          <span className="widget-tag">{w.tag}</span>
        </div>
      );
    case 'display':
      return (
        <div className="widget">
          <div className="display">{formatValue(value) || '0'}</div>
          <span className="widget-label">{w.label}</span>
          <span className="widget-tag">{w.tag}</span>
        </div>
      );
    case 'slider':
      return (
        <div className="widget wide">
          <input
            type="range"
            min={w.min ?? 0}
            max={w.max ?? 100}
            value={typeof value === 'number' ? value : 0}
            onChange={(e) => setInput(w.tag, Number(e.target.value))}
          />
          <span className="widget-label">
            {w.label}: {formatValue(value)}
          </span>
          <span className="widget-tag">{w.tag}</span>
        </div>
      );
  }
}
