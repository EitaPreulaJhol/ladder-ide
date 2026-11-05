/**
 * Automatic grading of scenario exercises.
 *
 * Each check is a short script run on a fresh, isolated and deterministic
 * simulation (program + plant), much faster than real time. Scripts drive the
 * plant like an operator would (press buttons, wait, trigger plant actions) and
 * assert values. Invariants (`always`) are verified after every scan.
 *
 * User-facing texts are i18n keys: titles are `checks.<scenario>.<id>` and
 * failure messages are `check.<code>` with params.
 */
import type { Project } from '../model.ts';
import { Simulator } from '../sim/engine.ts';
import { SignalRecorder, type TrendData } from '../sim/recorder.ts';
import { getScenario } from './index.ts';
import type { PlantIo, ScenarioDef } from './types.ts';
import type { ConveyorState } from './conveyor.ts';
import type { MotorState } from './motor.ts';
import type { TankState } from './tank.ts';
import type { TankPidState } from './tankPid.ts';
import type { CylindersState } from './cylinders.ts';

export interface Failure {
  code: string;
  params?: Record<string, string | number>;
  atMs: number;
}

export interface CheckResult {
  id: string;
  passed: boolean;
  failure?: Failure;
  /** Signals recorded during the check (for the trend chart). */
  trace: TrendData;
}

class CheckFailure extends Error {
  failure: Failure;
  constructor(failure: Failure) {
    super(failure.code);
    this.failure = failure;
  }
}

export interface CheckContext<S> {
  readonly state: S;
  readonly timeMs: number;
  get(signal: string): number | boolean;
  bit(signal: string): boolean;
  set(tag: string, value: boolean | number): void;
  force(tag: string, value?: boolean | number): void;
  /** Momentary operator push. NC buttons (initially 1) read 0 while pressed. */
  press(tag: string, ms?: number): void;
  action(name: string, value?: unknown): void;
  wait(ms: number): void;
  /** Waits until `signal` equals `value`, failing after `maxMs`. */
  waitFor(signal: string, value: boolean | number, maxMs: number): void;
  /** Waits until `predicate` holds, failing with `code` after `maxMs`. */
  waitUntil(
    predicate: () => boolean,
    maxMs: number,
    code: string,
    params?: Record<string, string | number>,
  ): void;
  /** Runs `fn` after every scan for `ms` (custom observers). */
  observe(ms: number, fn: () => void): void;
  expectValue(signal: string, expected: boolean | number, tolerance?: number): void;
  expect(condition: boolean, code: string, params?: Record<string, string | number>): void;
  /** Invariant checked after every remaining scan of the check. */
  always(predicate: () => boolean, code: string, params?: Record<string, string | number>): void;
}

// Default `any` lets the per-scenario check lists live in one registry.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ScenarioCheck<S = any> {
  id: string;
  run(ctx: CheckContext<S>): void;
}

const show = (v: boolean | number) => (typeof v === 'boolean' ? (v ? '1' : '0') : String(v));

