import { describe, expect, it } from 'vitest';
import {
  applyScenario,
  channelAddress,
  coil,
  createProject,
  EXAMPLES,
  ioList,
  ioListCsv,
  no,
  parseProject,
  rung,
  SCENARIOS,
  Simulator,
  tag,
  validateProject,
  el,
  createModule,
} from '../src/index.ts';
import { makeProject } from './helpers.ts';

describe('schema', () => {
  it('accepts every example project and rejects garbage', () => {
    for (const ex of EXAMPLES) {
      const r = parseProject(JSON.parse(JSON.stringify(ex.build())));
      expect(r.ok, ex.id + (r.ok ? '' : r.error)).toBe(true);
    }
    expect(parseProject(null).ok).toBe(false);
    expect(parseProject({ schemaVersion: 1 }).ok).toBe(false);
    expect(parseProject({ ...createProject(), schemaVersion: 99 }).ok).toBe(false);
  });

  it('rejects deeply nested input', () => {
    let node: unknown = { kind: 'el', id: 'x', instr: 'NO', operands: ['A'] };
    for (let i = 0; i < 100; i++) node = { kind: 'par', id: 'p' + i, branches: [[node]] };
    const p = createProject();
    (p.programs[0]!.rungs[0]!.body as unknown[]) = [node];
    expect(parseProject(p).ok).toBe(false);
  });
});

describe('hardware addressing', () => {
  it('derives addresses from the rack for each dialect', () => {
    const p = createProject();
    p.hardware.modules = [
      createModule('cpu-generic', 0),
      createModule('di8', 1),
      createModule('di16', 2),
      createModule('ai4', 3),
      createModule('do8r', 4),
    ];
    const [, di8, di16, ai4, do8] = p.hardware.modules;
    expect(channelAddress(p.hardware, di8!.id, 3, 'siemens')).toBe('I0.3');
    expect(channelAddress(p.hardware, di16!.id, 9, 'siemens')).toBe('I2.1');
    expect(channelAddress(p.hardware, di16!.id, 9, 'iec')).toBe('%IX2.1');
    expect(channelAddress(p.hardware, di16!.id, 9, 'ab')).toBe('I:2/9');
    expect(channelAddress(p.hardware, ai4!.id, 1, 'siemens')).toBe('IW66');
    expect(channelAddress(p.hardware, ai4!.id, 1, 'ab')).toBe('I:3.1');
    expect(channelAddress(p.hardware, do8!.id, 0, 'siemens')).toBe('Q0.0');
    expect(ioList(p)).toHaveLength(8 + 16 + 4 + 8);
    expect(ioListCsv(p).split('\r\n')).toHaveLength(1 + 36);
  });
});

describe('validation', () => {
  it('reports unknown tags, type mismatches and duplicate coils', () => {
    const p = makeProject(
      [tag('A', 'BOOL'), tag('N', 'INT'), tag('Y', 'BOOL')],
      [rung([no('A'), coil('Y')]), rung([no('N'), coil('Y')]), rung([no('Missing'), el('TON', 'A', 'T#1s')])],
    );
    const codes = validateProject(p)
      .map((d) => d.code)
      .sort();
    expect(codes).toEqual(['duplicateCoil', 'typeMismatch', 'typeMismatch', 'unknownTag']);
  });

  it('examples are clean', () => {
    for (const ex of EXAMPLES) {
      const errors = validateProject(ex.build()).filter((d) => d.severity === 'error');
      expect(errors, ex.id).toEqual([]);
    }
  });
});

describe('scenarios with reference solutions', () => {
  function setup(id: string) {
    const p = createProject();
    applyScenario(p, id, true);
    const sim = new Simulator(p);
    const sc = SCENARIOS.find((s) => s.id === id)!;
    const state = sc.init();
    const io = {
      get: (n: string) => sim.getValue(n) as boolean | number,
      set: (n: string, v: boolean | number) => sim.setInput(n, v),
    };
    const run = (ms: number) => {
      for (let t = 0; t < ms; t += 10) {
        sim.scan(10);
        sc.step(state, 10, io);
      }
    };
    return { p, sim, state, run, sc, io };
  }

  it('binds every I/O tag to hardware', () => {
    for (const sc of SCENARIOS) {
      const p = createProject();
      applyScenario(p, sc.id, false);
      for (const def of sc.tags) {
        const t = p.tags.find((x) => x.name === def.name)!;
        expect(Boolean(t.io), `${sc.id}.${def.name}`).toBe(def.io !== 'MEM');
      }
      expect(validateProject(p).filter((d) => d.severity === 'error' && d.tag)).toEqual([]);
    }
  });

  it('motor: start, stop and overload trip', () => {
    const { sim, state, run, sc, io } = setup('motor');
    run(50);
    sim.setInput('B_START', true);
    run(50);
    sim.setInput('B_START', false);
    run(2000);
    expect(sim.getValue('K_MOTOR')).toBe(true);
    expect((state as { speed: number }).speed).toBeGreaterThan(0.9);
    sc.action!(state, 'toggleLoad', null, io);
    run(6000);
    expect(sim.getValue('K_MOTOR')).toBe(false);
    expect(sim.getValue('H_FAULT')).toBe(true);
  });

  it('star-delta never energizes K2 and K3 together', () => {
    const { sim, state, run } = setup('starDelta');
    sim.setInput('B_START', true);
    run(50);
    sim.setInput('B_START', false);
    run(3000);
    expect(sim.getValue('K2_STAR')).toBe(true);
    run(3000);
    expect(sim.getValue('K3_DELTA')).toBe(true);
    expect(sim.getValue('K2_STAR')).toBe(false);
    expect((state as { shortCircuit: boolean }).shortCircuit).toBe(false);
  });

  it('traffic light cycles without conflicts', () => {
    const { sim, state, run } = setup('traffic');
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      run(100);
      seen.add(['L_GREEN', 'L_YELLOW', 'L_RED'].filter((n) => sim.getValue(n)).join('+'));
    }
    expect([...seen].sort()).toEqual(['L_GREEN', 'L_RED', 'L_YELLOW']);
    expect((state as { conflicts: number }).conflicts).toBe(0);
  });

  it('conveyor sorts tall boxes', () => {
    const { sim, state, run, sc, io } = setup('conveyor');
    sc.action!(state, 'toggleFeed', null, io);
    sim.setInput('B_START', true);
    run(50);
    sim.setInput('B_START', false);
    sc.action!(state, 'addBox', 'tall', io);
    run(6000);
    sc.action!(state, 'addBox', 'short', io);
    run(20000);
    const s = state as { sortedOk: number; sortedWrong: number };
    expect(s.sortedOk).toBe(2);
    expect(s.sortedWrong).toBe(0);
  });

  it('tank keeps level between the switches', () => {
    const { state, run, sim } = setup('tank');
    let min = 1;
    let max = 0;
    for (let i = 0; i < 600; i++) {
      run(100);
      const l = (state as { level: number }).level;
      min = Math.min(min, l);
      max = Math.max(max, l);
    }
    expect(min).toBeGreaterThan(0.1);
    expect(max).toBeLessThan(0.9);
    expect((state as { overflows: number }).overflows).toBe(0);
    const pct = sim.getValue('LEVEL_PCT') as number;
    expect(pct).toBe(Math.trunc(((sim.getValue('LT_LEVEL') as number) * 100) / 27648));
    expect(pct).toBeGreaterThan(10);
    expect(pct).toBeLessThan(90);
  });
});
