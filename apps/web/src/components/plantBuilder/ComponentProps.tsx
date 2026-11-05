import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  activeParams,
  activePorts,
  COMPONENT_DEFS,
  paramOf,
  tagFitsPort,
  type ParamDef,
  type PlantComponent,
  type Project,
} from '@ladder/core';

export function optionLabel(t: TFunction, param: string, opt: string): string {
  if (param === 'unit') return opt || '—';
  if (param === 'lights') return t('builder.options.lights', { n: opt });
  return t(`builder.options.${opt}`);
}

export function ComponentProps({
  c,
  project,
  onChange,
  onCreateTag,
  onDelete,
  onDuplicate,
}: {
  c: PlantComponent;
  project: Project;
  onChange: (fn: (c: PlantComponent) => void) => void;
  onCreateTag: (port: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const { t } = useTranslation();
  const tanks = (project.plant?.components ?? []).filter((x) => x.kind === 'tank' && x.id !== c.id);

  const setParam = (p: ParamDef, value: string | number | boolean) =>
    onChange((x) => {
      // Turning a cylinder vertical keeps its stroke length: swap the box.
      if (p.name === 'orient' && x.kind === 'cylinder' && value !== paramOf(x, 'orient'))
        [x.w, x.h] = [x.h, x.w];
      x.params[p.name] = value;
    });

  return (
    <div className="pc-props" data-testid="pc-props">
      <strong>{t(`builder.kinds.${c.kind}`)}</strong>
      <label className="field">
        <span>{t('builder.label')}</span>
        <input
          key={c.id + c.label}
          defaultValue={c.label}
          maxLength={100}
          onBlur={(e) => onChange((x) => void (x.label = e.target.value.trim()))}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          data-testid="pc-prop-label"
        />
      </label>

      {activePorts(c).length > 0 && (
        <fieldset className="pc-section">
          <legend>{t('builder.signals')}</legend>
          {activePorts(c).map((p) => {
            const tags = project.tags.filter((tg) => tagFitsPort(tg, p.io));
            const bound = c.tags[p.name] ?? '';
            const missing = bound && !project.tags.some((tg) => tg.name === bound);
            return (
              <div key={p.name} className="pc-port">
                <span className="pc-port-name">
                  {t(`builder.ports.${p.name}`)}
                  <small className={`io-chip io-${p.io}`}>{p.io === 'ANY' ? '' : p.io}</small>
                  {!p.optional && p.io !== 'ANY' && !bound && <small className="warn-text"> *</small>}
                </span>
                <div className="row">
                  <select
                    value={bound}
                    onChange={(e) =>
                      onChange((x) => {
                        if (e.target.value) x.tags[p.name] = e.target.value;
                        else delete x.tags[p.name];
                      })
                    }
                    data-testid={`pc-port-${p.name}`}
                  >
                    <option value="">{t('builder.noTag')}</option>
                    {missing && <option value={bound}>{bound} ⚠</option>}
                    {tags.map((tg) => (
                      <option key={tg.name} value={tg.name}>
                        {tg.name}
                      </option>
                    ))}
                  </select>
                  {!bound && p.io !== 'ANY' && (
                    <button
                      className="small"
                      onClick={() => onCreateTag(p.name)}
                      title={t('builder.newTagHint')}
                      data-testid={`pc-newtag-${p.name}`}
                    >
                      {t('builder.newTag')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </fieldset>
      )}

      {activeParams(c).length > 0 && (
        <fieldset className="pc-section">
          <legend>{t('builder.paramsTitle')}</legend>
          {activeParams(c).map((p) => {
            const value = paramOf(c, p.name);
            const label = (
              <span>
                {t(`builder.params.${p.name}`)}
                {p.type === 'number' && p.unit ? ` (${p.unit})` : ''}
              </span>
            );
            switch (p.type) {
              case 'number':
                return (
                  <label key={p.name} className="field">
                    {label}
                    <input
                      type="number"
                      className="num"
                      key={c.id + String(value)}
                      defaultValue={Number(value)}
                      min={p.min}
                      max={p.max}
                      step={p.step ?? 'any'}
                      onBlur={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isFinite(n)) return;
                        const v = Math.max(p.min, Math.min(p.max, n));
                        if (v !== value) setParam(p, v);
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      data-testid={`pc-param-${p.name}`}
                    />
                  </label>
                );
              case 'bool':
                return (
                  <label key={p.name} className="check">
                    <input
                      type="checkbox"
                      checked={value === true}
                      onChange={(e) => setParam(p, e.target.checked)}
                      data-testid={`pc-param-${p.name}`}
                    />
                    {label}
                  </label>
                );
              case 'select':
                return (
                  <label key={p.name} className="field">
                    {label}
                    <select
                      value={String(value)}
                      onChange={(e) => setParam(p, e.target.value)}
                      data-testid={`pc-param-${p.name}`}
                    >
                      {p.options.map((o) => (
                        <option key={o} value={o}>
                          {optionLabel(t, p.name, o)}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              case 'color':
                return (
                  <label key={p.name} className="field">
                    {label}
                    <input type="color" value={String(value)} onChange={(e) => setParam(p, e.target.value)} />
                  </label>
                );
              case 'tank':
                return (
                  <label key={p.name} className="field">
                    {label}
                    <select
                      value={String(value)}
                      onChange={(e) => setParam(p, e.target.value)}
                      data-testid={`pc-param-${p.name}`}
                    >
                      <option value="">{t(p.name === 'from' ? 'builder.supply' : 'builder.drain')}</option>
                      {tanks.map((tk) => (
                        <option key={tk.id} value={tk.id}>
                          {tk.label || t('builder.kinds.tank')}
                        </option>
                      ))}
                    </select>
                  </label>
                );
            }
          })}
        </fieldset>
      )}

      <p className="muted small mono">
        x {c.x} · y {c.y}
        {COMPONENT_DEFS[c.kind].resize !== 'none' ? ` · ${c.w}×${c.h}` : ''}
      </p>
      <div className="row">
        <button onClick={onDuplicate}>{t('builder.duplicate')}</button>
        <button className="danger" onClick={onDelete} data-testid="pc-delete">
          {t('builder.delete')}
        </button>
      </div>
    </div>
  );
}
