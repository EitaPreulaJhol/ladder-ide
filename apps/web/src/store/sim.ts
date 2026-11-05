import { create } from 'zustand';
import type { CheckResult, Project, SimSnapshot, TrendEvent } from '@ladder/core';
import type { FaultEvent, FaultState, FromWorker, SimStatus, ToWorker } from '../sim/protocol.ts';
import { useProject } from './project.ts';

export type BottomTab = 'watch' | 'trend' | 'faults' | 'problems';

/** Live trend data, mutated in place (arrays can be long); `trendVersion` triggers re-renders. */
export const liveTrend: { events: Record<string, TrendEvent[]>; endMs: number } = { events: {}, endMs: 0 };
const TREND_KEEP_MS = 10 * 60_000;

/** A recorded run shown in the trend tab instead of live data (e.g. a failed check). */
export interface TrendCapture {
  scenarioId: string;
  result: CheckResult;
}

interface SimState {
  faults: FaultState;
  /** Last challenge answer (kept until the next one). */
  faultEvent: FaultEvent | null;
  trendVersion: number;
  bottomTab: BottomTab;
  capture: TrendCapture | null;
  setBottomTab(tab: BottomTab): void;
  showCapture(capture: TrendCapture | null): void;
  status: SimStatus;
  speed: number;
  snapshot: SimSnapshot | null;
  scenarioState: unknown;
  scansPerSecond: number;
  send(msg: ToWorker): void;
  run(): void;
  pause(): void;
  stop(): void;
  step(): void;
  setSpeed(v: number): void;
  setInput(name: string, value: boolean | number): void;
  force(name: string, value?: boolean | number): void;
  plantAction(name: string, value?: unknown): void;
}

let loadTimer: ReturnType<typeof setTimeout> | undefined;
let lastSent: Project | null = null;

const worker = new Worker(new URL('../sim/sim.worker.ts', import.meta.url), { type: 'module' });

/** Sends the latest edited project to the worker right away if a debounced load is pending. */
function flushPendingLoad() {
  const project = useProject.getState().project;
  if (!project || project === lastSent) return;
  clearTimeout(loadTimer);
  lastSent = project;
  worker.postMessage({ type: 'load', project } satisfies ToWorker);
}

export const useSim = create<SimState>((set) => {
  // Every command first syncs pending edits, so it never acts on a stale program (e.g. a tag just created).
  const send = (msg: ToWorker) => {
    flushPendingLoad();
    worker.postMessage(msg);
  };
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    const t = m.trend;
    if (t.reset) liveTrend.events = {};
    for (const [signal, evs] of Object.entries(t.events)) (liveTrend.events[signal] ??= []).push(...evs);
    const changed = t.reset || Object.keys(t.events).length > 0 || t.endMs !== liveTrend.endMs;
    liveTrend.endMs = t.endMs;
    if (changed) trimTrend();
    set((st) => ({
      trendVersion: changed ? st.trendVersion + 1 : st.trendVersion,
      status: m.status,
      snapshot: m.snapshot,
      scenarioState: m.scenarioState,
      scansPerSecond: m.scansPerSecond,
      faults: m.faults,
      faultEvent: m.faultEvent ?? st.faultEvent,
    }));
  };
  return {
    faults: { visible: [], challenge: false, attempts: 0, outputs: {} },
    faultEvent: null,
    trendVersion: 0,
    bottomTab: 'watch',
    capture: null,
    setBottomTab: (bottomTab) => set({ bottomTab }),
    showCapture: (capture) => set(capture ? { capture, bottomTab: 'trend' } : { capture: null }),
    status: 'stopped',
    speed: 1,
    snapshot: null,
    scenarioState: null,
    scansPerSecond: 0,
    send,
    run: () => send({ type: 'run' }),
    pause: () => send({ type: 'pause' }),
    stop: () => send({ type: 'stop' }),
    step: () => send({ type: 'step' }),
    setSpeed(value) {
      set({ speed: value });
      send({ type: 'speed', value });
    },
    setInput: (name, value) => send({ type: 'setInput', name, value }),
    force: (name, value) => send({ type: 'force', name, value }),
    plantAction: (name, value) => send({ type: 'scenarioAction', name, value }),
  };
});

let lastTrim = 0;
function trimTrend() {
  if (liveTrend.endMs - lastTrim < 5000 && liveTrend.endMs >= lastTrim) return;
  lastTrim = liveTrend.endMs;
  const limit = liveTrend.endMs - TREND_KEEP_MS;
  for (const evs of Object.values(liveTrend.events)) {
    let i = 0;
    while (i + 1 < evs.length && evs[i + 1]![0] <= limit) i++;
    if (i > 0) evs.splice(0, i);
  }
}

/** Keeps the worker in sync with the edited project (online editing / hot reload). */
useProject.subscribe((s) => {
  if (!s.project || s.project === lastSent) return;
  clearTimeout(loadTimer);
  const immediate = lastSent === null || (lastSent as Project).id !== s.project.id;
  if (immediate) flushPendingLoad();
  else loadTimer = setTimeout(flushPendingLoad, 80);
});
