import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  activePorts,
  addPlantPortTag,
  applyPlantTemplate,
  COMPONENT_DEFS,
  COMPONENT_KINDS,
  createComponent,
  createMissingPlantTags,
  newId,
  nextComponentLabel,
  PLANT_CATEGORIES,
  PLANT_DEFAULT_SIZE,
  PLANT_MAX_SIZE,
  PLANT_TEMPLATE_IDS,
  type PlantComponent,
  type PlantComponentKind,
  type PlantDesign,
} from '@ladder/core';
import { useProject } from '../../store/project.ts';
import { useSim } from '../../store/sim.ts';
import { useUi } from '../../store/ui.ts';
import { PlantCanvas, PLANT_GRID } from './PlantCanvas.tsx';
import { ComponentProps } from './ComponentProps.tsx';
import { OperateHelp, PlantActions } from './PlantActions.tsx';

/** First free spot (top-left first) for a w × h box, keeping a margin around other components. */
function freeSpot(design: PlantDesign, w: number, h: number): { x: number; y: number } {
  const M = 20;
  const overlaps = (x: number, y: number) =>
    design.components.some(
      (o) => x < o.x + o.w + M && x + w + M > o.x && y < o.y + o.h + M && y + h + M > o.y,
    );
  for (let y = M; y + h <= design.height; y += PLANT_GRID * 2)
    for (let x = M; x + w <= design.width; x += PLANT_GRID * 2) if (!overlaps(x, y)) return { x, y };
  return { x: M, y: M };
}

/** Number of required ports without a tag. */
export function missingTagCount(design: PlantDesign | undefined): number {
  let n = 0;
  for (const c of design?.components ?? [])
    for (const p of activePorts(c)) if (!p.optional && p.io !== 'ANY' && !c.tags[p.name]) n++;
  return n;
}

