/**
 * Component library of the editable plant: size, tag ports and parameters of
 * each kind. Physics lives in engine.ts; drawings live in the web app.
 *
 * Port direction follows the PLC: `DO`/`AO` ports are PLC outputs the plant
 * reads (actuator commands), `DI`/`AI` ports are PLC inputs the plant writes
 * (sensors, operator devices). `ANY` ports only read a value (displays).
 */
import type { PlantComponent, PlantComponentKind, PlantParam } from '../model.ts';
import { newId } from '../ids.ts';

export type PlantCategory = 'parts' | 'actuators' | 'fluids' | 'signals' | 'operator';
export type PortIo = 'DI' | 'DO' | 'AI' | 'AO' | 'ANY';
export type PlantParams = Record<string, PlantParam>;

export interface PortDef {
  name: string;
  io: PortIo;
  /** Optional ports are left unbound by "create missing tags". */
  optional?: boolean;
  /** The port exists only for some parameter values (e.g. the retract solenoid of a double-acting cylinder). */
  when?: (p: PlantParams) => boolean;
}

interface ParamBase {
  name: string;
  when?: (p: PlantParams) => boolean;
}
export type ParamDef = ParamBase &
  (
    | { type: 'number'; default: number; min: number; max: number; step?: number; unit?: string }
    | { type: 'bool'; default: boolean }
    | { type: 'select'; default: string; options: string[] }
    | { type: 'color'; default: string }
    /** Id of a tank component ('' = outside the plant: supply or drain). */
    | { type: 'tank'; default: string }
  );

export interface ComponentDef {
  kind: PlantComponentKind;
  category: PlantCategory;
  w: number;
  h: number;
  /** Which dimensions the editor lets the user resize. */
  resize: 'none' | 'w' | 'both';
  ports: PortDef[];
  params: ParamDef[];
}

/** Raw full scale of analog channels (S7-1200 convention, used by the exercises). */
export const RAW_FULL_SCALE = 27648;

const rawMax: ParamDef = {
  name: 'rawMax',
  type: 'number',
  default: RAW_FULL_SCALE,
  min: 1,
  max: 65535,
  step: 1,
};
const cylinderAction: ParamDef = {
  name: 'action',
  type: 'select',
  default: 'single',
  options: ['single', 'double'],
};
const isDouble = (p: PlantParams) => p.action === 'double';
const motorStart = (mode: string) => (p: PlantParams) => (p.start ?? 'direct') === mode;
const valveMode = (mode: string) => (p: PlantParams) => (p.mode ?? 'onoff') === mode;

