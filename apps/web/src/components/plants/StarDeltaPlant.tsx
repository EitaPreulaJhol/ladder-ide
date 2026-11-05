import { useTranslation } from 'react-i18next';
import type { StarDeltaState } from '@ladder/core';
import { Bar, bit, Contactor, Motor, PlantButton, type PlantProps } from './common.tsx';

export function StarDeltaPlant({ state, values, setInput, action }: PlantProps<StarDeltaState>) {
  const { t } = useTranslation();
  const k1 = bit(values, 'K1_MAIN');
  const k2 = bit(values, 'K2_STAR');
  const k3 = bit(values, 'K3_DELTA');
  return (
    <>
      <svg viewBox="0 0 340 200" className="plant-svg">
        <Contactor on={k1} x={20} y={20} label="K1" />
        <Contactor on={k2} x={20} y={70} label="K2 Y" />
        <Contactor on={k3} x={20} y={120} label="K3 Δ" />
        <path d="M64 35 H150 V100" stroke={k1 ? '#22c55e' : '#475569'} strokeWidth={2} fill="none" />
        <path d="M64 85 H120 V100 H150" stroke={k2 ? '#22c55e' : '#475569'} strokeWidth={2} fill="none" />
        <path d="M64 135 H120 V110 H150" stroke={k3 ? '#22c55e' : '#475569'} strokeWidth={2} fill="none" />
        <Motor x={200} y={100} speed={state.speed} />
        <Bar
          x={20}
          y={180}
          w={200}
          h={10}
          value={state.current / 7}
          color={state.current > 3 ? '#ef4444' : '#22c55e'}
          label={t('plant.starDelta.current', { i: state.current.toFixed(1) })}
        />
        <text x={250} y={30} className="plant-label">
          {t('plant.starDelta.mode')}:
        </text>
        <text
          x={250}
          y={46}
          className={
            state.mode === 'short' || state.mode === 'directDelta' ? 'plant-alert' : 'plant-label strong'
          }
        >
          {t(`plant.starDelta.modes.${state.mode}`)}
        </text>
      </svg>
      {state.shortCircuit && <div className="plant-msg error">{t('plant.starDelta.shortCircuit')}</div>}
      {state.highCurrentStarts > 0 && (
        <div className="plant-msg warn">
          {t('plant.starDelta.highCurrent', { n: state.highCurrentStarts })}
        </div>
      )}
      <div className="plant-controls">
        <PlantButton tag="B_START" label={t('plant.start')} color="#16a34a" setInput={setInput} />
        <PlantButton tag="B_STOP" label={t('plant.stop')} color="#dc2626" nc setInput={setInput} />
        <button onClick={() => action('resetFault')}>{t('plant.starDelta.resetFault')}</button>
      </div>
    </>
  );
}
