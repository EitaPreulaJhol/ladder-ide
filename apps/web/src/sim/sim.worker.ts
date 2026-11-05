/// <reference lib="webworker" />
/**
 * Runs the PLC simulator and the virtual plant off the main thread.
 * Simulated time advances by `scanTimeMs` per scan; `speed` scales how much
 * simulated time passes per real millisecond.
 */
import {
  FieldFaults,
  getScenario,
  SignalRecorder,
  Simulator,
  type PlantIo,
  type Project,
  type ScenarioDef,
} from '@ladder/core';
import type { FaultEvent, FromWorker, SimStatus, ToWorker } from './protocol.ts';

let sim: Simulator | null = null;
let project: Project | null = null;
let status: SimStatus = 'stopped';
let speed = 1;
let scenario: ScenarioDef<any> | undefined;
let plantState: unknown = null;
let lastTick = performance.now();
let budget = 0;
let scansWindow = 0;
let scansPerSecond = 0;
let windowStart = performance.now();
const MAX_SCANS_PER_TICK = 5000;
const recorder = new SignalRecorder();
const fieldFaults = new FieldFaults();
let faultEvent: FaultEvent | undefined;
let trendReset = true;

function resetTrend() {
  recorder.clear();
  trendReset = true;
  if (sim) recorder.sample(sim, sim.timeMs);
}

const io: PlantIo = {
  get: (name) => {
    // The plant sees the field: a faulty output overrides what the PLC commands.
    const field = fieldFaults.outputOverride(name);
    if (field !== undefined) return field;
    const v = sim?.getValue(name);
    return typeof v === 'boolean' || typeof v === 'number' ? v : false;
  },
  set: (name, value) => sim?.setInput(name, value),
};

function post() {
  if (!sim) return;
  const msg: FromWorker = {
    type: 'snapshot',
    status,
    snapshot: sim.snapshot(),
    scenarioState: plantState,
    scansPerSecond,
    trend: { events: recorder.drain(), endMs: recorder.endMs, reset: trendReset },
    faults: {
      visible: fieldFaults.visible(),
      challenge: fieldFaults.challengeActive,
      attempts: fieldFaults.attempts,
      outputs: fieldFaults.outputOverrides(),
    },
    faultEvent,
  };
  trendReset = false;
  faultEvent = undefined;
  postMessage(msg);
}

function initPlant() {
  scenario = getScenario(project?.scenarioId);
  plantState = scenario ? scenario.init() : null;
  if (scenario && sim) {
    // Let the plant publish its sensors once so inputs are coherent before the first scan.
    scenario.step(plantState, 0, io);
    sim.refreshInputs();
  }
}

function scanOnce() {
  if (!sim || !project) return;
  const dt = project.sim.scanTimeMs;
  sim.scan(dt);
  if (scenario) scenario.step(plantState, dt, io);
  recorder.sample(sim, sim.timeMs);
  scansWindow++;
}

function tick() {
  const now = performance.now();
  const elapsed = now - lastTick;
  lastTick = now;
  if (now - windowStart >= 1000) {
    scansPerSecond = Math.round((scansWindow * 1000) / (now - windowStart));
    scansWindow = 0;
    windowStart = now;
  }
  if (status === 'running' && sim && project) {
    budget += elapsed * speed;
    const dt = project.sim.scanTimeMs;
    let n = 0;
    while (budget >= dt && n < MAX_SCANS_PER_TICK) {
      scanOnce();
      budget -= dt;
      n++;
    }
    if (n === MAX_SCANS_PER_TICK) budget = 0; // cannot keep up: drop time instead of freezing
  }
  post();
}

setInterval(tick, 33);

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  switch (m.type) {
    case 'load': {
      const scenarioChanged = project?.scenarioId !== m.project.scenarioId;
      const projectChanged = project?.id !== m.project.id;
      project = m.project;
      if (!sim) sim = new Simulator(m.project);
      else sim.load(m.project);
      if (projectChanged) fieldFaults.clear(sim);
      else fieldFaults.reapply(m.project, sim);
      if (scenarioChanged) initPlant();
      recorder.setSignals(m.project.trend ?? []);
      if (status === 'stopped') {
        sim.reset();
        resetTrend();
      } else recorder.sample(sim, sim.timeMs); // first point of newly added signals
      break;
    }
    case 'run':
      if (status === 'stopped') {
        sim?.reset();
        resetTrend();
      }
      status = 'running';
      budget = 0;
      lastTick = performance.now();
      break;
    case 'pause':
      if (status === 'running') status = 'paused';
      break;
    case 'stop':
      status = 'stopped';
      sim?.reset();
      resetTrend();
      break;
    case 'step':
      if (status === 'stopped') {
        sim?.reset();
        resetTrend();
      }
      status = 'paused';
      scanOnce();
      break;
    case 'speed':
      speed = m.value;
      break;
    case 'setInput':
      sim?.setInput(m.name, m.value);
      if (status !== 'running') sim?.refreshInputs();
      break;
    case 'force':
      sim?.setForce(m.name, m.value);
      break;
    case 'scenarioAction':
      if (scenario?.action) {
        scenario.action(plantState, m.name, m.value, io);
        scenario.step(plantState, 0, io);
        if (status !== 'running') sim?.refreshInputs();
      }
      break;
    case 'resetPlant':
      initPlant();
      break;
    case 'addFault':
      if (sim && project) fieldFaults.add(project, sim, m.signal, m.kind);
      break;
    case 'removeFault':
      if (sim) fieldFaults.remove(sim, m.signal);
      break;
    case 'clearFaults':
      if (sim) fieldFaults.clear(sim);
      break;
    case 'startChallenge':
      if (sim && project)
        faultEvent = { type: 'challengeStarted', ok: fieldFaults.startChallenge(project, sim) };
      break;
    case 'guessFault':
      if (sim)
        faultEvent = {
          type: 'guess',
          result: fieldFaults.guess(sim, m.signal, m.kind),
          attempts: fieldFaults.attempts,
        };
      break;
    case 'revealFault':
      if (sim)
        faultEvent = { type: 'revealed', fault: fieldFaults.reveal(sim), attempts: fieldFaults.attempts };
      break;
  }
  if (sim && status !== 'running') sim.refreshInputs();
  post();
};
