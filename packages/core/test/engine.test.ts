import { describe, expect, it } from 'vitest';
import {
  coil,
  el,
  nc,
  no,
  par,
  reset,
  rung,
  set,
  Simulator,
  tag,
  type TimerValue,
  type CounterValue,
} from '../src/index.ts';
import { makeProject, runFor, val } from './helpers.ts';

const bools = (...names: string[]) => names.map((n) => tag(n, 'BOOL'));

describe('contacts and coils', () => {
  it('start/stop seal-in circuit with NC stop button', () => {
    const p = makeProject(
      [...bools('START', 'MOTOR'), tag('STOP', 'BOOL', { initial: true })],
      [rung([par([no('START')], [no('MOTOR')]), no('STOP'), coil('MOTOR')])],
    );
    const sim = new Simulator(p);
    sim.scan(10);
    expect(val(sim, 'MOTOR')).toBe(false);
    sim.setInput('START', true);
    sim.scan(10);
    expect(val(sim, 'MOTOR')).toBe(true);
    sim.setInput('START', false);
    runFor(sim, 100);
    expect(val(sim, 'MOTOR')).toBe(true); // sealed
    sim.setInput('STOP', false);
    sim.scan(10);
    expect(val(sim, 'MOTOR')).toBe(false);
    sim.setInput('STOP', true);
    sim.scan(10);
    expect(val(sim, 'MOTOR')).toBe(false);
  });

  it('records power flow trace for each node', () => {
    const a = no('A');
    const b = nc('B');
    const out = coil('Y');
    const p = makeProject(bools('A', 'B', 'Y'), [rung([a, b, out])]);
    const sim = new Simulator(p);
    sim.scan(10);
    const tr = sim.snapshot().trace;
    expect(tr[a.id]).toEqual([true, false]);
    expect(tr[b.id]).toEqual([false, false]);
    sim.setInput('A', true);
    sim.scan(10);
    expect(sim.snapshot().trace[out.id]).toEqual([true, true]);
  });

  it('evaluates outputs on every parallel branch', () => {
    const p = makeProject(bools('A', 'X', 'Y'), [rung([no('A'), par([coil('X')], [coil('Y')])])]);
    const sim = new Simulator(p);
    sim.setInput('A', true);
    sim.scan(10);
    expect(val(sim, 'X')).toBe(true);
    expect(val(sim, 'Y')).toBe(true);
  });

  it('nested parallel branches', () => {
    // (A && (B || (C && D))) -> Y
    const p = makeProject(bools('A', 'B', 'C', 'D', 'Y'), [
      rung([no('A'), par([no('B')], [no('C'), no('D')]), coil('Y')]),
    ]);
    const sim = new Simulator(p);
    const cases: [boolean, boolean, boolean, boolean, boolean][] = [
      [true, false, true, true, true],
      [true, false, true, false, false],
      [true, true, false, false, true],
      [false, true, true, true, false],
    ];
    for (const [a, b, c, d, y] of cases) {
      sim.setInput('A', a);
      sim.setInput('B', b);
      sim.setInput('C', c);
      sim.setInput('D', d);
      sim.scan(10);
      expect(val(sim, 'Y')).toBe(y);
    }
  });

  it('set/reset: the last executed rung wins', () => {
    const p = makeProject(bools('S', 'R', 'Q'), [rung([no('S'), set('Q')]), rung([no('R'), reset('Q')])]);
    const sim = new Simulator(p);
    sim.setInput('S', true);
    sim.scan(10);
    expect(val(sim, 'Q')).toBe(true);
    sim.setInput('S', false);
    sim.scan(10);
    expect(val(sim, 'Q')).toBe(true); // latched
    sim.setInput('S', true);
    sim.setInput('R', true);
    sim.scan(10);
    expect(val(sim, 'Q')).toBe(false); // reset priority (written last)
  });

  it('negated coil', () => {
    const p = makeProject(bools('A', 'Y'), [rung([no('A'), el('NCOIL', 'Y')])]);
    const sim = new Simulator(p);
    sim.scan(10);
    expect(val(sim, 'Y')).toBe(true);
    sim.setInput('A', true);
    sim.scan(10);
    expect(val(sim, 'Y')).toBe(false);
  });

  it('rising and falling edge contacts last exactly one scan', () => {
    const p = makeProject(bools('A', 'UP', 'DOWN'), [
      rung([el('POS', 'A'), coil('UP')]),
      rung([el('NEG', 'A'), coil('DOWN')]),
    ]);
    const sim = new Simulator(p);
    sim.scan(10);
    expect(val(sim, 'UP')).toBe(false);
    sim.setInput('A', true);
    sim.scan(10);
    expect(val(sim, 'UP')).toBe(true);
    sim.scan(10);
    expect(val(sim, 'UP')).toBe(false);
    sim.setInput('A', false);
    sim.scan(10);
    expect(val(sim, 'DOWN')).toBe(true);
    sim.scan(10);
    expect(val(sim, 'DOWN')).toBe(false);
  });

  it('forces override inputs and program writes', () => {
    const p = makeProject(bools('A', 'Y'), [rung([no('A'), coil('Y')])]);
    const sim = new Simulator(p);
    sim.setForce('Y', true);
    sim.scan(10);
    expect(val(sim, 'Y')).toBe(true);
    sim.setForce('A', true);
    sim.setInput('A', false);
    sim.setForce('Y', undefined);
    sim.scan(10);
    expect(val(sim, 'Y')).toBe(true);
    sim.setForce('A', undefined);
    sim.scan(10);
    expect(val(sim, 'Y')).toBe(false);
  });
});

