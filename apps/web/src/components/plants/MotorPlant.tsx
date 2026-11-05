import { useTranslation } from 'react-i18next';
import type { MotorState } from '@ladder/core';
import { Bar, bit, Contactor, Lamp, Motor, PlantButton, type PlantProps } from './common.tsx';

export function MotorPlant({ state, values, setInput, action }: PlantProps<MotorState>) {
  const { t } = useTranslation();
  return (
    <>
      <svg viewBox="0 0 340 190" className="plant-svg">
        <text x={10} y={18} className="plant-label">
          {t('plant.motor.panel')}
        </text>
        <Lamp on={bit(values, 'H_RUN')} color="#22c55e" x={30} y={45} label="H_RUN" />
        <Lamp on={bit(values, 'H_FAULT')} color="#ef4444" x={80} y={45} label="H_FAULT" />
        <Contactor on={bit(values, 'K_MOTOR')} x={140} y={30} label="K_MOTOR" />
        <rect
          x={210}
          y={30}
          width={44}
          height={30}
          rx={4}
          fill={state.tripped ? '#7f1d1d' : '#1e293b'}
          stroke={state.tripped ? '#ef4444' : '#475569'}
        />
        <text x={232} y={49} textAnchor="middle" className="plant-label strong">
          F_OVL
        </text>
        <line
          x1={162}
          y1={60}
          x2={162}
          y2={100}
          stroke={bit(values, 'K_MOTOR') ? '#22c55e' : '#475569'}
          strokeWidth={2}
        />
        <line x1={162} y1={100} x2={232} y2={100} stroke="#475569" strokeWidth={2} />
        <line x1={232} y1={60} x2={232} y2={100} stroke="#475569" strokeWidth={2} />
        <Motor x={290} y={120} speed={state.speed} />
        <line x1={232} y1={100} x2={262} y2={110} stroke="#475569" strokeWidth={2} />
        <Bar
          x={20}
          y={140}
          w={180}
          h={12}
          value={state.temperature}
          color={state.temperature > 0.8 ? '#ef4444' : '#f59e0b'}
          label={t('plant.motor.temperature')}
        />
        {state.tripped && (
          <text x={20} y={178} className="plant-alert">
            {t('plant.motor.tripped')}
          </text>
        )}
        <text x={330} y={18} textAnchor="end" className="plant-label">
          {t('plant.motor.starts', { n: state.starts })}
        </text>
      </svg>
      <div className="plant-controls">
        <PlantButton tag="B_START" label={t('plant.start')} color="#16a34a" setInput={setInput} />
        <PlantButton tag="B_STOP" label={t('plant.stop')} color="#dc2626" nc setInput={setInput} />
        <button className={state.heavyLoad ? 'active' : ''} onClick={() => action('toggleLoad')}>
          {state.heavyLoad ? t('plant.motor.loadOn') : t('plant.motor.load')}
        </button>
        <button onClick={() => action('resetRelay')} disabled={!state.tripped}>
          {t('plant.motor.resetRelay')}
        </button>
      </div>
    </>
  );
}
