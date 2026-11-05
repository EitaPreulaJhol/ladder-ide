import { useTranslation } from 'react-i18next';
import type { CylindersState } from '@ladder/core';
import { bit, Lamp, PlantButton, type PlantProps } from './common.tsx';

function CylinderSvg({
  x,
  y,
  pos,
  label,
  vertical,
}: {
  x: number;
  y: number;
  pos: number;
  label: string;
  vertical?: boolean;
}) {
  const len = 110;
  const rod = 18 + pos * 70;
  return vertical ? (
    <g>
      <rect x={x - 16} y={y} width={32} height={len - 40} rx={3} fill="#1e293b" stroke="#94a3b8" />
      <rect x={x - 14} y={y + 4 + pos * 30} width={28} height={8} fill="#64748b" />
      <rect x={x - 4} y={y + 12 + pos * 30} width={8} height={rod - 10} fill="#cbd5e1" />
      <rect x={x - 14} y={y + 2 + pos * 30 + rod} width={28} height={8} rx={2} fill="#94a3b8" />
      <text x={x + 22} y={y + 14} className="plant-label strong">
        {label}
      </text>
    </g>
  ) : (
    <g>
      <rect x={x} y={y - 16} width={len - 40} height={32} rx={3} fill="#1e293b" stroke="#94a3b8" />
      <rect x={x + 4 + pos * 30} y={y - 14} width={8} height={28} fill="#64748b" />
      <rect x={x + 12 + pos * 30} y={y - 4} width={rod - 10} height={8} fill="#cbd5e1" />
      <rect x={x + 2 + pos * 30 + rod} y={y - 14} width={8} height={28} rx={2} fill="#94a3b8" />
      <text x={x} y={y - 22} className="plant-label strong">
        {label}
      </text>
    </g>
  );
}

export function CylindersPlant({ state, values, setInput, action }: PlantProps<CylindersState>) {
  const { t } = useTranslation();
  return (
    <>
      <svg viewBox="0 0 340 210" className="plant-svg">
        <CylinderSvg x={20} y={140} pos={state.a.pos} label={t('plant.cylinders.cylA')} />
        <Lamp on={bit(values, 'A0')} color="#38bdf8" x={34} y={176} r={6} label="A0" />
        <Lamp on={bit(values, 'A1')} color="#38bdf8" x={94} y={176} r={6} label="A1" />
        <CylinderSvg x={250} y={20} pos={state.b.pos} label={t('plant.cylinders.cylB')} vertical />
        <Lamp on={bit(values, 'B0')} color="#38bdf8" x={290} y={40} r={6} label="B0" />
        <Lamp on={bit(values, 'B1')} color="#38bdf8" x={290} y={86} r={6} label="B1" />
        {/* workpiece clamped by A and stamped by B */}
        <rect x={150} y={118} width={60} height={44} rx={3} fill="#a16207" stroke="#fbbf24" opacity={0.85} />
        <Lamp on={bit(values, 'Y_A')} color="#f97316" x={160} y={62} r={7} label="Y_A" />
        <Lamp on={bit(values, 'Y_B')} color="#f97316" x={200} y={62} r={7} label="Y_B" />
        <text x={10} y={18} className="plant-label">
          {t('plant.cylinders.cycles', { n: state.cycles })}
        </text>
        <text x={10} y={32} className={state.wrongCycles ? 'plant-alert' : 'plant-label'}>
          {t('plant.cylinders.wrong', { n: state.wrongCycles })}
        </text>
        <text x={10} y={204} className="plant-label">
          {state.events.length ? state.events.join(' → ') : t('plant.cylinders.idle')}
        </text>
      </svg>
      {state.lastCycleOk === false && <div className="plant-msg error">{t('plant.cylinders.lastWrong')}</div>}
      <div className="plant-controls">
        <PlantButton tag="B_START" label={t('plant.cylinders.start')} color="#16a34a" setInput={setInput} />
        <button onClick={() => action('resetFault')}>{t('plant.cylinders.reset')}</button>
      </div>
    </>
  );
}
