import { useMemo, useState } from 'react';
import { locale } from '../i18n.ts';
import { useTranslation } from 'react-i18next';
import {
  catalogFor,
  compareHardware,
  channelType,
  createModule,
  expansionSlots,
  FAMILIES,
  familyCpu,
  getDialect,
  getFamily,
  ioList,
  ioListCsv,
  moduleInfo,
  nextFreeSlot,
  setPlcModel,
  tagsCsv,
  type FamilyId,
  type HardwareModule,
} from '@ladder/core';
import { useProject } from '../store/project.ts';
import { downloadText, safeFileName } from '../storage/db.ts';
import { ModbusPanel } from './ModbusPanel.tsx';
import { updateWithUndo } from '../store/undoable.ts';
import { toast } from '../store/toast.ts';

const KIND_COLOR: Record<string, string> = {
  PS: '#a855f7',
  CPU: '#3b82f6',
  DI: '#22c55e',
  DO: '#f97316',
  AI: '#06b6d4',
  AO: '#eab308',
};

export function HardwareView() {
  const { t } = useTranslation();
  const project = useProject((s) => s.project);
  const readOnly = useProject((s) => s.sharedId !== null);
  const update = useProject((s) => s.update);
  const hw = project.hardware;
  const family = getFamily(hw.family);
  const cpu = familyCpu(hw);
  const catalog = catalogFor(hw);
  const [catalogId, setCatalogId] = useState<string>('');
  const selectedCatalog =
    catalog.find((c) => c.id === catalogId) ?? catalog.find((c) => c.kind === 'DI') ?? catalog[0]!;
  const rows = useMemo(() => ioList(project), [project]);
  const count = (k: string) => hw.modules.filter((m) => m.kind === k).reduce((a, m) => a + m.channels, 0);

  // Generic racks show every slot; real families show the CPU slot plus the expansion slots the CPU accepts.
  const displaySlots = family
    ? [family.cpuSlot, ...expansionSlots(hw)]
    : Array.from({ length: hw.slots }, (_, i) => i);

  const changeModel = (familyId: FamilyId, cpuId?: string) => {
    if (familyId === hw.family && cpuId === hw.cpu) return;
    setCatalogId('');
    // Applied at once; the toast says what changed in the rack and the tags, with "Undo".
    updateWithUndo(
      (d) => setPlcModel(d, familyId, cpuId),
      (before, after) => {
        const c = compareHardware(before, after);
        const fam = getFamily(after.hardware.family);
        const model = fam ? `${fam.vendor} ${familyCpu(after.hardware)?.name ?? fam.name}` : t('hw.generic');
        const parts = [
          c.removedModules && t('hw.changedModules', { count: c.removedModules }),
          c.moved.length && t('hw.changedMoved', { count: c.moved.length }),
          c.unbound.length && t('hw.changedUnbound', { names: c.unbound.join(', ') }),
          c.dialectChanged && t('hw.changedDialect', { dialect: getDialect(after.dialect).name }),
        ].filter(Boolean);
        return { message: t('hw.changed', { model }), detail: parts.join(' · ') || t('hw.changedNothing') };
      },
    );
  };

  const addAt = (slot: number) =>
    update((d) => {
      d.hardware.modules.push(createModule(selectedCatalog.id, slot, d.hardware));
    });
  const addFirstFree = () => {
    if (family) {
      const slot = nextFreeSlot(hw);
      if (slot === null)
        return void toast(t('hw.cpuFull', { cpu: cpu?.name, max: cpu?.maxModules ?? 0 }), { kind: 'error' });
      return addAt(slot);
    }
    const used = new Set(hw.modules.map((m) => m.slot));
    for (let s = 0; s < hw.slots; s++) if (!used.has(s)) return addAt(s);
    toast(t('hw.slotFull'), { kind: 'error' });
  };
  const removeModule = (m: HardwareModule) => {
    const bound = project.tags.filter((tg) => tg.io?.module === m.id).map((tg) => tg.name);
    updateWithUndo(
      (d) => {
        d.hardware.modules = d.hardware.modules.filter((x) => x.id !== m.id);
        for (const tg of d.tags) if (tg.io?.module === m.id) delete tg.io;
      },
      {
        message: t('hw.moduleRemoved', { kind: m.kind, slot: m.slot }),
        detail: bound.length ? t('hw.changedUnbound', { names: bound.join(', ') }) : undefined,
      },
    );
  };

  const createTag = (moduleId: string, channel: number, kind: string) => {
    const prefix = { DI: 'DI', DO: 'DO', AI: 'AI', AO: 'AO' }[kind] ?? 'IO';
    const slot = hw.modules.find((m) => m.id === moduleId)?.slot ?? 0;
    let name = `${prefix}_${slot}_${channel}`;
    let i = 2;
    while (project.tags.some((tg) => tg.name === name)) name = `${prefix}_${slot}_${channel}_${i++}`;
    update((d) => {
      d.tags.push({
        name,
        type: channelType(kind as HardwareModule['kind']),
        io: { module: moduleId, channel },
      });
    });
  };

  const leds = (m: HardwareModule) => (
    <div className="leds" title={m.kind}>
      {Array.from({ length: m.channels }, (_, ch) => {
        const bound = project.tags.some((tg) => tg.io?.module === m.id && tg.io.channel === ch);
        return (
          <span
            key={ch}
            className={bound ? 'led bound' : 'led'}
            style={{ '--mod': KIND_COLOR[m.kind] } as React.CSSProperties}
            title={`${m.kind} ${ch}`}
          />
        );
      })}
    </div>
  );

  return (
    <div className="view hardware">
      <div className="print-only">
        <h1>{t('hw.printTitle', { name: project.meta.name })}</h1>
        <p>
          {t('hw.printDate', {
            date: new Date().toLocaleString(locale()),
            dialect: getDialect(project.dialect).name,
          })}
          {cpu && ` · ${family!.vendor} ${cpu.name}`}
        </p>
      </div>
      <div className="view-head no-print">
        <h2>{t('hw.title')}</h2>
        <span className="grow" />
        <button
          onClick={() =>
            downloadText(`${safeFileName(project.meta.name)}-io.csv`, ioListCsv(project), 'text/csv')
          }
        >
          {t('hw.exportIo')}
        </button>
        <button
          onClick={() =>
            downloadText(`${safeFileName(project.meta.name)}-tags.csv`, tagsCsv(project), 'text/csv')
          }
        >
          {t('hw.exportTags')}
        </button>
        <button onClick={() => window.print()}>{t('hw.print')}</button>
      </div>

      <section className="card model-card no-print">
        <div className="model-row">
          <label className="field">
            <span>{t('hw.family')}</span>
            <select
              value={hw.family}
              disabled={readOnly}
              data-testid="family-select"
              onChange={(e) =>
                changeModel(e.target.value as FamilyId, getFamily(e.target.value as FamilyId)?.cpus[0]?.id)
              }
            >
              <option value="generic">{t('hw.generic')}</option>
              {FAMILIES.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.vendor} — {f.name}
                </option>
              ))}
            </select>
          </label>
          {family && (
            <label className="field">
              <span>{t('hw.cpu')}</span>
              <select
                value={hw.cpu}
                disabled={readOnly}
                data-testid="cpu-select"
                onChange={(e) => changeModel(hw.family, e.target.value)}
              >
                {family.cpus.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.onboard.DI} DI / {c.onboard.DO} DO
                    {c.onboard.AI ? ` / ${c.onboard.AI} AI` : ''}
                    {c.onboard.AO ? ` / ${c.onboard.AO} AO` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {family && cpu ? (
          <>
            <p className="muted small">
              {cpu.partNumber && <span className="mono">{cpu.partNumber}</span>} · {cpu.description} ·{' '}
              {t('hw.maxModules', { n: cpu.maxModules })} ·{' '}
              {t('hw.dialectFromFamily', { dialect: getDialect(family.dialect).name })}
            </p>
            {family.unverified.length > 0 && (
              <div className="notice warn">
                <strong>{t('hw.unverified')}</strong>
                <ul>
                  {family.unverified.map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              </div>
            )}
            <details className="small">
              <summary>{t('hw.sources')}</summary>
              <ul>
                {family.sources.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} target="_blank" rel="noreferrer noopener">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
              <p className="muted">{t('hw.disclaimer')}</p>
            </details>
          </>
        ) : (
          <p className="muted small">{t('hw.help')}</p>
        )}
      </section>

      <div className="rack-head">
        <label className="field inline">
          <span>{t('hw.rack')}</span>
          <input
            defaultValue={hw.rackName}
            readOnly={readOnly}
            onBlur={(e) => update((d) => void (d.hardware.rackName = e.target.value))}
          />
        </label>
        {!family && (
          <label className="field inline">
            <span>{t('hw.slots')}</span>
            <input
              type="number"
              min={Math.max(1, ...hw.modules.map((m) => m.slot + 1))}
              max={32}
              value={hw.slots}
              readOnly={readOnly}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (n >= 1 && n <= 32 && hw.modules.every((m) => m.slot < n))
                  update((d) => void (d.hardware.slots = n));
              }}
            />
          </label>
        )}
        <span className="muted small">
          {t('hw.summary', {
            di: count('DI'),
            do: count('DO'),
            ai: count('AI'),
            ao: count('AO'),
            used: project.tags.filter((tg) => tg.io).length,
          })}
        </span>
      </div>

      <div className="rack">
        {displaySlots.map((slot) => {
          const here = hw.modules.filter((m) => m.slot === slot);
          const main = here.find((m) => !m.embedded);
          const embedded = here.filter((m) => m.embedded);
          const info = main && moduleInfo(hw, main);
          const fixed = !!family && main?.kind === 'CPU';
          return (
            <div
              key={slot}
              className={`rack-slot${main ? ' filled' : ''}${embedded.length ? ' cpu-wide' : ''}`}
              style={main ? ({ '--mod': KIND_COLOR[main.kind] } as React.CSSProperties) : undefined}
              data-testid={`rack-slot-${slot}`}
            >
              <div className="slot-num">{slot}</div>
              {main && info ? (
                <>
                  <div className="mod-kind">{main.kind}</div>
                  <div className="mod-name">{info.name}</div>
                  {info.partNumber && info.partNumber !== info.name && (
                    <div className="mod-part mono">{info.partNumber}</div>
                  )}
                  {embedded.map((m) => (
                    <div key={m.id} className="embedded-group">
                      <span className="mono small">
                        {m.channels} {m.kind}
                      </span>
                      {leds(m)}
                    </div>
                  ))}
                  {main.channels > 0 && leds(main)}
                  {!readOnly && !fixed && (
                    <div className="mod-actions no-print">
                      {!family && (
                        <input
                          placeholder={t('hw.label')}
                          defaultValue={main.label ?? ''}
                          onBlur={(e) =>
                            update((d) => {
                              const x = d.hardware.modules.find((y) => y.id === main.id);
                              if (x) x.label = e.target.value || undefined;
                            })
                          }
                        />
                      )}
                      <button
                        className="icon danger"
                        title={t('hw.remove')}
                        onClick={() => removeModule(main)}
                      >
                        ×
                      </button>
                    </div>
                  )}
                </>
              ) : (
                !readOnly && (
                  <button
                    className="slot-add no-print"
                    onClick={() => addAt(slot)}
                    title={selectedCatalog.name}
                  >
                    ＋
                  </button>
                )
              )}
            </div>
          );
        })}
        {family && cpu && cpu.maxModules === 0 && (
          <div className="rack-note muted small">{t('hw.noExpansion')}</div>
        )}
      </div>

      {!readOnly && (family ? cpu!.maxModules > 0 : true) && (
        <div className="catalog no-print">
          <strong>{t('hw.catalog')}:</strong>
          <select
            value={selectedCatalog.id}
            onChange={(e) => setCatalogId(e.target.value)}
            data-testid="catalog-select"
          >
            {catalog.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.partNumber && c.partNumber !== c.name ? ` (${c.partNumber})` : ''} — {c.description}
              </option>
            ))}
          </select>
          <button onClick={addFirstFree} data-testid="add-module">
            {t('hw.add')}
          </button>
        </div>
      )}

      <h3>{t('hw.ioList')}</h3>
      <table className="grid io-list">
        <thead>
          <tr>
            <th>{t('hw.slot')}</th>
            <th>{t('hw.module')}</th>
            <th>{t('hw.kind')}</th>
            <th>{t('hw.channel')}</th>
            <th>{t('hw.address')}</th>
            <th>{t('hw.tag')}</th>
            <th>{t('hw.comment')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.moduleId}:${r.channel}`} className={r.tag ? '' : 'unused'}>
              <td>{r.slot}</td>
              <td>{r.moduleName}</td>
              <td>{r.kind}</td>
              <td>{r.channel}</td>
              <td className="mono" data-testid={`io-${r.kind}-${r.channel}-${r.slot}`}>
                {r.address}
              </td>
              <td className="mono">
                {r.tag?.name ??
                  (!readOnly && (
                    <button
                      className="link no-print"
                      onClick={() => createTag(r.moduleId, r.channel, r.kind)}
                    >
                      {t('hw.createTag')}
                    </button>
                  ))}
              </td>
              <td>{r.tag?.comment}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ModbusPanel />
    </div>
  );
}
