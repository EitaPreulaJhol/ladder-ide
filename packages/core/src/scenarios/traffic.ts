import type { ScenarioDef } from './types.ts';
import { asBool } from './types.ts';
import { coil, el, nc, program, rung } from '../build.ts';

export interface TrafficState {
  conflict: boolean;
  conflicts: number;
  multipleCarLights: boolean;
}

export const trafficScenario: ScenarioDef<TrafficState> = {
  id: 'traffic',
  tags: [
    { name: 'L_RED', type: 'BOOL', io: 'DO', comment: 'Veículos: vermelho' },
    { name: 'L_YELLOW', type: 'BOOL', io: 'DO', comment: 'Veículos: amarelo' },
    { name: 'L_GREEN', type: 'BOOL', io: 'DO', comment: 'Veículos: verde' },
    { name: 'P_RED', type: 'BOOL', io: 'DO', comment: 'Pedestres: vermelho' },
    { name: 'P_GREEN', type: 'BOOL', io: 'DO', comment: 'Pedestres: verde' },
    { name: 'B_PED', type: 'BOOL', io: 'DI', comment: 'Botoeira de pedestre' },
    { name: 'T_CYCLE', type: 'TIMER', io: 'MEM', comment: 'Tempo do ciclo' },
  ],
  init: () => ({ conflict: false, conflicts: 0, multipleCarLights: false }),
  step(s, _dt, io) {
    const g = asBool(io.get('L_GREEN'));
    const y = asBool(io.get('L_YELLOW'));
    const r = asBool(io.get('L_RED'));
    const pg = asBool(io.get('P_GREEN'));
    const conflict = (g || y) && pg;
    if (conflict && !s.conflict) s.conflicts++;
    s.conflict = conflict;
    s.multipleCarLights = Number(g) + Number(y) + Number(r) > 1;
  },
  action(s, name) {
    if (name === 'resetFault') s.conflicts = 0;
  },
  solution: () =>
    program('Semáforo', [
      rung([nc('T_CYCLE.DN'), el('TON', 'T_CYCLE', 'T#20s')], 'Ciclo de 20 s que se reinicia sozinho'),
      rung([el('LT', 'T_CYCLE.ACC', '8000'), coil('L_GREEN')], 'Verde: 0 a 8 s'),
      rung(
        [el('GE', 'T_CYCLE.ACC', '8000'), el('LT', 'T_CYCLE.ACC', '11000'), coil('L_YELLOW')],
        'Amarelo: 8 a 11 s',
      ),
      rung([el('GE', 'T_CYCLE.ACC', '11000'), coil('L_RED')], 'Vermelho: 11 a 20 s'),
      rung(
        [el('GE', 'T_CYCLE.ACC', '12000'), el('LT', 'T_CYCLE.ACC', '19000'), coil('P_GREEN')],
        'Pedestre verde com 1 s de segurança',
      ),
      rung([nc('P_GREEN'), coil('P_RED')], 'Pedestre vermelho'),
    ]),
};