export const COMPONENT_DEFS: Record<PlantComponentKind, ComponentDef> = {
  // ------------------------------------------------------------- part handling
  conveyor: {
    kind: 'conveyor',
    category: 'parts',
    w: 300,
    h: 14,
    resize: 'w',
    ports: [
      { name: 'run', io: 'DO' },
      { name: 'rev', io: 'DO', optional: true },
    ],
    params: [
      { name: 'speed', type: 'number', default: 30, min: 1, max: 400, unit: 'px/s' },
      { name: 'dir', type: 'select', default: 'right', options: ['right', 'left'] },
    ],
  },
  feeder: {
    kind: 'feeder',
    category: 'parts',
    w: 36,
    h: 40,
    resize: 'none',
    ports: [{ name: 'feed', io: 'DO', optional: true }],
    params: [
      { name: 'interval', type: 'number', default: 5, min: 0, max: 600, step: 0.5, unit: 's' },
      { name: 'tallPct', type: 'number', default: 50, min: 0, max: 100, unit: '%' },
      { name: 'metalPct', type: 'number', default: 0, min: 0, max: 100, unit: '%' },
    ],
  },
  partSensor: {
    kind: 'partSensor',
    category: 'parts',
    w: 14,
    h: 14,
    resize: 'none',
    ports: [{ name: 'out', io: 'DI' }],
    params: [
      { name: 'type', type: 'select', default: 'optical', options: ['optical', 'inductive'] },
      { name: 'range', type: 'number', default: 50, min: 2, max: 400, unit: 'px' },
      { name: 'nc', type: 'bool', default: false },
    ],
  },
  pusher: {
    kind: 'pusher',
    category: 'parts',
    w: 28,
    h: 56,
    resize: 'none',
    ports: [
      { name: 'extend', io: 'DO' },
      { name: 'retract', io: 'DO', when: isDouble },
      { name: 'ext', io: 'DI', optional: true },
      { name: 'ret', io: 'DI', optional: true },
    ],
    params: [
      cylinderAction,
      { name: 'strokeMs', type: 'number', default: 300, min: 20, max: 20000, unit: 'ms' },
      { name: 'dir', type: 'select', default: 'up', options: ['up', 'down'] },
    ],
  },
  bin: {
    kind: 'bin',
    category: 'parts',
    w: 60,
    h: 40,
    resize: 'both',
    ports: [{ name: 'full', io: 'DI', optional: true }],
    params: [{ name: 'capacity', type: 'number', default: 0, min: 0, max: 9999 }],
  },
  // ------------------------------------------------------------- actuators
  cylinder: {
    kind: 'cylinder',
    category: 'actuators',
    w: 140,
    h: 30,
    resize: 'both',
    ports: [
      { name: 'extend', io: 'DO' },
      { name: 'retract', io: 'DO', when: isDouble },
      { name: 'ret', io: 'DI', optional: true },
      { name: 'ext', io: 'DI', optional: true },
    ],
    params: [
      cylinderAction,
      { name: 'strokeMs', type: 'number', default: 1000, min: 20, max: 60000, unit: 'ms' },
      { name: 'orient', type: 'select', default: 'h', options: ['h', 'v'] },
    ],
  },
  motor: {
    kind: 'motor',
    category: 'actuators',
    w: 80,
    h: 80,
    resize: 'none',
    ports: [
      { name: 'run', io: 'DO', when: motorStart('direct') },
      { name: 'fwd', io: 'DO', when: motorStart('reversing') },
      { name: 'rev', io: 'DO', when: motorStart('reversing') },
      { name: 'main', io: 'DO', when: motorStart('starDelta') },
      { name: 'star', io: 'DO', when: motorStart('starDelta') },
      { name: 'delta', io: 'DO', when: motorStart('starDelta') },
      { name: 'fb', io: 'DI', optional: true },
      { name: 'ovl', io: 'DI', optional: true },
    ],
    params: [
      { name: 'start', type: 'select', default: 'direct', options: ['direct', 'reversing', 'starDelta'] },
      { name: 'rampMs', type: 'number', default: 800, min: 10, max: 60000, unit: 'ms' },
    ],
  },
  // ------------------------------------------------------------- fluids
  tank: {
    kind: 'tank',
    category: 'fluids',
    w: 90,
    h: 130,
    resize: 'both',
    ports: [
      { name: 'lsl', io: 'DI', optional: true },
      { name: 'lsh', io: 'DI', optional: true },
      { name: 'lt', io: 'AI', optional: true },
    ],
    params: [
      { name: 'capacity', type: 'number', default: 1000, min: 1, max: 1_000_000, unit: 'L' },
      { name: 'initial', type: 'number', default: 30, min: 0, max: 100, unit: '%' },
      { name: 'lslPct', type: 'number', default: 15, min: 0, max: 100, unit: '%' },
      { name: 'lshPct', type: 'number', default: 85, min: 0, max: 100, unit: '%' },
      rawMax,
    ],
  },
  pump: {
    kind: 'pump',
    category: 'fluids',
    w: 44,
    h: 44,
    resize: 'none',
    ports: [
      { name: 'run', io: 'DO' },
      { name: 'fb', io: 'DI', optional: true },
    ],
    params: [
      { name: 'flow', type: 'number', default: 60, min: 0, max: 100_000, unit: 'L/s' },
      { name: 'from', type: 'tank', default: '' },
      { name: 'to', type: 'tank', default: '' },
    ],
  },
  valve: {
    kind: 'valve',
    category: 'fluids',
    w: 40,
    h: 34,
    resize: 'none',
    ports: [
      { name: 'open', io: 'DO', when: valveMode('onoff') },
      { name: 'cmd', io: 'AO', when: valveMode('proportional') },
    ],
    params: [
      { name: 'mode', type: 'select', default: 'onoff', options: ['onoff', 'proportional', 'manual'] },
      { name: 'flow', type: 'number', default: 50, min: 0, max: 100_000, unit: 'L/s' },
      { name: 'from', type: 'tank', default: '' },
      { name: 'to', type: 'tank', default: '' },
      { name: 'lagMs', type: 'number', default: 500, min: 0, max: 60000, unit: 'ms' },
      {
        name: 'opening',
        type: 'number',
        default: 40,
        min: 0,
        max: 100,
        unit: '%',
        when: valveMode('manual'),
      },
      { ...rawMax, when: valveMode('proportional') },
    ],
  },
  // ------------------------------------------------------------- signalling and thermal
  lamp: {
    kind: 'lamp',
    category: 'signals',
    w: 26,
    h: 26,
    resize: 'none',
    ports: [{ name: 'on', io: 'DO' }],
    params: [{ name: 'color', type: 'color', default: '#22c55e' }],
  },
  siren: {
    kind: 'siren',
    category: 'signals',
    w: 36,
    h: 36,
    resize: 'none',
    ports: [{ name: 'on', io: 'DO' }],
    params: [],
  },
  trafficLight: {
    kind: 'trafficLight',
    category: 'signals',
    w: 30,
    h: 84,
    resize: 'none',
    ports: [
      { name: 'red', io: 'DO' },
      { name: 'yellow', io: 'DO', when: (p) => p.lights !== '2' },
      { name: 'green', io: 'DO' },
    ],
    params: [{ name: 'lights', type: 'select', default: '3', options: ['3', '2'] }],
  },
  oven: {
    kind: 'oven',
    category: 'signals',
    w: 120,
    h: 90,
    resize: 'both',
    ports: [
      { name: 'heat', io: 'DO' },
      { name: 'power', io: 'AO', optional: true },
      { name: 'fan', io: 'DO', optional: true },
      { name: 'temp', io: 'AI', optional: true },
      { name: 'tsh', io: 'DI', optional: true },
    ],
    params: [
      { name: 'ambient', type: 'number', default: 25, min: -50, max: 100, unit: '°C' },
      { name: 'gain', type: 'number', default: 175, min: 1, max: 2000, unit: '°C' },
      { name: 'tau', type: 'number', default: 60, min: 1, max: 36000, unit: 's' },
      { name: 'tshC', type: 'number', default: 80, min: -50, max: 2000, unit: '°C' },
      { name: 'maxC', type: 'number', default: 200, min: 1, max: 2000, unit: '°C' },
      rawMax,
    ],
  },
  display: {
    kind: 'display',
    category: 'signals',
    w: 100,
    h: 44,
    resize: 'w',
    ports: [{ name: 'value', io: 'ANY' }],
    params: [
      { name: 'unit', type: 'select', default: '', options: ['', '%', '°C', 'L', 'bar', 'rpm', 's'] },
      { name: 'decimals', type: 'number', default: 1, min: 0, max: 4, step: 1 },
    ],
  },
  // ------------------------------------------------------------- operator
  pushbutton: {
    kind: 'pushbutton',
    category: 'operator',
    w: 44,
    h: 56,
    resize: 'none',
    ports: [{ name: 'out', io: 'DI' }],
    params: [
      { name: 'color', type: 'color', default: '#16a34a' },
      { name: 'nc', type: 'bool', default: false },
    ],
  },
  selector: {
    kind: 'selector',
    category: 'operator',
    w: 44,
    h: 56,
    resize: 'none',
    ports: [{ name: 'out', io: 'DI' }],
    params: [{ name: 'initial', type: 'bool', default: false }],
  },
  estop: {
    kind: 'estop',
    category: 'operator',
    w: 50,
    h: 60,
    resize: 'none',
    ports: [{ name: 'out', io: 'DI' }],
    params: [],
  },
  potentiometer: {
    kind: 'potentiometer',
    category: 'operator',
    w: 130,
    h: 44,
    resize: 'w',
    ports: [{ name: 'out', io: 'AI' }],
    params: [
      { name: 'min', type: 'number', default: 0, min: -1e9, max: 1e9 },
      { name: 'max', type: 'number', default: RAW_FULL_SCALE, min: -1e9, max: 1e9 },
      { name: 'initial', type: 'number', default: 0, min: 0, max: 100, unit: '%' },
    ],
  },
  label: {
    kind: 'label',
    category: 'operator',
    w: 140,
    h: 24,
    resize: 'w',
    ports: [],
    params: [{ name: 'size', type: 'number', default: 14, min: 8, max: 48, step: 1 }],
  },
};

