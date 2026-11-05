import { describe, expect, it } from 'vitest';
import {
  coil,
  crossReference,
  el,
  explainTag,
  nc,
  no,
  par,
  reset,
  rung,
  set,
  Simulator,
  tag,
} from '../src/index.ts';
import { makeProject, runFor } from './helpers.ts';

const bools = (...n: string[]) => n.map((x) => tag(x, 'BOOL'));

describe('cross reference', () => {
  it('classifies reads and writes, including members and timers', () => {
    const p = makeProject(
      [...bools('START', 'STOP', 'MOTOR', 'LAMP'), tag('T1', 'TIMER'), tag('N', 'INT')],
      [
        rung([par([no('START')], [no('MOTOR')]), nc('STOP'), coil('MOTOR')]),
        rung([no('MOTOR'), el('TON', 'T1', 'T#1s')]),
        rung([no('T1.DN'), coil('LAMP'), el('MOVE', 'T1.ACC', 'N')]),
        rung([no('STOP'), el('RES', 'T1')]),
      ],
    );
    const x = crossReference(p);
    const motor = x.get('MOTOR')!;
    expect(motor.map((r) => [r.rungIndex, r.instr, r.access])).toEqual([
      [0, 'NO', 'read'],
      [0, 'COIL', 'write'],
      [1, 'NO', 'read'],
    ]);
    expect(x.get('T1')!.map((r) => `${r.rungIndex}:${r.instr}:${r.access}`)).toEqual([
      '1:TON:readWrite',
      '2:NO:read',
      '2:MOVE:read',
      '3:RES:write',
    ]);
    expect(x.get('N')![0]!.access).toBe('write');
    expect(x.get('UNUSED')).toBeUndefined();
  });
});

describe('explain', () => {
  const sealIn = () =>
    makeProject(
      [...bools('START', 'MOTOR', 'OVL'), tag('STOP', 'BOOL', { initial: true })],
      [rung([par([no('START')], [no('MOTOR')]), no('STOP'), no('OVL'), coil('MOTOR')])],
    );

  it('shows the blocking contact when the coil is off', () => {
    const p = sealIn();
    const sim = new Simulator(p);
    sim.scan(10);
    const e = explainTag(p, sim.snapshot(), 'MOTOR');
    expect(e.source).toBe('program');
    expect(e.value).toBe(false);
    const path = e.paths[0]!;
    expect(path.powered).toBe(false);
    const blocker = path.steps.find((s) => s.elementId === path.blockedBy)!;
    expect(blocker.instr).toBe('PAR'); // neither START nor the seal conduct
    expect(path.steps.filter((s) => s.depth === 1).map((s) => [s.operand, s.ok])).toEqual([
      ['START', false],
      ['MOTOR', false],
    ]);
  });

  it('shows the conducting path when the coil is on (through the seal-in branch)', () => {
    const p = sealIn();
    const sim = new Simulator(p);
    sim.setInput('OVL', true);
    sim.setInput('START', true);
    sim.scan(10);
    sim.setInput('START', false);
    sim.scan(10);
    const e = explainTag(p, sim.snapshot(), 'MOTOR');
    expect(e.value).toBe(true);
    const path = e.paths[0]!;
    expect(path.powered).toBe(true);
    expect(path.blockedBy).toBeUndefined();
    expect(path.steps.map((s) => [s.instr, s.operand, s.ok])).toEqual([
      ['PAR', '', true],
      ['NO', 'START', false],
      ['NO', 'MOTOR', true],
      ['NO', 'STOP', true],
      ['NO', 'OVL', true],
    ]);
  });

  it('detects double coils and reports the last writer of the scan', () => {
    const p = makeProject(bools('A', 'B', 'Y'), [rung([no('A'), coil('Y')]), rung([no('B'), coil('Y')])]);
    const sim = new Simulator(p);
    sim.setInput('A', true);
    sim.scan(10);
    const e = explainTag(p, sim.snapshot(), 'Y');
    expect(e.duplicateCoils).toBe(true);
    expect(e.value).toBe(false); // rung 2 wins
    expect(e.lastWriter!.rungIndex).toBe(1);
    expect(e.paths[0]!.ref.rungIndex).toBe(1);
  });

  it('distinguishes held (SET/RESET), input, forced and timer values', () => {
    const p = makeProject(
      [...bools('S', 'R', 'Q', 'IN'), tag('T1', 'TIMER')],
      [rung([no('S'), set('Q')]), rung([no('R'), reset('Q')]), rung([no('IN'), el('TON', 'T1', 'T#100ms')])],
    );
    const sim = new Simulator(p);
    sim.setInput('S', true);
    sim.scan(10);
    sim.setInput('S', false);
    sim.scan(10);
    expect(explainTag(p, sim.snapshot(), 'Q').source).toBe('held');
    expect(explainTag(p, sim.snapshot(), 'S').source).toBe('input');
    sim.setForce('Q', false);
    expect(explainTag(p, sim.snapshot(), 'Q').source).toBe('forced');
    sim.setInput('IN', true);
    runFor(sim, 200);
    const t = explainTag(p, sim.snapshot(), 'T1');
    expect(t.source).toBe('program');
    expect(t.lastWriter!.instr).toBe('TON');
  });
});
