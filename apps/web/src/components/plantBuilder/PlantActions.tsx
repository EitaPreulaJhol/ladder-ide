import { useTranslation } from 'react-i18next';
import {
  numParam,
  strParam,
  type FeederCompState,
  type MotorCompState,
  type OvenCompState,
  type PlantComponent,
  type PlantDesign,
  type PlantState,
  type TankCompState,
} from '@ladder/core';
import { useSim } from '../../store/sim.ts';

/** Operator / plant actions that have no device on the drawing (feed a part, overload the motor...). */
export function PlantActions({ design, only }: { design: PlantDesign; only?: string }) {
  const { t } = useTranslation();
  const state = useSim((s) => s.scenarioState) as PlantState | null;
  const plantAction = useSim((s) => s.plantAction);
  const comps = state?.comps ?? {};
  const act = (c: PlantComponent, a: string, v?: unknown) => plantAction(`${c.id}:${a}`, v);

  const rows = design.components
    .filter((c) => !only || c.id === only)
    .map((c) => {
      const s = comps[c.id];
      let buttons: React.ReactNode = null;
      switch (c.kind) {
        case 'feeder': {
          const f = s as FeederCompState | undefined;
          buttons = (
            <>
              <button onClick={() => act(c, 'drop', 'tall')}>{t('builder.act.dropTall')}</button>
              <button onClick={() => act(c, 'drop', 'short')}>{t('builder.act.dropShort')}</button>
              {numParam(c, 'interval') > 0 && (
                <label className="check">
                  <input type="checkbox" checked={f?.auto ?? true} onChange={() => act(c, 'toggleAuto')} />
                  {t('builder.act.auto')}
                </label>
              )}
            </>
          );
          break;
        }
        case 'bin':
          buttons = <button onClick={() => act(c, 'empty')}>{t('builder.act.empty')}</button>;
          break;
        case 'motor': {
          const m = s as MotorCompState | undefined;
          buttons = (
            <>
              <button className={m?.heavy ? 'active' : ''} onClick={() => act(c, 'toggleLoad')}>
                {t('builder.act.heavyLoad')}
              </button>
              {m?.tripped && (
                <button onClick={() => act(c, 'resetRelay')} disabled={m.temperature >= 0.6}>
                  {t('builder.act.resetRelay')}
                </button>
              )}
              {(m?.short || !!m?.hardStarts) && (
                <button className="danger" onClick={() => act(c, 'resetFault')}>
                  {m.short ? t('builder.act.shortCircuit') : t('builder.act.hardStarts', { n: m.hardStarts })}
                </button>
              )}
            </>
          );
          break;
        }
        case 'tank': {
          const tk = s as TankCompState | undefined;
          if (tk?.overflows)
            buttons = (
              <button className="danger" onClick={() => act(c, 'resetFault')}>
                {t('builder.act.overflows', { n: tk.overflows })}
              </button>
            );
          break;
        }
        case 'oven': {
          const o = s as OvenCompState | undefined;
          if (o?.overheats)
            buttons = (
              <button className="danger" onClick={() => act(c, 'resetFault')}>
                {t('builder.act.overheats', { n: o.overheats })}
              </button>
            );
          break;
        }
        case 'valve':
          if (strParam(c, 'mode') !== 'manual') break;
          buttons = <span className="muted small">{t('builder.act.manualValve')}</span>;
          break;
      }
      return buttons ? (
        <div key={c.id} className="plant-action-row">
          <span className="mono small">{c.label || t(`builder.kinds.${c.kind}`)}</span>
          {buttons}
        </div>
      ) : null;
    })
    .filter(Boolean);

  const lost = state?.lost ?? 0;
  if (!rows.length && !lost) return null;
  return (
    <div className="plant-actions">
      {rows}
      {!!lost && !only && <span className="plant-msg warn">{t('builder.lost', { n: lost })}</span>}
    </div>
  );
}

export function OperateHelp({ design, className }: { design: PlantDesign; className: string }) {
  const { t } = useTranslation();
  const feeder = design.components.some((c) => c.kind === 'feeder');
  return (
    <p className={className}>
      {t('builder.operateHelp')}
      {feeder && ` ${t('builder.operateFeeder')}`}
    </p>
  );
}