export function runCheck<S>(
  project: Project,
  scenario: ScenarioDef<S>,
  check: ScenarioCheck<S>,
): CheckResult {
  const p = structuredClone(project);
  const sim = new Simulator(p);
  const state = scenario.init();
  const dt = p.sim.scanTimeMs;
  const signals = scenario.tags.filter((t) => t.type !== 'TIMER' && t.type !== 'COUNTER').map((t) => t.name);
  const recorder = new SignalRecorder(signals);
  const invariants: { pred: () => boolean; code: string; params?: Record<string, string | number> }[] = [];
  const ncButtons = new Set(
    scenario.tags.filter((t) => t.io === 'DI' && t.initial === true).map((t) => t.name),
  );

  const io: PlantIo = {
    get: (n) => {
      const v = sim.getValue(n);
      return typeof v === 'boolean' || typeof v === 'number' ? v : false;
    },
    set: (n, v) => sim.setInput(n, v),
  };
  scenario.step(state, 0, io);
  sim.refreshInputs();
  recorder.sample(sim, 0);

  const fail = (code: string, params?: Record<string, string | number>): never => {
    throw new CheckFailure({ code, params, atMs: sim.timeMs });
  };

  const scanFor = (ms: number, each?: () => boolean | void) => {
    const end = sim.timeMs + ms;
    while (sim.timeMs < end) {
      sim.scan(dt);
      scenario.step(state, dt, io);
      recorder.sample(sim, sim.timeMs);
      for (const inv of invariants) if (!inv.pred()) fail(inv.code, inv.params);
      if (each?.() === true) return true;
    }
    return false;
  };

  const read = (signal: string): number | boolean => {
    const v = sim.readSignal(signal);
    if (v === undefined) fail('missingTag', { signal });
    return v!;
  };

  const ctx: CheckContext<S> = {
    state,
    get timeMs() {
      return sim.timeMs;
    },
    get: read,
    bit: (s) => {
      const v = read(s);
      return typeof v === 'boolean' ? v : v !== 0;
    },
    set: (tag, value) => sim.setInput(tag, value),
    force: (tag, value) => sim.setForce(tag, value),
    press(tag, ms = 200) {
      const nc = ncButtons.has(tag);
      sim.setInput(tag, !nc);
      scanFor(ms);
      sim.setInput(tag, nc);
      scanFor(50);
    },
    action(name, value) {
      scenario.action?.(state, name, value, io);
    },
    wait: (ms) => void scanFor(ms),
    waitFor(signal, value, maxMs) {
      const matches = () => {
        const v = read(signal);
        return typeof value === 'boolean' ? (typeof v === 'boolean' ? v : v !== 0) === value : v === value;
      };
      if (matches()) return;
      if (!scanFor(maxMs, matches)) fail('timeout', { signal, expected: show(value), seconds: maxMs / 1000 });
    },
    waitUntil(predicate, maxMs, code, params) {
      if (predicate()) return;
      if (!scanFor(maxMs, predicate)) fail(code, params);
    },
    observe: (ms, fn) => void scanFor(ms, () => void fn()),
    expectValue(signal, expected, tolerance = 0) {
      const v = read(signal);
      const ok =
        typeof expected === 'boolean'
          ? (typeof v === 'boolean' ? v : v !== 0) === expected
          : Math.abs(Number(v) - expected) <= tolerance;
      if (!ok) fail('valueMismatch', { signal, expected: show(expected), actual: show(v) });
    },
    expect(condition, code, params) {
      if (!condition) fail(code, params);
    },
    always(pred, code, params) {
      invariants.push({ pred, code, params });
    },
  };

  try {
    check.run(ctx);
    return { id: check.id, passed: true, trace: recorder.data() };
  } catch (e) {
    if (e instanceof CheckFailure)
      return { id: check.id, passed: false, failure: e.failure, trace: recorder.data() };
    throw e;
  }
}

export function runScenarioChecks(project: Project, scenarioId: string): CheckResult[] {
  const scenario = getScenario(scenarioId);
  const checks = SCENARIO_CHECKS[scenarioId];
  if (!scenario || !checks) return [];
  return checks.map((c) => runCheck(project, scenario, c));
}

// ------------------------------------------------------------------ checks per scenario

const motorChecks: ScenarioCheck<MotorState>[] = [
  {
    id: 'startSeal',
    run(c) {
      c.press('B_START');
      c.wait(300);
      c.expectValue('K_MOTOR', true);
      c.wait(2000);
      c.expectValue('K_MOTOR', true);
    },
  },
  {
    id: 'stop',
    run(c) {
      c.press('B_START');
      c.wait(500);
      c.press('B_STOP');
      c.wait(300);
      c.expectValue('K_MOTOR', false);
      c.wait(1000);
      c.expectValue('K_MOTOR', false);
    },
  },
  {
    id: 'lamps',
    run(c) {
      c.expectValue('H_RUN', false);
      c.press('B_START');
      c.wait(300);
      c.expectValue('H_RUN', true);
      c.press('B_STOP');
      c.wait(300);
      c.expectValue('H_RUN', false);
    },
  },
  {
    id: 'overload',
    run(c) {
      c.press('B_START');
      c.wait(500);
      c.action('toggleLoad');
      c.waitFor('K_MOTOR', false, 15_000);
      c.expect(c.state.tripped, 'stoppedWithoutTrip');
      c.expectValue('H_FAULT', true);
      c.action('toggleLoad');
      c.wait(15_000);
      c.action('resetRelay');
      c.wait(1000);
      c.expectValue('K_MOTOR', false); // must not restart by itself
      c.expectValue('H_FAULT', false);
    },
  },
];

const interlock = (c: CheckContext<unknown>) =>
  c.always(() => !(c.bit('K2_STAR') && c.bit('K3_DELTA')), 'starDeltaShort');

