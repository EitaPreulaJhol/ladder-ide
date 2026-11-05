import { useTranslation } from 'react-i18next';
import type { TankPidState } from '@ladder/core';
import { bit, type PlantProps } from './common.tsx';

export function TankPidPlant({ state, values, action, setInput }: PlantProps<TankPidState>) {
  const { t } = useTranslation();
  const top = 30;
  const h = 140;
  const lvlY = (l: number) => top + h - l * h;
  const sp = typeof values?.SP_PCT === 'number' ? values.SP_PCT : 50;
  const auto = bit(values, 'PID_ON');
  return (
    <>
      <svg viewBox="0 0 340 200" className="plant-svg">
        <path
          d={`M10 ${top + 10} H110 V${top - 10}`}
          stroke="#38bdf8"
          strokeOpacity={0.25 + state.valve * 0.75}
          strokeWidth={2 + state.valve * 6}
          fill="none"
        />
        {/* proportional valve: bow-tie with an opening bar */}
        <path d={`M40 ${top} l14 10 l-14 10 z M68 ${top} l-14 10 l14 10 z`} fill="#1e293b" stroke="#94a3b8" />
        <rect x={42} y={top + 26} width={24} height={4} rx={2} fill="#1e293b" />
        <rect x={42} y={top + 26} width={24 * state.valve} height={4} rx={2} fill="#38bdf8" />
        <text x={54} y={top + 42} textAnchor="middle" className="plant-label">
          {t('plant.tankPid.valve', { p: Math.round(state.valve * 100) })}
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
        <line
          x1={96}
          x2={224}
          y1={lvlY(sp / 100)}
          y2={lvlY(sp / 100)}
          stroke="#facc15"
          strokeWidth={1.5}
          strokeDasharray="5 3"
        />
        <text x={228} y={lvlY(sp / 100) + 4} className="plant-label strong">
          SP {Math.round(sp)}%
        </text>
        <path
          d={`M160 ${top + h} V${top + h + 18} H300`}
          stroke={state.demand > 0 ? '#38bdf8' : '#475569'}
          strokeWidth={2 + state.demand * 5}
          fill="none"
        />
        <text x={160} y={top + h / 2} textAnchor="middle" className="plant-big">
          {Math.round(state.level * 100)}%
        </text>
        <text x={330} y={20} textAnchor="end" className={auto ? 'plant-label strong' : 'plant-alert'}>
          {auto ? 'AUTO' : 'MANUAL'}
        </text>
      </svg>
      <div className={state.overflows ? 'plant-msg error' : 'plant-msg'}>
        {t('plant.tank.overflows', { n: state.overflows })}
      </div>
      <div className="plant-controls">
        <label className="slider">
          {t('plant.tankPid.setpoint')}: {Math.round(sp)}%
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(sp)}
            onChange={(e) => action('setpoint', Number(e.target.value))}
            data-testid="pid-sp"
          />
        </label>
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
        <label className="check">
          <input type="checkbox" checked={auto} onChange={(e) => setInput('PID_ON', e.target.checked)} />{' '}
          {t('plant.tankPid.auto')}
        </label>
      </div>
    </>
  );
}