describe('timers', () => {
  const timerProject = (instr: 'TON' | 'TOF' | 'TP' | 'RTO') =>
    makeProject(
      [...bools('IN', 'Q', 'R'), tag('T1', 'TIMER')],
      [
        rung([no('IN'), el(instr, 'T1', 'T#1s')]),
        rung([no('T1.DN'), coil('Q')]),
        rung([no('R'), el('RES', 'T1')]),
      ],
    );

  it('TON: on-delay', () => {
    const sim = new Simulator(timerProject('TON'));
    sim.setInput('IN', true);
    runFor(sim, 990);
    expect(val(sim, 'Q')).toBe(false);
    expect((val(sim, 'T1') as TimerValue).tt).toBe(true);
    runFor(sim, 10);
    expect(val(sim, 'Q')).toBe(true);
    expect((val(sim, 'T1') as TimerValue).acc).toBe(1000);
    sim.setInput('IN', false);
    sim.scan(10);
    expect(val(sim, 'Q')).toBe(false);
    expect((val(sim, 'T1') as TimerValue).acc).toBe(0);
  });

  it('TON: input dropping before preset restarts the timing', () => {
    const sim = new Simulator(timerProject('TON'));
    sim.setInput('IN', true);
    runFor(sim, 600);
    sim.setInput('IN', false);
    sim.scan(10);
    sim.setInput('IN', true);
    runFor(sim, 600);
    expect(val(sim, 'Q')).toBe(false);
  });

  it('TOF: off-delay', () => {
    const sim = new Simulator(timerProject('TOF'));
    sim.setInput('IN', true);
    sim.scan(10);
    expect(val(sim, 'Q')).toBe(true);
    sim.setInput('IN', false);
    runFor(sim, 990);
    expect(val(sim, 'Q')).toBe(true);
    runFor(sim, 10);
    expect(val(sim, 'Q')).toBe(false);
  });

  it('TP: fixed pulse, independent of input length', () => {
    const sim = new Simulator(timerProject('TP'));
    sim.setInput('IN', true);
    sim.scan(10);
    sim.setInput('IN', false);
    runFor(sim, 900);
    expect(val(sim, 'Q')).toBe(true);
    runFor(sim, 100);
    expect(val(sim, 'Q')).toBe(false);
    // held input does not retrigger
    sim.setInput('IN', true);
    runFor(sim, 3000);
    expect(val(sim, 'Q')).toBe(false);
  });

  it('RTO: retentive, needs RES', () => {
    const sim = new Simulator(timerProject('RTO'));
    sim.setInput('IN', true);
    runFor(sim, 600);
    sim.setInput('IN', false);
    runFor(sim, 500);
    expect((val(sim, 'T1') as TimerValue).acc).toBe(600);
    sim.setInput('IN', true);
    runFor(sim, 400);
    expect(val(sim, 'Q')).toBe(true);
    sim.setInput('IN', false);
    sim.setInput('R', true);
    sim.scan(10);
    // RES runs in a rung after the Q coil: Q only drops on the next scan (scan order matters).
    expect(val(sim, 'Q')).toBe(true);
    expect((val(sim, 'T1') as TimerValue).acc).toBe(0);
    sim.scan(10);
    expect(val(sim, 'Q')).toBe(false);
  });

  it('preset from a tag in ms', () => {
    const p = makeProject(
      [...bools('IN', 'Q'), tag('T1', 'TIMER'), tag('PT', 'INT', { initial: 200 })],
      [rung([no('IN'), el('TON', 'T1', 'PT'), coil('Q')])],
    );
    const sim = new Simulator(p);
    sim.setInput('IN', true);
    runFor(sim, 200);
    expect(val(sim, 'Q')).toBe(true);
  });
});

