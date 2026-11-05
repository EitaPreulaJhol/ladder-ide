import type { ScenarioDef } from './types.ts';
import { asBool } from './types.ts';
import { coil, el, nc, no, program, reset, rung, set } from '../build.ts';

export interface TankState {
  /** 0..1 */
  level: number;
  /** Consumption demand 0..1, set by the operator. */
  demand: number;
  overflows: number;
  overflowing: boolean;
  dryRun: boolean;
}

export const ANALOG_FULL_SCALE = 27648;
export const TANK = { lsl: 0.15, lsh: 0.85, inflow: 0.06, outflow: 0.05 };

export const tankScenario: ScenarioDef<TankState> = {
  id: 'tank',
  tags: [
    { name: 'LSL', type: 'BOOL', io: 'DI', comment: 'Chave de nível baixo (1 = coberta)' },
    { name: 'LSH', type: 'BOOL', io: 'DI', comment: 'Chave de nível alto (1 = coberta)' },
    { name: 'LT_LEVEL', type: 'INT', io: 'AI', comment: 'Transmissor de nível 0–27648 (0–100%)' },
    { name: 'P_FILL', type: 'BOOL', io: 'DO', comment: 'Bomba de enchimento' },
    { name: 'H_ALARM', type: 'BOOL', io: 'DO', comment: 'Alarme de nível muito alto' },
    {
      name: 'LEVEL_PCT',
      type: 'DINT',
      io: 'MEM',
      comment: 'Nível em % (DINT: LT_LEVEL × 100 não cabe em INT)',
    },
  ],
  init: () => ({ level: 0.3, demand: 0.4, overflows: 0, overflowing: false, dryRun: false }),
  step(s, dt, io) {
    const pump = asBool(io.get('P_FILL'));
    const sec = dt / 1000;
    s.level += (pump ? TANK.inflow : 0) * sec;
    s.level -= TANK.outflow * s.demand * sec * Math.min(1, s.level * 4);
    const over = s.level >= 1;
    if (over && !s.overflowing) s.overflows++;
    s.overflowing = over;
    s.level = Math.max(0, Math.min(1, s.level));
    s.dryRun = s.level < 0.02 && s.demand > 0;
    io.set('LSL', s.level >= TANK.lsl);
    io.set('LSH', s.level >= TANK.lsh);
    io.set('LT_LEVEL', Math.round(s.level * ANALOG_FULL_SCALE));
  },
  action(s, name, value) {
    if (name === 'demand') s.demand = Math.max(0, Math.min(1, Number(value)));
    if (name === 'resetFault') s.overflows = 0;
  },
  solution: () =>
    program('Controle de nível', [
      rung([nc('LSL'), set('P_FILL')], 'Nível baixo: liga a bomba'),
      rung([no('LSH'), reset('P_FILL')], 'Nível alto: desliga a bomba'),
      rung(
        [el('MUL', 'LT_LEVEL', '100', 'LEVEL_PCT'), el('DIV', 'LEVEL_PCT', '27648', 'LEVEL_PCT')],
        'Escala do nível para %',
      ),
      rung([el('GE', 'LEVEL_PCT', '95'), coil('H_ALARM')], 'Alarme acima de 95%'),
    ]),
};