export function PlantEditor() {
  const { t } = useTranslation();
  const project = useProject((s) => s.project);
  const update = useProject((s) => s.update);
  const readOnly = useProject((s) => s.sharedId !== null);
  const send = useSim((s) => s.send);
  const plantAction = useSim((s) => s.plantAction);
  const editing = useUi((s) => s.plantEditing) && !readOnly;
  const setEditing = useUi((s) => s.setPlantEditing);
  const [selected, setSelected] = useState<string | null>(null);
  const design = project.plant;
  const sel = editing ? design?.components.find((c) => c.id === selected) : undefined;

  const editDesign = (fn: (d: PlantDesign) => void) =>
    update((p) => {
      if (p.plant) fn(p.plant);
    });
  const editComp = (id: string, fn: (c: PlantComponent) => void) =>
    editDesign((d) => {
      const c = d.components.find((x) => x.id === id);
      if (c) fn(c);
    });
  const removeComp = (id: string) => {
    editDesign((d) => {
      d.components = d.components.filter((c) => c.id !== id);
      // Pumps and valves fed by a deleted tank fall back to the outside supply / drain.
      for (const c of d.components)
        for (const end of ['from', 'to']) if (c.params[end] === id) c.params[end] = '';
    });
    setSelected(null);
  };
  const portComment = (c: PlantComponent, port: string) =>
    `${c.label || t(`builder.kinds.${c.kind}`)}: ${t(`builder.ports.${port}`)}`;

  // Delete removes the selection; arrows nudge it (Shift = 1 px).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!editing || !selected || (e.target as HTMLElement).closest('input, select, textarea')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeComp(selected);
        return;
      }
      const step = e.shiftKey ? 1 : PLANT_GRID;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[
        e.key
      ];
      if (d) {
        e.preventDefault();
        editComp(selected, (c) => {
          c.x = Math.max(0, c.x + d[0]!);
          c.y = Math.max(0, c.y + d[1]!);
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!design) return <PlantStart />;

  const missing = missingTagCount(design);
  const hasParts = design.components.some((c) => c.kind === 'feeder');
  const addComponent = (kind: PlantComponentKind) => {
    const def = COMPONENT_DEFS[kind];
    const c = createComponent(
      kind,
      0,
      0,
      kind === 'label' ? t('builder.newText') : nextComponentLabel(design.components, kind),
    );
    Object.assign(c, freeSpot(design, def.w, def.h + 14));
    editDesign((d) => void d.components.push(c));
    setSelected(c.id);
  };

  return (
    <div className="view plant-editor">
      <div className="view-head">
        <h2>{t('builder.title')}</h2>
        <span className="grow" />
        {!readOnly && (
          <button
            className={editing ? 'active' : ''}
            onClick={() => (setEditing(!editing), setSelected(null))}
            data-testid="plant-edit"
          >
            {editing ? `▶ ${t('builder.operate')}` : `✎ ${t('builder.edit')}`}
          </button>
        )}
        {hasParts && <button onClick={() => plantAction('clearParts')}>{t('builder.clearParts')}</button>}
        <button onClick={() => send({ type: 'resetPlant' })}>{t('builder.reset')}</button>
      </div>

      {editing && (
        <div className="pc-palette">
          {PLANT_CATEGORIES.map((cat) => (
            <div key={cat} className="pc-palette-group">
              <span className="muted small">{t(`builder.categories.${cat}`)}</span>
              <div className="row wrap">
                {COMPONENT_KINDS.filter((k) => COMPONENT_DEFS[k].category === cat).map((k) => (
                  <button
                    key={k}
                    className="palette-item"
                    onClick={() => addComponent(k)}
                    data-testid={`pc-add-${k}`}
                  >
                    {t(`builder.kinds.${k}`)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={`pc-layout${editing ? ' editing' : ''}`}>
        <div className="pc-main">
          <div className="pc-canvas-wrap" style={{ maxWidth: Math.max(design.width * 1.6, 480) }}>
            <PlantCanvas
              design={design}
              editing={editing}
              selected={selected}
              onSelect={setSelected}
              onGeometry={(id, g) => editComp(id, (c) => void Object.assign(c, g))}
            />
          </div>
          {!editing && <PlantActions design={design} />}
          {editing ? (
            <p className="muted small">{t('builder.help')}</p>
          ) : (
            <OperateHelp design={design} className="muted small" />
          )}
        </div>

        {editing && (
          <aside className="pc-side">
            {sel ? (
              <ComponentProps
                c={sel}
                project={project}
                onChange={(fn) => editComp(sel.id, fn)}
                onCreateTag={(port) =>
                  update((p) => void addPlantPortTag(p, sel.id, port, portComment(sel, port)))
                }
                onDelete={() => removeComp(sel.id)}
                onDuplicate={() => {
                  const copy: PlantComponent = {
                    ...structuredClone(sel),
                    id: newId('pc_'),
                    label: nextComponentLabel(design.components, sel.kind),
                    tags: {},
                    ...freeSpot(design, sel.w, sel.h + 14),
                  };
                  editDesign((d) => void d.components.push(copy));
                  setSelected(copy.id);
                }}
              />
            ) : (
              <div className="pc-props">
                {missing > 0 && (
                  <button
                    className="primary"
                    onClick={() => update((p) => void createMissingPlantTags(p, portComment))}
                    data-testid="plant-create-tags"
                  >
                    {t('builder.createTags', { n: missing })}
                  </button>
                )}
                <div className="row">
                  {(['width', 'height'] as const).map((dim) => (
                    <label key={dim} className="field">
                      <span>{t(`builder.${dim}`)}</span>
                      <input
                        type="number"
                        className="num"
                        key={design[dim]}
                        defaultValue={design[dim]}
                        step={20}
                        onBlur={(e) => {
                          const min = dim === 'width' ? 160 : 120;
                          const v = Math.max(
                            min,
                            Math.min(PLANT_MAX_SIZE[dim], Math.round(Number(e.target.value))),
                          );
                          if (Number.isFinite(v) && v !== design[dim]) editDesign((d) => void (d[dim] = v));
                        }}
                      />
                    </label>
                  ))}
                </div>
                <p className="muted small">{t('builder.selectHint')}</p>
                <button
                  className="danger"
                  onClick={() =>
                    confirm(t('builder.removeConfirm')) &&
                    update((p) => {
                      delete p.plant;
                    })
                  }
                >
                  {t('builder.remove')}
                </button>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

/** No editable plant yet: start blank, from an exercise, or convert the active exercise. */
export function PlantStart({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const scenarioId = useProject((s) => s.project.scenarioId);
  const update = useProject((s) => s.update);
  const setView = useProject((s) => s.setView);
  const readOnly = useProject((s) => s.sharedId !== null);
  const [template, setTemplate] = useState(PLANT_TEMPLATE_IDS[0]!);
  const [withSolution, setWithSolution] = useState(false);
  if (readOnly)
    return compact ? null : (
      <div className="view">
        <p className="muted">{t('builder.none')}</p>
      </div>
    );

  const open = () => setView('plant');
  return (
    <div className={compact ? 'scenario-card' : 'view plant-start'}>
      {!compact && <h2>{t('builder.title')}</h2>}
      {compact && <strong>{t('builder.editableTitle')}</strong>}
      <p className={compact ? 'muted small' : 'muted'}>{t('builder.intro')}</p>
      {scenarioId ? (
        <>
          <p className="small">{t('builder.scenarioActive', { name: t(`plant.${scenarioId}.title`) })}</p>
          <button
            onClick={() => {
              if (!confirm(t('builder.convertConfirm'))) return;
              update((p) => void applyPlantTemplate(p, scenarioId));
              open();
            }}
            data-testid="plant-convert"
          >
            {t('builder.convert')}
          </button>
        </>
      ) : (
        <>
          <div className="row wrap">
            <button
              className="primary"
              onClick={() => {
                update((p) => {
                  p.plant = { ...PLANT_DEFAULT_SIZE, components: [] };
                });
                useUi.getState().setPlantEditing(true);
                open();
              }}
              data-testid="plant-blank"
            >
              {t('builder.blank')}
            </button>
          </div>
          <div className="row wrap">
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              data-testid="plant-template"
            >
              {PLANT_TEMPLATE_IDS.map((id) => (
                <option key={id} value={id}>
                  {t(`plant.${id}.title`)}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                if (!confirm(t('builder.templateConfirm'))) return;
                if (withSolution && !confirm(t('plant.solutionConfirm'))) return;
                update((p) => void applyPlantTemplate(p, template, withSolution));
                open();
              }}
              data-testid="plant-from-template"
            >
              {t('builder.fromTemplate')}
            </button>
          </div>
          <label className="check small">
            <input
              type="checkbox"
              checked={withSolution}
              onChange={(e) => setWithSolution(e.target.checked)}
              data-testid="plant-with-solution"
            />
            {t('builder.withSolution')}
          </label>
        </>
      )}
    </div>
  );
}