describe('counters', () => {
  const counterProject = () =>
    makeProject(
      [...bools('UP', 'DOWN', 'R', 'Q'), tag('C1', 'COUNTER')],
      [
        rung([no('UP'), el('CTU', 'C1', '3')]),
        rung([no('DOWN'), el('CTD', 'C1', '3')]),
        rung([no('C1.DN'), coil('Q')]),
        rung([no('R'), el('RES', 'C1')]),
      ],
    );
  const pulse = (sim: Simulator, name: string) => {
    sim.setInput(name, true);
    sim.scan(10);
    sim.setInput(name, false);
    sim.scan(10);
  };

  it('CTU counts rising edges, CTD decrements, RES clears', () => {
    const sim = new Simulator(counterProject());
    pulse(sim, 'UP');
    pulse(sim, 'UP');
    expect(val(sim, 'Q')).toBe(false);
    sim.setInput('UP', true);
    runFor(sim, 100); // held: counts once
    expect((val(sim, 'C1') as CounterValue).acc).toBe(3);
    expect(val(sim, 'Q')).toBe(true);
    sim.setInput('UP', false);
    pulse(sim, 'DOWN');
    expect((val(sim, 'C1') as CounterValue).acc).toBe(2);
    sim.scan(10);
    expect(val(sim, 'Q')).toBe(false);
    pulse(sim, 'R');
    expect((val(sim, 'C1') as CounterValue).acc).toBe(0);
  });

  it('CTUD with count-down operand', () => {
    const p = makeProject(
      [...bools('UP', 'DOWN', 'Q'), tag('C1', 'COUNTER')],
      [rung([no('UP'), el('CTUD', 'C1', '2', 'DOWN'), coil('Q')])],
    );
    const sim = new Simulator(p);
    pulse(sim, 'UP');
    pulse(sim, 'UP');
    expect(val(sim, 'Q')).toBe(true);
    pulse(sim, 'DOWN');
    expect(val(sim, 'Q')).toBe(false);
    expect((val(sim, 'C1') as CounterValue).acc).toBe(1);
  });
});

describe('compare and math', () => {
  it('compares and computes with INT truncation and overflow wrap', () => {
    const p = makeProject(
      [
        tag('A', 'INT', { initial: 7 }),
        tag('B', 'INT'),
        tag('R', 'REAL'),
        tag('GT5', 'BOOL'),
        tag('BIG', 'INT'),
      ],
      [
        rung([el('GT', 'A', '5'), coil('GT5')]),
        rung([el('DIV', 'A', '2', 'B')]),
        rung([el('DIV', 'A', '2', 'R')]),
        rung([el('ADD', '32767', '1', 'BIG')]),
      ],
    );
    const sim = new Simulator(p);
    sim.scan(10);
    expect(val(sim, 'GT5')).toBe(true);
    expect(val(sim, 'B')).toBe(3);
    expect(val(sim, 'R')).toBe(3.5);
    expect(val(sim, 'BIG')).toBe(-32768);
  });

  it('MOVE timer accumulator and division by zero fault', () => {
    const p = makeProject(
      [tag('IN', 'BOOL'), tag('T1', 'TIMER'), tag('X', 'DINT'), tag('Y', 'INT'), tag('OK', 'BOOL')],
      [
        rung([no('IN'), el('TON', 'T1', 'T#10s')]),
        rung([el('MOVE', 'T1.ACC', 'X')]),
        rung([el('DIV', '1', '0', 'Y'), coil('OK')]),
      ],
    );
    const sim = new Simulator(p);
    sim.setInput('IN', true);
    runFor(sim, 250);
    expect(val(sim, 'X')).toBe(250);
    expect(val(sim, 'OK')).toBe(false);
    expect(sim.snapshot().faults.length).toBe(1);
  });
});

describe('hot reload', () => {
  it('keeps memory of unchanged tags when the program is edited', () => {
    const p = makeProject(
      [tag('A', 'BOOL'), tag('Y', 'BOOL'), tag('N', 'INT', { initial: 5 })],
      [rung([no('A'), set('Y')])],
    );
    const sim = new Simulator(p);
    sim.setInput('A', true);
    sim.scan(10);
    const p2 = structuredClone(p);
    p2.programs[0]!.rungs.push(rung([el('ADD', 'N', '1', 'N')]));
    sim.load(p2);
    sim.scan(10);
    expect(val(sim, 'Y')).toBe(true);
    expect(val(sim, 'N')).toBe(6);
    sim.reset();
    expect(val(sim, 'N')).toBe(5);
  });
});
