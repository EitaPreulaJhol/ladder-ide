import { describe, expect, it } from 'vitest';
import {
  coil,
  createProject,
  crossReference,
  el,
  no,
  program,
  rung,
  set,
  Simulator,
  tag,
  validateProject,
  type Program,
  type Project,
  type Rung,
  type Tag,
} from '../src/index.ts';
import { runFor } from './helpers.ts';

function project(tags: Tag[], programs: Program[]): Project {
  const p = createProject('t');
  p.hardware.modules = [];
  p.tags = tags;
  p.programs = programs;
  return p;
}
const sub = (name: string, rungs: Rung[]): Program => ({ ...program(name, rungs), kind: 'sub' });
const bools = (...n: string[]) => n.map((x) => tag(x, 'BOOL'));
const codes = (p: Project) => validateProject(p).map((d) => d.code);

describe('bistables', () => {
  it('SR is set-dominant, RS is reset-dominant', () => {
    const p = project(bools('S', 'R', 'Q1', 'Q2'), [
      program('Main', [rung([no('S'), el('SR', 'Q1', 'R')]), rung([no('S'), el('RS', 'Q2', 'R')])]),
    ]);
    const sim = new Simulator(p);
    sim.setInput('S', true);
    sim.scan(10);
    expect([sim.getValue('Q1'), sim.getValue('Q2')]).toEqual([true, true]);
    sim.setInput('S', false);
    sim.scan(10);
    expect([sim.getValue('Q1'), sim.getValue('Q2')]).toEqual([true, true]); // latched
    sim.setInput('S', true);
    sim.setInput('R', true);
    sim.scan(10);
    expect([sim.getValue('Q1'), sim.getValue('Q2')]).toEqual([true, false]); // both inputs: SR keeps, RS resets
    sim.setInput('S', false);
    sim.scan(10);
    expect(sim.getValue('Q1')).toBe(false);
  });
});

describe('jumps', () => {
  it('JMP skips the rungs up to its label; skipped outputs keep their state', () => {
    const p = project(bools('J', 'A', 'Y', 'Z'), [
      program('Main', [
        rung([no('J'), el('JMP', 'FIM')]),
        rung([no('A'), coil('Y')]),
        rung([el('LBL', 'FIM'), no('A'), coil('Z')]),
      ]),
    ]);
    const sim = new Simulator(p);
    sim.setInput('A', true);
    sim.scan(10);
    expect([sim.getValue('Y'), sim.getValue('Z')]).toEqual([true, true]);
    sim.setInput('J', true);
    sim.setInput('A', false);
    sim.scan(10);
    expect([sim.getValue('Y'), sim.getValue('Z')]).toEqual([true, false]); // Y frozen (skipped)
    expect(codes(p)).not.toContain('unknownLabel');
  });

  it('an endless backward jump trips the watchdog instead of freezing', () => {
    const p = project(bools('Y'), [
      program('Main', [rung([el('LBL', 'L1'), coil('Y')]), rung([el('JMP', 'L1')])]),
    ]);
    const sim = new Simulator(p);
    sim.scan(10);
    expect(sim.snapshot().faults).toContain('scan:watchdog');
  });

  it('validation: unknown and duplicate labels', () => {
    const p = project(bools('A'), [
      program('Main', [
        rung([no('A'), el('JMP', 'NOPE')]),
        rung([el('LBL', 'X'), coil('A')]),
        rung([el('LBL', 'X'), coil('A')]),
      ]),
    ]);
    expect(codes(p)).toEqual(expect.arrayContaining(['unknownLabel', 'duplicateLabel']));
    expect(crossReference(p).has('NOPE')).toBe(false); // labels are not tags
  });
});

describe('subroutines', () => {
  it('a sub runs only when called, every time it is called', () => {
    const n = tag('N', 'INT');
    const p = project(
      [...bools('C', 'Y'), n],
      [
        program('Main', [rung([no('C'), el('CALL', 'Contagem')]), rung([no('C'), el('CALL', 'Contagem')])]),
        sub('Contagem', [rung([el('ADD', 'N', '1', 'N'), set('Y')])]),
      ],
    );
    const sim = new Simulator(p);
    runFor(sim, 50);
    expect(sim.getValue('N')).toBe(0); // never called
    sim.setInput('C', true);
    sim.scan(10);
    expect(sim.getValue('N')).toBe(2); // called twice in one scan
    expect(sim.getValue('Y')).toBe(true);
    expect(codes(p)).not.toContain('subNeverCalled');
  });

  it('validation: unknown program, self and indirect recursion, unused sub', () => {
    const p = project(bools('A'), [
      program('Main', [rung([el('CALL', 'Nada')]), rung([el('CALL', 'A1')])]),
      sub('A1', [rung([el('CALL', 'B1')])]),
      sub('B1', [rung([el('CALL', 'A1')])]),
      sub('Solta', [rung([el('CALL', 'Solta')])]),
    ]);
    const c = codes(p);
    expect(c).toEqual(
      expect.arrayContaining(['unknownProgram', 'callCycle', 'recursiveCall', 'subNeverCalled']),
    );
  });

  it('runaway recursion is cut by the call depth limit', () => {
    const p = project(bools('A'), [
      program('Main', [rung([el('CALL', 'X')])]),
      sub('X', [rung([el('CALL', 'X')])]),
    ]);
    const sim = new Simulator(p);
    sim.scan(10);
    expect(sim.snapshot().faults.some((f) => f.endsWith(':callDepth'))).toBe(true);
  });
});

describe('analog', () => {
  it('SCALE maps ranges (and rounds into integer destinations)', () => {
    const p = project(
      [tag('RAW', 'INT', { initial: 13824 }), tag('PCT', 'REAL'), tag('BACK', 'INT')],
      [
        program('Main', [
          rung([el('SCALE', 'RAW', '0', '27648', '0', '100', 'PCT')]),
          rung([el('SCALE', 'PCT', '0', '100', '0', '27648', 'BACK')]),
        ]),
      ],
    );
    const sim = new Simulator(p);
    sim.scan(10);
    expect(sim.getValue('PCT')).toBe(50);
    expect(sim.getValue('BACK')).toBe(13824);
  });

  it('PID drives a first-order process to the setpoint without overshooting the clamp', () => {
    const p = project(
      [
        tag('EN', 'BOOL', { initial: true }),
        tag('PV', 'REAL'),
        tag('SP', 'REAL', { initial: 60 }),
        tag('CV', 'REAL'),
      ],
      [program('Main', [rung([no('EN'), el('PID', 'PV', 'SP', 'CV', '2', '5', '0')])])],
    );
    const sim = new Simulator(p);
    let pv = 0;
    let maxCv = 0;
    for (let i = 0; i < 6000; i++) {
      sim.setInput('PV', pv);
      sim.scan(10);
      const cv = sim.getValue('CV') as number;
      maxCv = Math.max(maxCv, cv);
      pv += ((cv - pv) * 0.01) / 2; // first-order lag towards CV
    }
    expect(Math.abs(pv - 60)).toBeLessThan(1);
    expect(maxCv).toBeLessThanOrEqual(100);
    // Manual mode (no power): the output is no longer written by the PID.
    sim.setInput('EN', false);
    sim.scan(10);
    sim.setInput('CV', 12.5); // operator sets the output by hand
    sim.setInput('PV', 0); // a big error would make an active PID react
    sim.scan(10);
    expect(sim.getValue('CV')).toBe(12.5);
  });
});
