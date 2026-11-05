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
  | 'MOD'
  // bistables
  | 'SR'
  | 'RS'
  // program control
  | 'JMP'
  | 'LBL'
  | 'CALL'
  // analog
  | 'SCALE'
  | 'PID'
  // shift
  | 'BSL'
  | 'BSR'
  | 'SHL'
  | 'SHR'
  // Siemens-style analog
  | 'NORM_X'
  | 'SCALE_X';

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
  /** 'main' (default) runs every scan in program order; 'sub' runs only when called (CALL/JSR). */
  kind?: 'main' | 'sub';
  /** Id of the GRAFCET this program is generated from (read-only in the editor). */
  generatedBy?: string;
}

// ---------------------------------------------------------------- GRAFCET (SFC)

export interface GrafcetStep {
  id: string;
  /** Continuous (N) actions: BOOL tags kept on while the step is active. */
  actions: string[];
  comment?: string;
}

export interface GrafcetTransition {
  id: string;
  /** `A0 & B0 | !S1`, `T#2s` (time in the previous step). & binds tighter than |. */
  condition: string;
}

/**
 * Linear GRAFCET: transition i goes from step i to step i + 1; the last one goes
 * back to step `loopTo`. Step 0 is the initial step.
 */
export interface Grafcet {
  id: string;
  name: string;
  /** Prefix of the generated tags (step bits `<prefix>X0`, step timers `<prefix>T0`). */
  prefix: string;
  steps: GrafcetStep[];
  transitions: GrafcetTransition[];
  loopTo: number;
  /** Generated ladder program. */
  programId: string;
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

// ---------------------------------------------------------------- HMI screens

export type HmiWidgetKind = WidgetKind | 'text' | 'bar' | 'numeric' | 'nav' | 'trend';

export interface HmiWidget {
  id: string;
  kind: HmiWidgetKind;
  /** Bound tag (not used by 'text' and 'nav'). */
  tag: string;
  label: string;
  /** Position and size on the 800 × 480 screen. */
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
  min?: number;
  max?: number;
  /** Target screen of a 'nav' button. */
  target?: string;
}

export interface HmiScreen {
  id: string;
  name: string;
  widgets: HmiWidget[];
}

export type ModbusArea = 'coil' | 'discrete' | 'holding' | 'input';

/** One tag exposed through the Modbus TCP bridge. DINT/REAL take two registers. */
export interface ModbusEntry {
  tag: string;
  area: ModbusArea;
  address: number;
}

// ---------------------------------------------------------------- editable plant

export type PlantComponentKind =
  // part handling
  | 'conveyor'
  | 'feeder'
  | 'partSensor'
  | 'pusher'
  | 'bin'
  // actuators
  | 'cylinder'
  | 'motor'
  // fluids
  | 'tank'
  | 'pump'
  | 'valve'
  // signalling and thermal
  | 'lamp'
  | 'siren'
  | 'trafficLight'
  | 'oven'
  | 'display'
  // operator
  | 'pushbutton'
  | 'selector'
  | 'estop'
  | 'potentiometer'
  | 'label';

export type PlantParam = number | boolean | string;

/** One item of an editable plant: geometry, tag bindings per port and parameters (see plant/components.ts). */
export interface PlantComponent {
  id: string;
  kind: PlantComponentKind;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  /** Port name → tag name. */
  tags: Record<string, string>;
  params: Record<string, PlantParam>;
}

export interface PlantDesign {
  width: number;
  height: number;
  components: PlantComponent[];
}

export const HMI_WIDTH = 800;
export const HMI_HEIGHT = 480;

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
  grafcets?: Grafcet[];
  hmi?: { screens: HmiScreen[] };
  modbus?: { map: ModbusEntry[] };
  /** Editable plant built from components (exclusive with `scenarioId`). */
  plant?: PlantDesign;
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
