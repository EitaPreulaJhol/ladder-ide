import { useTranslation } from 'react-i18next';
import { TANK, type TankState } from '@ladder/core';
import { bit, Lamp, type PlantProps } from './common.tsx';

export function TankPlant({ state, values, action }: PlantProps<TankState>) {
  const { t } = useTranslation();
  const pump = bit(values, 'P_FILL');
  const top = 30;
  const h = 140;
  const lvlY = (l: number) => top + h - l * h;
  return (
    <>
      <svg viewBox="0 0 340 200" className="plant-svg">
        <path
          d={`M40 ${top + 10} H110 V${top - 10}`}
          stroke={pump ? '#38bdf8' : '#475569'}
          strokeWidth={6}
          fill="none"
        />
        <circle
          cx={40}
          cy={top + 10}
          r={16}
          fill={pump ? '#0c4a6e' : '#1e293b'}
          stroke={pump ? '#38bdf8' : '#475569'}
          strokeWidth={2}
        />
        <text x={40} y={top + 46} textAnchor="middle" className="plant-label">
          P_FILL
        </text>
        <rect x={100} y={top} width={120} height={h} fill="#0f172a" stroke="#64748b" strokeWidth={2} />
        <rect
          x={102}
          y={lvlY(state.level)}
          width={116}
          height={state.level * h}
          fill="#0284c7"
          opacity={0.85}
        />
        {[
          ['LSH', TANK.lsh],
          ['LSL', TANK.lsl],
        ].map(([name, l]) => (
          <g key={name as string}>
            <line
              x1={220}
              y1={lvlY(l as number)}
              x2={240}
              y2={lvlY(l as number)}
              stroke="#94a3b8"
              strokeWidth={2}
            />
            <Lamp on={bit(values, name as string)} color="#38bdf8" x={250} y={lvlY(l as number)} r={6} />
            <text x={262} y={lvlY(l as number) + 4} className="plant-label">
              {name}
            </text>
          </g>
        ))}
        <path
          d={`M160 ${top + h} V${top + h + 18} H300`}
          stroke={state.demand > 0 ? '#38bdf8' : '#475569'}
          strokeWidth={6}
          fill="none"
        />
        <text x={160} y={top + h / 2} textAnchor="middle" className="plant-big">
          {Math.round(state.level * 100)}%
        </text>
        <Lamp on={bit(values, 'H_ALARM')} color="#ef4444" x={310} y={120} r={10} label="H_ALARM" />
        {state.dryRun && (
          <text x={110} y={20} className="plant-alert">
            {t('plant.tank.dryRun')}
          </text>
        )}
      </svg>
      <div className={state.overflows ? 'plant-msg error' : 'plant-msg'}>
        {t('plant.tank.overflows', { n: state.overflows })}
      </div>
      <div className="plant-controls">
        <label className="slider">
          {t('plant.tank.demand')}: {Math.round(state.demand * 100)}%
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(state.demand * 100)}
            onChange={(e) => action('demand', Number(e.target.value) / 100)}
          />
        </label>
        <button onClick={() => action('resetFault')}>{t('plant.tank.resetFault')}</button>
      </div>
    </>
  );
}
