/**
 * Canonical, dialect-independent project model.
 *
 * A rung is a series/parallel tree: a Series is an ordered list of nodes, and a
 * Parallel node holds several branches (each a Series) whose output power is
 * OR-ed. This gives unambiguous power-flow semantics and maps directly onto the
 * branch editing model used by RSLogix and TIA Portal. The visual grid is
 * derived from this tree (see layout.ts).
 */

export const SCHEMA_VERSION = 2;

export type DialectId = 'iec' | 'ab' | 'siemens' | 'schneider' | 'haiwell';

/** Real PLC families with their own catalog and addressing rules ('generic' = free rack). */
export type FamilyId = 'generic' | 's7-1200' | 'micrologix' | 'm221' | 'haiwell';

export type DataType = 'BOOL' | 'INT' | 'DINT' | 'REAL' | 'TIMER' | 'COUNTER';

/** Memory areas. Addresses are labels for documentation/planning; memory is keyed by tag name. */
export type Area = 'I' | 'Q' | 'M' | 'T' | 'C';

export interface Address {
  area: Area;
  /** Word number (16-bit) for I/Q/M, element number for T/C. */
  index: number;
  /** Bit 0..15 inside the word, only for BOOL tags in I/Q/M. */
  bit?: number;
}

export interface Tag {
  name: string;
  type: DataType;
  address?: Address;
  comment?: string;
  /** Initial value for BOOL/INT/DINT/REAL tags. */
  initial?: number | boolean;
  /** Binding to a hardware channel. When set, the address is derived from the rack (see hardware.ts). */
  io?: IoBinding;
}

export interface IoBinding {
  module: string;
  channel: number;
}

export type InstructionId =
  // contacts
  | 'NO'
  | 'NC'
  | 'POS'
  | 'NEG'
  // coils
  | 'COIL'
  | 'NCOIL'
  | 'SET'
  | 'RESET'
  // timers / counters
  | 'TON'
  | 'TOF'
  | 'TP'
  | 'RTO'
  | 'CTU'
  | 'CTD'
  | 'CTUD'
  | 'RES'
  // compare
  | 'EQ'
  | 'NE'
  | 'GT'
  | 'GE'
  | 'LT'
  | 'LE'
  // move / math
  | 'MOVE'
  | 'ADD'
  | 'SUB'
  | 'MUL'
  | 'DIV'
  | 'MOD';

export interface Element {
  kind: 'el';
  id: string;
  instr: InstructionId;
  /** Operands are tag references (`Motor`, `T1.DN`) or literals (`10`, `2.5`, `T#5s`). */
  operands: string[];
}

export interface Parallel {
  kind: 'par';
  id: string;
  branches: Series[];
}

export type LadderNode = Element | Parallel;
export type Series = LadderNode[];

export interface Rung {
  id: string;
  comment?: string;
  body: Series;
}

export interface Program {
  id: string;
  name: string;
  rungs: Rung[];
}

// ---------------------------------------------------------------- hardware

export type ModuleKind = 'CPU' | 'PS' | 'DI' | 'DO' | 'AI' | 'AO';

export interface HardwareModule {
  id: string;
  /** Catalog reference (see hardware.ts). */
  catalogId: string;
  slot: number;
  kind: ModuleKind;
  channels: number;
  label?: string;
  /** I/O group built into the CPU (same slot as the CPU, removed together with it). */
  embedded?: boolean;
}

export interface HardwareConfig {
  family: FamilyId;
  /** CPU model id inside the family (see families.ts). */
  cpu?: string;
  rackName: string;
  slots: number;
  modules: HardwareModule[];
}

// ---------------------------------------------------------------- I/O panel

export type WidgetKind =
  'pushbutton' | 'pushbuttonNC' | 'toggle' | 'selector' | 'sensor' | 'lamp' | 'display' | 'slider';

export interface IoWidget {
  id: string;
  kind: WidgetKind;
  tag: string;
  label: string;
  color?: string;
  min?: number;
  max?: number;
}

export interface SimSettings {
  /** Simulated scan time in ms. */
  scanTimeMs: number;
}

export interface ProjectMeta {
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  /** Set when the project was forked from a shared snapshot. */
  forkedFrom?: string;
}

export interface Project {
  schemaVersion: number;
  id: string;
  meta: ProjectMeta;
  dialect: DialectId;
  tags: Tag[];
  programs: Program[];
  hardware: HardwareConfig;
  ioPanel: IoWidget[];
  scenarioId?: string;
  sim: SimSettings;
  /** Signals shown in the trend chart (tags or members such as `T1.DN`). */
  trend?: string[];
}

// ---------------------------------------------------------------- runtime values

export interface TimerValue {
  pre: number;
  acc: number;
  en: boolean;
  tt: boolean;
  dn: boolean;
}

export interface CounterValue {
  pre: number;
  acc: number;
  cu: boolean;
  cd: boolean;
  dn: boolean;
  qd: boolean;
}

export type Value = boolean | number | TimerValue | CounterValue;