const starDeltaChecks: ScenarioCheck[] = [
  {
    id: 'startStar',
    run(c) {
      interlock(c);
      c.press('B_START');
      c.wait(1000);
      c.expectValue('K1_MAIN', true);
      c.expectValue('K2_STAR', true);
      c.expectValue('K3_DELTA', false);
    },
  },
  {
    id: 'toDelta',
    run(c) {
      interlock(c);
      c.press('B_START');
      c.wait(3000);
      c.expectValue('K3_DELTA', false);
      c.waitFor('K3_DELTA', true, 8000);
      c.expectValue('K2_STAR', false);
      c.expectValue('K1_MAIN', true);
    },
  },
  {
    id: 'stopAll',
    run(c) {
      interlock(c);
      c.press('B_START');
      c.wait(7000);
      c.press('B_STOP');
      c.wait(300);
      for (const k of ['K1_MAIN', 'K2_STAR', 'K3_DELTA']) c.expectValue(k, false);
    },
  },
  {
    id: 'overload',
    run(c) {
      interlock(c);
      c.press('B_START');
      c.wait(7000);
      c.set('F_OVL', false);
      c.wait(300);
      for (const k of ['K1_MAIN', 'K2_STAR', 'K3_DELTA']) c.expectValue(k, false);
    },
  },
];

const CAR_LIGHTS = ['L_GREEN', 'L_YELLOW', 'L_RED'];
const NEXT_LIGHT: Record<string, string> = { L_GREEN: 'L_YELLOW', L_YELLOW: 'L_RED', L_RED: 'L_GREEN' };

const trafficChecks: ScenarioCheck[] = [
  {
    id: 'noConflict',
    run(c) {
      c.always(() => !(c.bit('P_GREEN') && (c.bit('L_GREEN') || c.bit('L_YELLOW'))), 'pedestrianConflict');
      c.wait(60_000);
    },
  },
  {
    id: 'oneLight',
    run(c) {
      c.always(() => CAR_LIGHTS.filter((l) => c.bit(l)).length <= 1, 'multipleLights');
      c.wait(60_000);
    },
  },
  {
    id: 'sequence',
    run(c) {
      let current: string | null = null;
      const seen = new Set<string>();
      c.observe(60_000, () => {
        const on = CAR_LIGHTS.find((l) => c.bit(l)) ?? null;
        if (!on || on === current) return;
        if (current && NEXT_LIGHT[current] !== on) c.expect(false, 'badSequence', { from: current, to: on });
        current = on;
        seen.add(on);
      });
      for (const l of CAR_LIGHTS) c.expect(seen.has(l), 'missingPhase', { signal: l });
    },
  },
  {
    id: 'pedestrianGreen',
    run(c) {
      c.waitFor('P_GREEN', true, 60_000);
    },
  },
];

const conveyorChecks: ScenarioCheck<ConveyorState>[] = [
  {
    id: 'belt',
    run(c) {
      c.action('toggleFeed');
      c.press('B_START');
      c.wait(300);
      c.expectValue('M_BELT', true);
      c.wait(1000);
      c.expectValue('M_BELT', true);
      c.press('B_STOP');
      c.wait(300);
      c.expectValue('M_BELT', false);
    },
  },
  {
    id: 'tallRejected',
    run(c) {
      c.action('toggleFeed');
      c.press('B_START');
      c.action('addBox', 'tall');
      c.wait(15_000);
      c.expect(c.state.sortedOk === 1 && c.state.sortedWrong === 0, 'tallNotRejected');
    },
  },
  {
    id: 'shortPasses',
    run(c) {
      c.action('toggleFeed');
      c.press('B_START');
      c.action('addBox', 'short');
      c.wait(15_000);
      c.expect(c.state.sortedOk === 1 && c.state.sortedWrong === 0, 'shortRejected');
    },
  },
  {
    id: 'mixed',
    run(c) {
      c.action('toggleFeed');
      c.press('B_START');
      for (const kind of ['tall', 'short', 'short', 'tall', 'short']) {
        c.action('addBox', kind);
        c.wait(3500);
      }
      c.wait(20_000);
      c.expect(c.state.sortedWrong === 0, 'wrongSorting', { n: c.state.sortedWrong });
      c.expect(c.state.sortedOk === 5, 'boxesLost', { n: 5 - c.state.sortedOk });
    },
  },
];

