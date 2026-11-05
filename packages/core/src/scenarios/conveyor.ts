import type { ScenarioDef } from './types.ts';
import { asBool } from './types.ts';
import { coil, el, no, par, program, reset, rung, set } from '../build.ts';

export interface Box {
  id: number;
  x: number;
  tall: boolean;
  /** 0 on the belt, > 0 while being pushed off (lateral offset). */
  off: number;
}

export interface ConveyorState {
  boxes: Box[];
  nextId: number;
  pusher: number;
  autoFeed: boolean;
  feedTimer: number;
  sortedOk: number;
  sortedWrong: number;
  seed: number;
}

export const BELT = { speed: 0.09, box: 0.07, entry: 0.04, high: 0.35, push: 0.62, end: 0.93 };

const covers = (b: Box, x: number) => b.off === 0 && x >= b.x - BELT.box / 2 && x <= b.x + BELT.box / 2;

function rand(s: ConveyorState): number {
  s.seed = (s.seed * 1103515245 + 12345) & 0x7fffffff;
  return s.seed / 0x7fffffff;
}

function addBox(s: ConveyorState, tall?: boolean) {
  if (s.boxes.some((b) => b.off === 0 && b.x < BELT.box * 1.5)) return;
  s.boxes.push({ id: s.nextId++, x: 0, tall: tall ?? rand(s) < 0.5, off: 0 });
}

export const conveyorScenario: ScenarioDef<ConveyorState> = {
  id: 'conveyor',
  tags: [
    { name: 'B_START', type: 'BOOL', io: 'DI', comment: 'Botão liga esteira (NA)' },
    { name: 'B_STOP', type: 'BOOL', io: 'DI', comment: 'Botão desliga esteira (NF)', initial: true },
    { name: 'S_ENTRY', type: 'BOOL', io: 'DI', comment: 'Sensor de presença na entrada' },
    { name: 'S_HIGH', type: 'BOOL', io: 'DI', comment: 'Sensor de altura (caixa alta)' },
    { name: 'S_PUSH', type: 'BOOL', io: 'DI', comment: 'Sensor de caixa em frente ao expulsor' },
    { name: 'S_END', type: 'BOOL', io: 'DI', comment: 'Sensor de fim da esteira' },
    { name: 'M_BELT', type: 'BOOL', io: 'DO', comment: 'Motor da esteira' },
    { name: 'Y_PUSH', type: 'BOOL', io: 'DO', comment: 'Válvula do cilindro expulsor' },
    { name: 'M_TALL', type: 'BOOL', io: 'MEM', comment: 'Memória: caixa alta a caminho' },
    { name: 'T_PUSH', type: 'TIMER', io: 'MEM', comment: 'Tempo de avanço do expulsor' },
    { name: 'C_TALL', type: 'COUNTER', io: 'MEM', comment: 'Contagem de caixas altas' },
  ],
  init: () => ({
    boxes: [],
    nextId: 1,
    pusher: 0,
    autoFeed: true,
    feedTimer: 0,
    sortedOk: 0,
    sortedWrong: 0,
    seed: 12345,
  }),
  step(s, dt, io) {
    const run = asBool(io.get('M_BELT'));
    const push = asBool(io.get('Y_PUSH'));
    s.pusher = Math.max(0, Math.min(1, s.pusher + ((push ? 1 : -1) * dt) / 300));
    if (s.autoFeed && run) {
      s.feedTimer += dt;
      if (s.feedTimer >= 4500) {
        s.feedTimer = 0;
        addBox(s);
      }
    }
    for (const b of s.boxes) {
      if (b.off > 0) {
        b.off += dt / 400;
        continue;
      }
      if (run) b.x += (BELT.speed * dt) / 1000;
      if (s.pusher > 0.5 && covers(b, BELT.push)) {
        b.off = 0.01;
        if (b.tall) s.sortedOk++;
        else s.sortedWrong++;
      }
    }
    s.boxes = s.boxes.filter((b) => {
      if (b.off >= 1) return false;
      if (b.x > 1 + BELT.box) {
        if (b.tall) s.sortedWrong++;
        else s.sortedOk++;
        return false;
      }
      return true;
    });
    io.set(
      'S_ENTRY',
      s.boxes.some((b) => covers(b, BELT.entry)),
    );
    io.set(
      'S_HIGH',
      s.boxes.some((b) => b.tall && covers(b, BELT.high)),
    );
    io.set(
      'S_PUSH',
      s.boxes.some((b) => covers(b, BELT.push)),
    );
    io.set(
      'S_END',
      s.boxes.some((b) => covers(b, BELT.end)),
    );
  },
  action(s, name, value) {
    if (name === 'addBox') addBox(s, value === 'tall' ? true : value === 'short' ? false : undefined);
    if (name === 'toggleFeed') s.autoFeed = !s.autoFeed;
    if (name === 'clear') {
      s.boxes = [];
      s.sortedOk = 0;
      s.sortedWrong = 0;
    }
  },
  solution: () =>
    program('Esteira seletora', [
      rung(
        [par([no('B_START')], [no('M_BELT')]), no('B_STOP'), coil('M_BELT')],
        'Liga/desliga da esteira com selo',
      ),
      rung(
        [el('POS', 'S_HIGH'), set('M_TALL'), el('CTU', 'C_TALL', '9999')],
        'Caixa alta detectada: memoriza e conta',
      ),
      rung(
        [el('POS', 'S_PUSH'), no('M_TALL'), set('Y_PUSH')],
        'Caixa alta em frente ao expulsor: avança o cilindro',
      ),
      rung([no('Y_PUSH'), el('TON', 'T_PUSH', 'T#600ms')], 'Tempo de avanço'),
      rung(
        [no('T_PUSH.DN'), par([reset('Y_PUSH')], [reset('M_TALL')])],
        'Recua o cilindro e limpa a memória',
      ),
    ]),
};
