import { useTranslation } from 'react-i18next';
import type { TrafficState } from '@ladder/core';
import { bit, Lamp, PlantButton, type PlantProps } from './common.tsx';

export function TrafficPlant({ state, values, setInput, action }: PlantProps<TrafficState>) {
  const { t } = useTranslation();
  return (
    <>
      <svg viewBox="0 0 340 200" className="plant-svg">
        <rect x={0} y={120} width={340} height={60} fill="#1e293b" />
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <rect
            key={i}
            x={200 + (i % 2) * 0}
            y={124 + i * 8}
            width={50}
            height={4}
            fill="#e5e7eb"
            opacity={0.7}
          />
        ))}
        <rect x={60} y={10} width={44} height={110} rx={8} fill="#0f172a" stroke="#475569" />
        <Lamp on={bit(values, 'L_RED')} color="#ef4444" x={82} y={34} r={13} />
        <Lamp on={bit(values, 'L_YELLOW')} color="#facc15" x={82} y={65} r={13} />
        <Lamp on={bit(values, 'L_GREEN')} color="#22c55e" x={82} y={96} r={13} />
        <text x={82} y={196} textAnchor="middle" className="plant-label">
          Veículos
        </text>
        <rect x={270} y={30} width={36} height={76} rx={8} fill="#0f172a" stroke="#475569" />
        <Lamp on={bit(values, 'P_RED')} color="#ef4444" x={288} y={52} r={11} />
        <Lamp on={bit(values, 'P_GREEN')} color="#22c55e" x={288} y={84} r={11} />
        <text x={288} y={196} textAnchor="middle" className="plant-label">
          Pedestres
        </text>
        {state.conflict && <rect x={0} y={120} width={340} height={60} fill="#ef4444" opacity={0.35} />}
      </svg>
      <div className={state.conflicts ? 'plant-msg error' : 'plant-msg'}>
        {t('plant.traffic.conflicts', { n: state.conflicts })}
      </div>
      {state.multipleCarLights && <div className="plant-msg warn">{t('plant.traffic.multiple')}</div>}
      <div className="plant-controls">
        <PlantButton tag="B_PED" label={t('plant.traffic.button')} color="#3b82f6" setInput={setInput} />
        <button onClick={() => action('resetFault')}>{t('plant.traffic.resetFault')}</button>
      </div>
    </>
  );
}
