import type { Project, SimSnapshot, TrendEvent } from '@ladder/core';

export type SimStatus = 'stopped' | 'running' | 'paused';

export type ToWorker =
  | { type: 'load'; project: Project }
  | { type: 'run' }
  | { type: 'pause' }
  | { type: 'stop' }
  | { type: 'step' }
  | { type: 'speed'; value: number }
  | { type: 'setInput'; name: string; value: boolean | number }
  | { type: 'force'; name: string; value?: boolean | number }
  | { type: 'scenarioAction'; name: string; value?: unknown }
  | { type: 'resetPlant' };

export interface FromWorker {
  type: 'snapshot';
  status: SimStatus;
  snapshot: SimSnapshot;
  scenarioState: unknown;
  /** Real scans per second, for the status bar. */
  scansPerSecond: number;
  /** Trend events recorded since the previous message. `reset` = discard what the UI has. */
  trend: { events: Record<string, TrendEvent[]>; endMs: number; reset: boolean };
}
