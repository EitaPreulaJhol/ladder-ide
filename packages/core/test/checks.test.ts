import { describe, expect, it } from 'vitest';
import {
  applyScenario,
  coil,
  createProject,
  el,
  nc,
  no,
  par,
  program,
  reset,
  rung,
  runScenarioChecks,
  SCENARIO_CHECKS,
  SCENARIOS,
  set,
  SignalRecorder,
  Simulator,
  tag,
  type Project,
} from '../src/index.ts';
import { makeProject } from './helpers.ts';

function scenarioProject(id: string, withSolution = true): Project {
  const p = createProject();
  applyScenario(p, id, withSolution);
  return p;
}

const failures = (p: Project, id: string) =>
  runScenarioChecks(p, id)
    .filter((r) => !r.passed)
    .map((r) => `${r.id}:${r.failure!.code}`);

describe('reference solutions pass every check', () => {
  for (const sc of SCENARIOS)
    it(sc.id, () => {
      expect(SCENARIO_CHECKS[sc.id]!.length).toBeGreaterThanOrEqual(4);
      expect(failures(scenarioProject(sc.id), sc.id)).toEqual([]);
    });
});

describe('broken solutions fail the right check', () => {
  it('motor without seal-in', () => {
    const p = scenarioProject('motor');
    p.programs = [
      program('x', [
        rung([no('B_START'), no('B_STOP'), no('F_OVL'), coil('K_MOTOR')]),
        rung([no('K_MOTOR'), coil('H_RUN')]),
        rung([nc('F_OVL'), coil('H_FAULT')]),
      ]),
    ];
    const f = failures(p, 'motor');
    expect(f).toContain('startSeal:valueMismatch');
  });

  it('star-delta without interlock and timer gating shorts K2/K3', () => {
    const p = scenarioProject('starDelta');
    p.programs = [
      program('x', [
        rung([par([no('B_START')], [no('K1_MAIN')]), no('B_STOP'), no('F_OVL'), coil('K1_MAIN')]),
        rung([no('K1_MAIN'), el('TON', 'T_STAR', 'T#5s')]),
        rung([no('K1_MAIN'), coil('K2_STAR')]),
        rung([no('K1_MAIN'), no('T_STAR.DN'), coil('K3_DELTA')]),
      ]),
    ];
    expect(failures(p, 'starDelta')).toContain('toDelta:starDeltaShort');
  });

  it('traffic light with pedestrian green always on', () => {
    const p = scenarioProject('traffic');
    p.programs[0]!.rungs.push(rung([set('P_GREEN')]));
    expect(failures(p, 'traffic')).toContain('noConflict:pedestrianConflict');
  });

  it('conveyor without the pusher logic lets tall boxes through', () => {
    const p = scenarioProject('conveyor');
    p.programs[0]!.rungs = p.programs[0]!.rungs.slice(0, 1);
    const f = failures(p, 'conveyor');
    expect(f).toContain('tallRejected:tallNotRejected');
    expect(f).not.toContain('belt:valueMismatch');
  });

  it('tank that never stops the pump overflows', () => {
    const p = scenarioProject('tank');
    p.programs[0]!.rungs.splice(1, 1); // remove "LSH resets P_FILL"
    expect(failures(p, 'tank')).toContain('noOverflow:overflow');
  });

  it('empty program reports failures instead of throwing', () => {
    for (const sc of SCENARIOS) {
      const results = runScenarioChecks(scenarioProject(sc.id, false), sc.id);
      expect(
        results.some((r) => !r.passed),
        sc.id,
      ).toBe(true);
      for (const r of results) expect(r.trace.signals.length).toBeGreaterThan(0);
    }
  });

  it('failures carry the simulated time and a recorded trace', () => {
    const p = scenarioProject('traffic');
    p.programs[0]!.rungs.push(rung([set('P_GREEN')]));
    const r = runScenarioChecks(p, 'traffic').find((x) => x.id === 'noConflict')!;
    expect(r.failure!.atMs).toBeLessThan(1000);
    expect(r.trace.events.P_GREEN!.at(-1)![1]).toBe(true);
  });
});

describe('signal recorder', () => {
  it('keeps one-scan pulses and member signals', () => {
    const p = makeProject(
      [tag('A', 'BOOL'), tag('UP', 'BOOL'), tag('T1', 'TIMER')],
      [rung([el('POS', 'A'), coil('UP')]), rung([no('A'), el('TON', 'T1', 'T#100ms')])],
    );
    const sim = new Simulator(p);
    const rec = new SignalRecorder(['UP', 'T1.DN', 'T1.ACC', 'NOPE']);
    for (let i = 0; i < 30; i++) {
      if (i === 5) sim.setInput('A', true);
      sim.scan(10);
      rec.sample(sim, sim.timeMs);
    }
    const d = rec.data();
    expect(d.events.UP).toEqual([
      [10, false],
      [60, true],
      [70, false],
    ]);
    expect(d.events['T1.DN']!.at(-1)).toEqual([150, true]);
    expect(d.events['T1.ACC']!.length).toBeGreaterThan(5);
    expect(d.events.NOPE).toEqual([]);
    expect(Object.keys(rec.drain())).toContain('UP');
    expect(rec.drain()).toEqual({});
  });
});
