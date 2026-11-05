import { describe, expect, it } from 'vitest';
import {
  applyScenario,
  createGrafcet,
  createProject,
  forEachElement,
  parseCondition,
  runScenarioChecks,
  Simulator,
  stepTag,
  syncGrafcet,
  validateProject,
  type Grafcet,
  type Project,
} from '../src/index.ts';

/** The A+ B+ A- B- sequence written as a GRAFCET instead of hand-made ladder. */
function cylindersByGrafcet(): { p: Project; g: Grafcet } {
  const p = createProject();
  applyScenario(p, 'cylinders', false);
  const g = createGrafcet(p, 'Cilindros');
  g.steps = [
    { id: 's0', actions: [], comment: 'Repouso' },
    { id: 's1', actions: ['Y_A'], comment: 'A+' },
    { id: 's2', actions: ['Y_A', 'Y_B'], comment: 'B+' },
    { id: 's3', actions: ['Y_B'], comment: 'A-' },
    { id: 's4', actions: [], comment: 'B-' },
  ];
  g.transitions = [
    { id: 't0', condition: 'B_START & A0 & B0' },
    { id: 't1', condition: 'A1' },
    { id: 't2', condition: 'B1' },
    { id: 't3', condition: 'A0' },
    { id: 't4', condition: 'B0' },
  ];
  p.programs = p.programs.filter((x) => x.id === g.programId);
  syncGrafcet(p, g.id);
  return { p, g };
}

describe('GRAFCET conditions', () => {
  it('parses AND / OR / NOT, step time and constants', () => {
    expect(parseCondition('A0 & !B1 | NOT S')).toEqual({
      ok: true,
      groups: [
        [
          { kind: 'tag', operand: 'A0', negated: false },
          { kind: 'tag', operand: 'B1', negated: true },
        ],
        [{ kind: 'tag', operand: 'S', negated: true }],
      ],
    });
    expect(parseCondition('T#2s & T1.DN')).toEqual({
      ok: true,
      groups: [
        [
          { kind: 'time', ms: 2000 },
          { kind: 'tag', operand: 'T1.DN', negated: false },
        ],
      ],
    });
    expect(parseCondition('1')).toEqual({ ok: true, groups: [[{ kind: 'true' }]] });
    expect(parseCondition('').ok).toBe(false);
    expect(parseCondition('A & ').ok).toBe(false);
    expect(parseCondition('T#1s & T#2s')).toEqual({ ok: false, error: 'multipleTimes' });
    expect(parseCondition('!T#1s')).toEqual({ ok: false, error: 'negatedTime', term: 'T#1s' });
  });
});

describe('GRAFCET to ladder', () => {
  it('the generated ladder solves the cylinder exercise (all checks pass)', () => {
    const { p } = cylindersByGrafcet();
    expect(validateProject(p).filter((d) => d.severity === 'error')).toEqual([]);
    const failed = runScenarioChecks(p, 'cylinders').filter((r) => !r.passed);
    expect(failed.map((r) => `${r.id}:${r.failure?.code}`)).toEqual([]);
  });

  it('starts in the initial step and evolves on receptivities', () => {
    const { p, g } = cylindersByGrafcet();
    const sim = new Simulator(p);
    sim.setInput('A0', true);
    sim.setInput('B0', true);
    sim.scan(10);
    expect(sim.getValue(stepTag(g, 0))).toBe(true);
    sim.setInput('B_START', true);
    sim.scan(10);
    expect([sim.getValue(stepTag(g, 0)), sim.getValue(stepTag(g, 1)), sim.getValue('Y_A')]).toEqual([
      false,
      true,
      true,
    ]);
  });

  it('step time (T#) creates a timer; OR creates a parallel branch', () => {
    const p = createProject();
    const g = createGrafcet(p, 'Teste');
    g.transitions[0]!.condition = 'S1 | S2';
    g.transitions[1]!.condition = 'T#300ms';
    g.steps[1]!.actions = ['LAMP'];
    syncGrafcet(p, g.id);
    const prog = p.programs.find((x) => x.id === g.programId)!;
    expect(prog.generatedBy).toBe(g.id);
    let pars = 0;
    let tons = 0;
    for (const r of prog.rungs)
      forEachElement(r.body, (e) => {
        if (e.instr === 'TON') tons++;
      });
    for (const r of prog.rungs) pars += r.body.filter((n) => n.kind === 'par').length;
    expect(tons).toBe(1);
    expect(pars).toBeGreaterThan(0);
    expect(p.tags.find((t) => t.name === `${g.prefix}T1`)?.type).toBe('TIMER');

    const sim = new Simulator(p);
    sim.scan(10);
    sim.setInput('S2', true);
    sim.scan(10);
    expect(sim.getValue('LAMP')).toBe(true);
    sim.setInput('S2', false);
    for (let i = 0; i < 35; i++) sim.scan(10);
    expect(sim.getValue('LAMP')).toBe(false); // back to step 0 after 300 ms
    expect(sim.getValue(stepTag(g, 0))).toBe(true);
  });

  it('validation flags bad conditions; removed steps drop their tags', () => {
    const p = createProject();
    const g = createGrafcet(p, 'X');
    const codes = validateProject(p).map((d) => d.code);
    expect(codes).toContain('grafcet_empty');
    g.steps.push({ id: 'extra', actions: [] }, { id: 'extra2', actions: [] });
    g.transitions.push({ id: 'te', condition: '1' }, { id: 'te2', condition: '1' });
    syncGrafcet(p, g.id);
    expect(p.tags.some((t) => t.name === `${g.prefix}X3`)).toBe(true);
    g.steps = g.steps.slice(0, 2);
    g.transitions = g.transitions.slice(0, 2);
    syncGrafcet(p, g.id);
    expect(p.tags.some((t) => t.name === `${g.prefix}X3`)).toBe(false);
  });
});
