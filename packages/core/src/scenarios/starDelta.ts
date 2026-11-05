import type { ScenarioDef } from './types.ts';
import { asBool } from './types.ts';
import { coil, el, nc, no, par, program, rung } from '../build.ts';

export interface StarDeltaState {
  speed: number;
  /** Line current in multiples of the nominal current. */
  current: number;
  mode: 'off' | 'star' | 'delta' | 'short' | 'directDelta';
  shortCircuit: boolean;
  highCurrentStarts: number;
}

export const starDeltaScenario: ScenarioDef<StarDeltaState> = {
  id: 'starDelta',
  tags: [
    { name: 'B_START', type: 'BOOL', io: 'DI', comment: 'Botão liga (NA)' },
    { name: 'B_STOP', type: 'BOOL', io: 'DI', comment: 'Botão desliga (NF)', initial: true },
    { name: 'F_OVL', type: 'BOOL', io: 'DI', comment: 'Relé térmico (NF)', initial: true },
    { name: 'K1_MAIN', type: 'BOOL', io: 'DO', comment: 'Contator principal (K1)' },
    { name: 'K2_STAR', type: 'BOOL', io: 'DO', comment: 'Contator estrela (K2)' },
    { name: 'K3_DELTA', type: 'BOOL', io: 'DO', comment: 'Contator triângulo (K3)' },
    { name: 'T_STAR', type: 'TIMER', io: 'MEM', comment: 'Tempo em estrela' },
  ],
  init: () => ({ speed: 0, current: 0, mode: 'off', shortCircuit: false, highCurrentStarts: 0 }),
  step(s, dt, io) {
    const k1 = asBool(io.get('K1_MAIN'));
    const k2 = asBool(io.get('K2_STAR'));
    const k3 = asBool(io.get('K3_DELTA'));
    if (k2 && k3) s.shortCircuit = true;
    const prev = s.mode;
    s.mode = !k1
      ? 'off'
      : k2 && k3
        ? 'short'
        : k2
          ? 'star'
          : k3
            ? s.speed < 0.5
              ? 'directDelta'
              : 'delta'
            : 'off';
    if (s.mode === 'directDelta' && prev !== 'directDelta') s.highCurrentStarts++;
    const target = s.mode === 'star' ? 0.9 : s.mode === 'delta' || s.mode === 'directDelta' ? 1 : 0;
    s.speed += (target - s.speed) * Math.min(1, dt / (s.mode === 'star' ? 1500 : 700));
    const slip = Math.max(0, target - s.speed);
    s.current =
      s.mode === 'off' ? 0 : s.mode === 'short' ? 20 : s.mode === 'star' ? 0.4 + 2 * slip : 0.9 + 6 * slip;
  },
  action(s, name) {
    if (name === 'resetFault') {
      s.shortCircuit = false;
      s.highCurrentStarts = 0;
    }
  },
  solution: () =>
    program('Estrela-triângulo', [
      rung(
        [par([no('B_START')], [no('K1_MAIN')]), no('B_STOP'), no('F_OVL'), coil('K1_MAIN')],
        'Contator principal com selo',
      ),
      rung([no('K1_MAIN'), el('TON', 'T_STAR', 'T#5s')], 'Tempo de partida em estrela'),
      rung(
        [no('K1_MAIN'), nc('T_STAR.DN'), nc('K3_DELTA'), coil('K2_STAR')],
        'Estrela, intertravada com o triângulo',
      ),
      rung(
        [no('K1_MAIN'), no('T_STAR.DN'), nc('K2_STAR'), coil('K3_DELTA')],
        'Triângulo, intertravado com a estrela',
      ),
    ]),
};
