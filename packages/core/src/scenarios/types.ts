import type { DataType, Program } from '../model.ts';

export type ScenarioIoKind = 'DI' | 'DO' | 'AI' | 'AO' | 'MEM';

export interface ScenarioTag {
  name: string;
  type: DataType;
  io: ScenarioIoKind;
  comment: string;
  /** Initial value forced into the input image when the scenario starts (e.g. NC buttons read 1 at rest). */
  initial?: boolean | number;
}

export interface PlantIo {
  get(name: string): boolean | number;
  set(name: string, value: boolean | number): void;
}

export interface ScenarioDef<S = unknown> {
  id: string;
  tags: ScenarioTag[];
  init(): S;
  /** Advances the physical process by dt ms. Reads PLC outputs and writes sensor inputs through `io`. */
  step(state: S, dtMs: number, io: PlantIo): void;
  /** Operator/plant actions triggered from the plant view (trip a relay, add a box...). */
  action?(state: S, name: string, value: unknown, io: PlantIo): void;
  /** A reference solution, so learners can compare or start from it. */
  solution(): Program;
}

export const asBool = (v: boolean | number) => (typeof v === 'boolean' ? v : v !== 0);
