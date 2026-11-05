import type { ScenarioDef } from './types.ts';
import { el, no, program, rung } from '../build.ts';
import { ANALOG_FULL_SCALE } from './tank.ts';

export interface TankPidState {
  /** 0..1 */
  level: number;
  /** Valve opening 0..1 (follows the analog output with a small lag). */
  valve: number;
  /** Consumption demand 0..1, set by the operator. */
  demand: number;
  overflows: number;
  overflowing: boolean;
}

/** Max inflow (fraction of the tank per second) with the valve fully open; outflow at full demand. */
export const TANK_PID = { inflow: 0.08, outflow: 0.05, valveLagMs: 1000 };

/** Level control with a proportional inlet valve: analog scaling + PID. */
export const tankPidScenario: ScenarioDef<TankPidState> = {
  id: 'tankPid',
  tags: [
    { name: 'LT_LEVEL', type: 'INT', io: 'AI', comment: 'Transmissor de nível 0–27648 (0–100%)' },
    { name: 'CV_VALVE', type: 'INT', io: 'AO', comment: 'Válvula proporcional 0–27648 (0–100%)' },
    { name: 'PID_ON', type: 'BOOL', io: 'DI', comment: 'Chave automático (1) / manual (0)', initial: true },
    { name: 'SP_PCT', type: 'REAL', io: 'MEM', comment: 'Setpoint de nível em % (operador)', initial: 50 },
    { name: 'LEVEL_PCT', type: 'REAL', io: 'MEM', comment: 'Nível em %' },
    { name: 'CV_PCT', type: 'REAL', io: 'MEM', comment: 'Saída do PID em %' },
  ],
  init: () => ({ level: 0.2, valve: 0, demand: 0.4, overflows: 0, overflowing: false }),
  step(s, dt, io) {
    const cmd = Math.max(0, Math.min(1, Number(io.get('CV_VALVE')) / ANALOG_FULL_SCALE));
    s.valve += (cmd - s.valve) * Math.min(1, dt / TANK_PID.valveLagMs);
    const sec = dt / 1000;
    s.level += TANK_PID.inflow * s.valve * sec;
    s.level -= TANK_PID.outflow * s.demand * sec * Math.min(1, s.level * 4);
    const over = s.level >= 1;
    if (over && !s.overflowing) s.overflows++;
    s.overflowing = over;
    s.level = Math.max(0, Math.min(1, s.level));
    io.set('LT_LEVEL', Math.round(s.level * ANALOG_FULL_SCALE));
  },
  action(s, name, value, io) {
    if (name === 'demand') s.demand = Math.max(0, Math.min(1, Number(value)));
    if (name === 'setpoint') io.set('SP_PCT', Math.max(0, Math.min(100, Number(value))));
    if (name === 'resetFault') s.overflows = 0;
  },
  solution: () =>
    program('Controle PID', [
      rung([el('SCALE', 'LT_LEVEL', '0', '27648', '0', '100', 'LEVEL_PCT')], 'Nível bruto (0–27648) para %'),
      rung(
        [no('PID_ON'), el('PID', 'LEVEL_PCT', 'SP_PCT', 'CV_PCT', '6', '25', '0')],
        'PID de nível (PI): Kp = 6, Ti = 25 s',
      ),
      rung(
        [el('SCALE', 'CV_PCT', '0', '100', '0', '27648', 'CV_VALVE')],
        'Saída do PID (%) para a válvula (0–27648)',
      ),
    ]),
};