export const COMPONENT_KINDS = Object.keys(COMPONENT_DEFS) as PlantComponentKind[];
export const PLANT_CATEGORIES: PlantCategory[] = ['parts', 'actuators', 'fluids', 'signals', 'operator'];

export const PLANT_DEFAULT_SIZE = { width: 640, height: 360 };
export const PLANT_MAX_SIZE = { width: 2000, height: 1200 };

/** Parameter value with the kind's default as fallback. */
export function paramOf(c: PlantComponent, name: string): PlantParam | undefined {
  const v = c.params[name];
  if (v !== undefined) return v;
  return COMPONENT_DEFS[c.kind].params.find((p) => p.name === name)?.default;
}
export const numParam = (c: PlantComponent, name: string): number => {
  const v = Number(paramOf(c, name));
  return Number.isFinite(v) ? v : 0;
};
export const strParam = (c: PlantComponent, name: string): string => String(paramOf(c, name) ?? '');
export const boolParam = (c: PlantComponent, name: string): boolean => paramOf(c, name) === true;

const withDefaults = (c: PlantComponent): PlantParams => {
  const out: PlantParams = {};
  for (const p of COMPONENT_DEFS[c.kind].params) out[p.name] = c.params[p.name] ?? p.default;
  return out;
};

/** Ports that exist with the component's current parameters. */
export function activePorts(c: PlantComponent): PortDef[] {
  const p = withDefaults(c);
  return COMPONENT_DEFS[c.kind].ports.filter((d) => !d.when || d.when(p));
}

