import type { ScenarioDef } from './types.ts';
import { asBool } from './types.ts';
import { coil, nc, no, par, program, reset, rung, set } from '../build.ts';

export interface Cylinder {
  /** 0 = retracted, 1 = extended. */
  pos: number;
}

export interface CylindersState {
  a: Cylinder;
  b: Cylinder;
  /** Completed A+ B+ A- B- cycles. */
  cycles: number;
  /** Order of end-switch arrivals in the current cycle, e.g. ['A1', 'B1', 'A0', 'B0']. */
  events: string[];
  /** Last completed cycle was in the right order. */
  lastCycleOk: boolean | null;
  wrongCycles: number;
}

/** Stroke time in ms (5/2 single-solenoid valves, spring return). */
export const CYL = { strokeA: 1200, strokeB: 1000 };
const EXPECTED = ['A1', 'B1', 'A0', 'B0'];

function move(c: Cylinder, extend: boolean, dt: number, stroke: number) {
  c.pos = Math.max(0, Math.min(1, c.pos + ((extend ? 1 : -1) * dt) / stroke));
}

/** Two pneumatic cylinders doing the classic A+ B+ A- B- sequence. */
export const cylindersScenario: ScenarioDef<CylindersState> = {
  id: 'cylinders',
  tags: [
    { name: 'B_START', type: 'BOOL', io: 'DI', comment: 'Botão de partida do ciclo (NA)' },
    { name: 'A0', type: 'BOOL', io: 'DI', comment: 'Fim de curso: cilindro A recuado' },
    { name: 'A1', type: 'BOOL', io: 'DI', comment: 'Fim de curso: cilindro A avançado' },
    { name: 'B0', type: 'BOOL', io: 'DI', comment: 'Fim de curso: cilindro B recuado' },
    { name: 'B1', type: 'BOOL', io: 'DI', comment: 'Fim de curso: cilindro B avançado' },
    { name: 'Y_A', type: 'BOOL', io: 'DO', comment: 'Solenoide da válvula 5/2 do cilindro A (avança)' },
    { name: 'Y_B', type: 'BOOL', io: 'DO', comment: 'Solenoide da válvula 5/2 do cilindro B (avança)' },
    { name: 'M_S1', type: 'BOOL', io: 'MEM', comment: 'Etapa 1: A avança' },
    { name: 'M_S2', type: 'BOOL', io: 'MEM', comment: 'Etapa 2: B avança' },
    { name: 'M_S3', type: 'BOOL', io: 'MEM', comment: 'Etapa 3: A recua' },
    { name: 'M_S4', type: 'BOOL', io: 'MEM', comment: 'Etapa 4: B recua' },
  ],
  init: () => ({ a: { pos: 0 }, b: { pos: 0 }, cycles: 0, events: [], lastCycleOk: null, wrongCycles: 0 }),
  step(s, dt, io) {
    const before = { A0: s.a.pos <= 0.01, A1: s.a.pos >= 0.99, B0: s.b.pos <= 0.01, B1: s.b.pos >= 0.99 };
    move(s.a, asBool(io.get('Y_A')), dt, CYL.strokeA);
    move(s.b, asBool(io.get('Y_B')), dt, CYL.strokeB);
    const now = { A0: s.a.pos <= 0.01, A1: s.a.pos >= 0.99, B0: s.b.pos <= 0.01, B1: s.b.pos >= 0.99 };
    for (const k of ['A1', 'B1', 'A0', 'B0'] as const) if (now[k] && !before[k]) s.events.push(k);
    if (now.A0 && now.B0 && s.events.length >= 4) {
      const ok = s.events.slice(-4).join() === EXPECTED.join() && s.events.length === 4;
      s.cycles++;
      s.lastCycleOk = ok;
      if (!ok) s.wrongCycles++;
      s.events = [];
    }
    for (const [k, v] of Object.entries(now)) io.set(k, v);
  },
  action(s, name) {
    if (name === 'resetFault') {
      s.cycles = 0;
      s.wrongCycles = 0;
      s.lastCycleOk = null;
      s.events = [];
    }
  },
  solution: () =>
    program('Sequência A+ B+ A- B-', [
      rung(
        [no('B_START'), no('A0'), no('B0'), nc('M_S1'), nc('M_S2'), nc('M_S3'), nc('M_S4'), set('M_S1')],
        'Partida: só com os dois cilindros recuados e nenhuma etapa ativa',
      ),
      rung([no('M_S1'), no('A1'), par([set('M_S2')], [reset('M_S1')])], 'A avançou: etapa 2'),
      rung([no('M_S2'), no('B1'), par([set('M_S3')], [reset('M_S2')])], 'B avançou: etapa 3'),
      rung([no('M_S3'), no('A0'), par([set('M_S4')], [reset('M_S3')])], 'A recuou: etapa 4'),
      rung([no('M_S4'), no('B0'), reset('M_S4')], 'B recuou: fim do ciclo'),
      rung([par([no('M_S1')], [no('M_S2')]), coil('Y_A')], 'A avançado nas etapas 1 e 2'),
      rung([par([no('M_S2')], [no('M_S3')]), coil('Y_B')], 'B avançado nas etapas 2 e 3'),
    ]),
};
