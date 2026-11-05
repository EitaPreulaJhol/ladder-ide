import { useTranslation } from 'react-i18next';
import { BELT, type ConveyorState } from '@ladder/core';
import { bit, PlantButton, type PlantProps } from './common.tsx';

const X0 = 20;
const LEN = 300;
const BELT_Y = 120;

export function ConveyorPlant({ state, values, setInput, action }: PlantProps<ConveyorState>) {
  const { t } = useTranslation();
  const run = bit(values, 'M_BELT');
  const sx = (x: number) => X0 + x * LEN;
  const sensors: [string, number][] = [
    ['S_ENTRY', BELT.entry],
    ['S_HIGH', BELT.high],
    ['S_PUSH', BELT.push],
    ['S_END', BELT.end],
  ];
  return (
    <>
      <svg viewBox="0 0 340 214" className="plant-svg">
        <rect
          x={sx(BELT.push) - 22}
          y={30}
          width={44}
          height={36}
          fill="#1e293b"
          stroke="#475569"
          strokeDasharray="4 3"
        />
        <text x={sx(BELT.push)} y={26} textAnchor="middle" className="plant-label">
          rejeito
        </text>
        <rect
          x={X0}
          y={BELT_Y}
          width={LEN}
          height={14}
          rx={7}
          fill="#334155"
          stroke={run ? '#22c55e' : '#64748b'}
          strokeWidth={2}
        />
        <g className={run ? 'belt-run' : undefined}>
          <line
            x1={X0 + 6}
            y1={BELT_Y + 7}
            x2={X0 + LEN - 6}
            y2={BELT_Y + 7}
            stroke="#64748b"
            strokeDasharray="6 8"
            strokeWidth={2}
          />
        </g>
        {state.boxes.map((b) => {
          const h = b.tall ? 40 : 22;
          const w = BELT.box * LEN;
          return (
            <rect
              key={b.id}
              x={sx(b.x) - w / 2}
              y={BELT_Y - h - b.off * 60}
              width={w}
              height={h}
              rx={2}
              fill={b.tall ? '#b45309' : '#a16207'}
              stroke="#fbbf24"
              opacity={1 - b.off * 0.7}
            />
          );
        })}
        {/* pusher, pushing towards the reject bin (up in the drawing) */}
        <rect
          x={sx(BELT.push) - 14}
          y={BELT_Y + 16 + (1 - state.pusher) * 20 - 20}
          width={28}
          height={8}
          fill="#94a3b8"
        />
        <rect
          x={sx(BELT.push) - 4}
          y={BELT_Y + 24 + (1 - state.pusher) * 20 - 20}
          width={8}
          height={40}
          fill="#64748b"
        />
        <rect
          x={sx(BELT.push) - 18}
          y={BELT_Y + 44}
          width={36}
          height={22}
          rx={3}
          fill={bit(values, 'Y_PUSH') ? '#14532d' : '#1e293b'}
          stroke="#475569"
        />
        <text x={sx(BELT.push)} y={BELT_Y + 59} textAnchor="middle" className="plant-label">
          Y_PUSH
        </text>
        {sensors.map(([name, x]) => (
          <g key={name}>
            <line
              x1={sx(x)}
              y1={name === 'S_HIGH' ? BELT_Y - 34 : BELT_Y - 12}
              x2={sx(x)}
              y2={BELT_Y - 60}
              stroke={bit(values, name) ? '#f43f5e' : '#334155'}
              strokeWidth={2}
              strokeDasharray="3 2"
            />
            <circle cx={sx(x)} cy={BELT_Y - 64} r={5} fill={bit(values, name) ? '#f43f5e' : '#475569'} />
            <text
              x={sx(x)}
              y={name === 'S_PUSH' ? 90 : BELT_Y - 74}
              textAnchor="middle"
              className="plant-label"
            >
              {name}
            </text>
          </g>
        ))}
        <text x={X0} y={208} className="plant-label">
          {t('plant.conveyor.ok', { n: state.sortedOk })}
        </text>
        <text x={X0 + 200} y={208} className={state.sortedWrong ? 'plant-alert' : 'plant-label'}>
          {t('plant.conveyor.wrong', { n: state.sortedWrong })}
        </text>
      </svg>
      <div className="plant-controls">
        <PlantButton tag="B_START" label={t('plant.start')} color="#16a34a" setInput={setInput} />
        <PlantButton tag="B_STOP" label={t('plant.stop')} color="#dc2626" nc setInput={setInput} />
        <button onClick={() => action('addBox', 'tall')}>{t('plant.conveyor.addTall')}</button>
        <button onClick={() => action('addBox', 'short')}>{t('plant.conveyor.addShort')}</button>
        <label className="check">
          <input type="checkbox" checked={state.autoFeed} onChange={() => action('toggleFeed')} />{' '}
          {t('plant.conveyor.autoFeed')}
        </label>
        <button onClick={() => action('clear')}>{t('plant.conveyor.clear')}</button>
      </div>
    </>
  );
}