export function activeParams(c: PlantComponent): ParamDef[] {
  const p = withDefaults(c);
  return COMPONENT_DEFS[c.kind].params.filter((d) => !d.when || d.when(p));
}

/** Tag bound to an active port (ports hidden by the parameters are ignored). */
export function portTag(c: PlantComponent, port: string): string | undefined {
  const t = c.tags[port];
  if (!t) return undefined;
  return activePorts(c).some((d) => d.name === port) ? t : undefined;
}

/** Value an input port reads at rest (NC contacts read 1), used as the tag's initial value. */
export function portRestValue(c: PlantComponent, port: string): boolean | undefined {
  switch (c.kind) {
    case 'estop':
      return true;
    case 'pushbutton':
      return boolParam(c, 'nc') || undefined;
    case 'selector':
      return boolParam(c, 'initial') || undefined;
    case 'partSensor':
      return boolParam(c, 'nc') || undefined;
    case 'motor':
      return port === 'ovl' ? true : undefined;
    default:
      return undefined;
  }
}

export function createComponent(
  kind: PlantComponentKind,
  x: number,
  y: number,
  label: string,
  overrides: Partial<Omit<PlantComponent, 'kind'>> = {},
): PlantComponent {
  const def = COMPONENT_DEFS[kind];
  return {
    id: newId('pc_'),
    kind,
    x,
    y,
    w: def.w,
    h: def.h,
    label,
    tags: {},
    params: {},
    ...overrides,
  };
}
