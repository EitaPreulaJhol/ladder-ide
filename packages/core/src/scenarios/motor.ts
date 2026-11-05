import type { ScenarioDef } from './types.ts';
import { asBool } from './types.ts';
import { coil, nc, no, par, program, rung } from '../build.ts';

export interface MotorState {
  speed: number;
  temperature: number;
  heavyLoad: boolean;
  tripped: boolean;
  starts: number;
  wasRunning: boolean;
}

/** Direct-on-line motor start with seal-in, NC stop button and thermal overload relay. */
export const motorScenario: ScenarioDef<MotorState> = {
  id: 'motor',
  tags: [
    { name: 'B_START', type: 'BOOL', io: 'DI', comment: 'Botão liga (NA)' },
    { name: 'B_STOP', type: 'BOOL', io: 'DI', comment: 'Botão desliga (NF: 1 em repouso)', initial: true },
    { name: 'F_OVL', type: 'BOOL', io: 'DI', comment: 'Relé térmico (NF: 1 = normal)', initial: true },
    { name: 'K_MOTOR', type: 'BOOL', io: 'DO', comment: 'Contator do motor' },
    { name: 'H_RUN', type: 'BOOL', io: 'DO', comment: 'Sinaleiro verde: motor ligado' },
    { name: 'H_FAULT', type: 'BOOL', io: 'DO', comment: 'Sinaleiro vermelho: falha térmica' },
  ],
  init: () => ({ speed: 0, temperature: 0, heavyLoad: false, tripped: false, starts: 0, wasRunning: false }),
  step(s, dt, io) {
    const on = asBool(io.get('K_MOTOR'));
    const k = Math.min(1, dt / 800);
    s.speed += ((on ? 1 : 0) - s.speed) * k;
    if (on && !s.wasRunning) s.starts++;
    s.wasRunning = on;
    const heat = on ? (s.heavyLoad ? 0.25 : 0.02) : -0.05;
    s.temperature = Math.max(0, Math.min(1.2, s.temperature + (heat * dt) / 1000));
    if (s.temperature >= 1) s.tripped = true;
    io.set('F_OVL', !s.tripped);
  },
  action(s, name) {
    if (name === 'toggleLoad') s.heavyLoad = !s.heavyLoad;
    if (name === 'resetRelay' && s.temperature < 0.6) s.tripped = false;
  },
  solution: () =>
    program('Partida direta', [
      rung(
        [par([no('B_START')], [no('K_MOTOR')]), no('B_STOP'), no('F_OVL'), coil('K_MOTOR')],
        'Selo: liga com B_START, desliga com B_STOP ou relé térmico',
      ),
      rung([no('K_MOTOR'), coil('H_RUN')], 'Sinaleiro de motor ligado'),
      rung([nc('F_OVL'), coil('H_FAULT')], 'Sinaleiro de falha térmica'),
    ]),
};