const tankChecks: ScenarioCheck<TankState>[] = [
  {
    id: 'band',
    run(c) {
      c.always(() => !c.state.overflowing, 'overflow');
      c.wait(30_000);
      c.always(() => c.state.level > 0.1 && c.state.level < 0.9, 'outOfBand');
      c.wait(120_000);
    },
  },
  {
    id: 'noOverflow',
    run(c) {
      c.always(() => !c.state.overflowing, 'overflow');
      // Drain below the low switch first, so the pump must start...
      c.action('demand', 1);
      c.waitFor('P_FILL', true, 30_000);
      // ...then stop consuming: the pump has to stop by itself at the high switch.
      c.action('demand', 0);
      c.wait(120_000);
      c.expectValue('P_FILL', false);
    },
  },
  {
    id: 'scaling',
    run(c) {
      c.force('LT_LEVEL', 13824);
      c.wait(200);
      c.expectValue('LEVEL_PCT', 50, 1);
      c.force('LT_LEVEL', 27648);
      c.wait(200);
      c.expectValue('LEVEL_PCT', 100, 1);
    },
  },
  {
    id: 'alarm',
    run(c) {
      c.force('LT_LEVEL', 27000);
      c.wait(300);
      c.expectValue('H_ALARM', true);
      c.force('LT_LEVEL', 13824);
      c.wait(300);
      c.expectValue('H_ALARM', false);
    },
  },
];

const near = (c: CheckContext<TankPidState>, pct: number, tol: number) =>
  Math.abs(c.state.level * 100 - pct) <= tol;

const tankPidChecks: ScenarioCheck<TankPidState>[] = [
  {
    id: 'reachSetpoint',
    run(c) {
      c.always(() => !c.state.overflowing, 'overflow');
      c.waitUntil(() => near(c, 50, 3), 120_000, 'setpointNotReached', { sp: 50 });
      c.always(() => near(c, 50, 4), 'notStable', { sp: 50 });
      c.wait(30_000);
    },
  },
  {
    id: 'followSetpoint',
    run(c) {
      c.wait(90_000);
      c.set('SP_PCT', 70);
      c.waitUntil(() => near(c, 70, 3), 120_000, 'setpointNotReached', { sp: 70 });
      c.always(() => c.state.level < 0.82, 'overshoot', { sp: 70 });
      c.wait(30_000);
    },
  },
  {
    id: 'disturbance',
    run(c) {
      c.wait(90_000);
      c.action('demand', 0.8);
      c.wait(150_000);
      c.expect(near(c, 50, 3), 'disturbanceNotRejected', { level: Math.round(c.state.level * 100) });
    },
  },
  {
    id: 'scaling',
    run(c) {
      c.force('LT_LEVEL', 13824);
      c.wait(200);
      c.expectValue('LEVEL_PCT', 50, 0.5);
      c.force('LT_LEVEL', undefined);
      c.force('PID_ON', false); // manual: CV_PCT keeps its value, the scaling must follow it
      c.force('CV_PCT', 25);
      c.wait(200);
      c.expectValue('CV_VALVE', 6912, 1);
    },
  },
];

const cylindersChecks: ScenarioCheck<CylindersState>[] = [
  {
    id: 'sequence',
    run(c) {
      c.press('B_START');
      c.waitUntil(() => c.state.cycles === 1, 10_000, 'cycleNotCompleted');
      c.expect(c.state.lastCycleOk === true, 'wrongSequence');
    },
  },
  {
    id: 'singleCycle',
    run(c) {
      c.press('B_START');
      c.waitUntil(() => c.state.cycles === 1, 10_000, 'cycleNotCompleted');
      c.always(() => c.state.a.pos === 0 && c.state.b.pos === 0, 'restartedAlone');
      c.wait(8000);
    },
  },
  {
    id: 'startDuringCycle',
    run(c) {
      c.press('B_START');
      c.wait(1500);
      c.press('B_START'); // pressed again in the middle of the cycle
      c.waitUntil(() => c.state.cycles >= 1, 10_000, 'cycleNotCompleted');
      c.wait(6000);
      c.expect(c.state.wrongCycles === 0, 'wrongSequence');
      c.expect(c.state.cycles === 1, 'extraCycle');
    },
  },
  {
    id: 'twoCycles',
    run(c) {
      c.press('B_START');
      c.waitUntil(() => c.state.cycles === 1, 10_000, 'cycleNotCompleted');
      c.wait(500);
      c.press('B_START');
      c.waitUntil(() => c.state.cycles === 2, 10_000, 'cycleNotCompleted');
      c.expect(c.state.wrongCycles === 0, 'wrongSequence');
    },
  },
];

export const SCENARIO_CHECKS: Record<string, ScenarioCheck[]> = {
  motor: motorChecks,
  starDelta: starDeltaChecks,
  traffic: trafficChecks,
  conveyor: conveyorChecks,
  tank: tankChecks,
  tankPid: tankPidChecks,
  cylinders: cylindersChecks,
};
