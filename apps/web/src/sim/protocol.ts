import type { FaultKind, FieldFault, GuessResult, Project, SimSnapshot, TrendEvent } from '@ladder/core';

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
  | { type: 'resetPlant' }
  | { type: 'addFault'; signal: string; kind: FaultKind }
  | { type: 'removeFault'; signal: string }
  | { type: 'clearFaults' }
  | { type: 'startChallenge' }
  | { type: 'guessFault'; signal: string; kind: FaultKind }
  | { type: 'revealFault' };

export interface FaultState {
  visible: FieldFault[];
  challenge: boolean;
  attempts: number;
  /** Field value of faulty outputs (what lamps and the plant see). */
  outputs: Record<string, boolean | number>;
}

/** One-off answers to challenge actions. */
export type FaultEvent =
  | { type: 'challengeStarted'; ok: boolean }
  | { type: 'guess'; result: GuessResult; attempts: number }
  | { type: 'revealed'; fault: FieldFault | null; attempts: number };

export interface FromWorker {
  type: 'snapshot';
  status: SimStatus;
  snapshot: SimSnapshot;
  scenarioState: unknown;
  /** Real scans per second, for the status bar. */
  scansPerSecond: number;
  /** Trend events recorded since the previous message. `reset` = discard what the UI has. */
  trend: { events: Record<string, TrendEvent[]>; endMs: number; reset: boolean };
  faults: FaultState;
  faultEvent?: FaultEvent;
}
