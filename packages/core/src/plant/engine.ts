/**
 * Physics of the editable plant. Each scan the plant reads the PLC outputs
 * bound to actuator ports, advances the process by dt and writes the sensor
 * ports back into the input image.
 *
 * Components interact through geometry, not explicit wiring: a part sits on
 * the conveyor under it, a sensor sees what crosses its beam, a pusher acts on
 * the conveyor in front of its rod and parts land in the bin they fall or are
 * pushed into. Fluids are the exception: pumps and valves name their source
 * and destination tanks.
 *
 * Drawing convention: the canvas is a side view. Pushing a part off a belt
 * moves it across the belt (out of the drawing plane), which is drawn as a
 * move towards the pusher's rod direction; pushed parts are no longer seen by
 * sensors on that belt.
 */
import type { PlantComponent, PlantDesign } from '../model.ts';
import type { PlantIo } from '../scenarios/types.ts';
import { asBool } from '../scenarios/types.ts';
import { boolParam, numParam, portTag, strParam } from './components.ts';

/** Part size in px (side view). */
export const PART = { w: 21, tall: 40, short: 22 };
/** Gravity (px/s²) and lateral speed of pushed parts (px/s). */
const GRAVITY = 900;
const PUSH_SPEED = 120;
/** How far a pushed part travels before it is lost (no bin on its way). */
const PUSH_TRAVEL = 200;
/** Max gap between a pusher's rod end and the belt it acts on. */
const PUSH_REACH = 100;
const BELT_H = 14;

export interface Part {
  id: number;
  /** Center x and bottom y. */
  x: number;
  y: number;
  w: number;
  h: number;
  tall: boolean;
  metal: boolean;
  mode: 'belt' | 'fall' | 'pushed';
  /** Conveyor carrying the part ('belt' mode). */
  on?: string;
  vx: number;
  vy: number;
  /** Push direction (-1 up, 1 down) and distance travelled while pushed. */
  dy: number;
  travel: number;
}

export interface ConveyorCompState {
  /** Current belt speed in px/s (signed). */
  v: number;
}
export interface FeederCompState {
  timer: number;
  auto: boolean;
  last: boolean;
  fed: number;
}
export interface SensorCompState {
  on: boolean;
}
export interface CylinderCompState {
  /** 0 = retracted, 1 = extended. */
  pos: number;
  /** Direction memorized by the double-solenoid valve (1 extend, -1 retract). */
  valve: number;
}
export interface BinCompState {
  count: number;
  tall: number;
  metal: number;
}
export interface MotorCompState {
  /** -1..1 (negative = reverse). */
  speed: number;
  /** Line current in multiples of the nominal current. */
  current: number;
  /** Thermal image 0..1.2; the overload relay trips at 1. */
  temperature: number;
  tripped: boolean;
  heavy: boolean;
  /** Short circuit latched (star + delta, or forward + reverse at the same time). */
  short: boolean;
  mode: 'off' | 'run' | 'star' | 'delta' | 'short';
  /** Starts with high current: delta without star, or reversing at speed. */
  hardStarts: number;
  lastTarget: number;
}
export interface TankCompState {
  /** 0..1 */
  level: number;
  overflows: number;
  overflowing: boolean;
}
export interface PumpCompState {
  running: boolean;
  /** Running with the suction tank empty. */
  dry: boolean;
  /** Flow in the last scan (L/s). */
  q: number;
}
export interface ValveCompState {
  /** Actual opening 0..1. */
  opening: number;
  /** Operator setting of a manual valve 0..1. */
  manual: number;
  q: number;
}
export interface OvenCompState {
  temp: number;
  overheats: number;
  hot: boolean;
}
export interface OperatorCompState {
  /** Pushbutton / e-stop pressed, selector on, potentiometer 0..1. */
  value: boolean | number;
  written?: boolean | number;
}

export type ComponentState =
  | ConveyorCompState
  | FeederCompState
  | SensorCompState
  | CylinderCompState
  | BinCompState
  | MotorCompState
  | TankCompState
  | PumpCompState
  | ValveCompState
  | OvenCompState
  | OperatorCompState
  | Record<string, never>;

export interface PlantState {
  comps: Record<string, ComponentState>;
  parts: Part[];
  nextPart: number;
  seed: number;
  /** Parts that fell off the plant or were pushed nowhere. */
  lost: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function initComponentState(c: PlantComponent): ComponentState {
  switch (c.kind) {
    case 'conveyor':
      return { v: 0 } satisfies ConveyorCompState;
    case 'feeder':
      return { timer: 0, auto: true, last: false, fed: 0 } satisfies FeederCompState;
    case 'partSensor':
      return { on: false } satisfies SensorCompState;
    case 'pusher':
    case 'cylinder':
      return { pos: 0, valve: -1 } satisfies CylinderCompState;
    case 'bin':
      return { count: 0, tall: 0, metal: 0 } satisfies BinCompState;
    case 'motor':
      return {
        speed: 0,
        current: 0,
        temperature: 0,
        tripped: false,
        heavy: false,
        short: false,
        mode: 'off',
        hardStarts: 0,
        lastTarget: 0,
      } satisfies MotorCompState;
    case 'tank':
      return {
        level: clamp01(numParam(c, 'initial') / 100),
        overflows: 0,
        overflowing: false,
      } satisfies TankCompState;
    case 'pump':
      return { running: false, dry: false, q: 0 } satisfies PumpCompState;
    case 'valve': {
      const manual = clamp01(numParam(c, 'opening') / 100);
      return {
        opening: strParam(c, 'mode') === 'manual' ? manual : 0,
        manual,
        q: 0,
      } satisfies ValveCompState;
    }
    case 'oven':
      return { temp: numParam(c, 'ambient'), overheats: 0, hot: false } satisfies OvenCompState;
    case 'pushbutton':
    case 'estop':
      return { value: false } satisfies OperatorCompState;
    case 'selector':
      return { value: boolParam(c, 'initial') } satisfies OperatorCompState;
    case 'potentiometer':
      return { value: clamp01(numParam(c, 'initial') / 100) } satisfies OperatorCompState;
    default:
      return {};
  }
}

export function initPlantState(design: PlantDesign): PlantState {
  const comps: Record<string, ComponentState> = {};
  for (const c of design.components) comps[c.id] = initComponentState(c);
  return { comps, parts: [], nextPart: 1, seed: 12345, lost: 0 };
}

/**
 * Keeps the state of components that still exist after an edit (levels,
 * positions, parts) and initializes new ones. Mutates and returns `state`.
 */
export function reconcilePlantState(state: PlantState, design: PlantDesign): PlantState {
  const comps: Record<string, ComponentState> = {};
  for (const c of design.components) comps[c.id] = state.comps[c.id] ?? initComponentState(c);
  state.comps = comps;
  return state;
}

function rand(s: PlantState): number {
  s.seed = (s.seed * 1103515245 + 12345) & 0x7fffffff;
  return s.seed / 0x7fffffff;
}

function partCovers(p: Part, x: number): boolean {
  return x >= p.x - p.w / 2 && x <= p.x + p.w / 2;
}

/** Conveyor a pusher acts on: the closest belt in front of its rod, spanning its center. */
function pusherTarget(pu: PlantComponent, convs: PlantComponent[]): PlantComponent | undefined {
  const cx = pu.x + pu.w / 2;
  const up = strParam(pu, 'dir') !== 'down';
  let best: PlantComponent | undefined;
  let bestGap = Infinity;
  for (const cv of convs) {
    if (cx < cv.x || cx > cv.x + cv.w) continue;
    const gap = up ? pu.y - (cv.y + BELT_H) : cv.y - (pu.y + pu.h);
    if (gap < -BELT_H || gap > PUSH_REACH) continue;
    if (gap < bestGap) {
      bestGap = gap;
      best = cv;
    }
  }
  return best;
}

function dropPart(c: PlantComponent, st: PlantState, forced?: 'tall' | 'short'): boolean {
  const cx = c.x + c.w / 2;
  const top = c.y + c.h;
  // Blocked while the previous part is still under the chute.
  if (
    st.parts.some((p) => p.mode !== 'pushed' && Math.abs(p.x - cx) < p.w && p.y > top - 1 && p.y < top + 120)
  )
    return false;
  const tall = forced ? forced === 'tall' : rand(st) * 100 < numParam(c, 'tallPct');
  const metal = rand(st) * 100 < numParam(c, 'metalPct');
  const h = tall ? PART.tall : PART.short;
  st.parts.push({
    id: st.nextPart++,
    x: cx,
    y: top + h,
    w: PART.w,
    h,
    tall,
    metal,
    mode: 'fall',
    vx: 0,
    vy: 0,
    dy: 0,
    travel: 0,
  });
  (st.comps[c.id] as FeederCompState).fed++;
  return true;
}

function stepCylinder(c: PlantComponent, s: CylinderCompState, dtMs: number, get: (port: string) => boolean) {
  let dir: number;
  if (strParam(c, 'action') === 'double') {
    const ext = get('extend');
    const ret = get('retract');
    if (ext && !ret) s.valve = 1;
    else if (ret && !ext) s.valve = -1;
    dir = s.valve;
  } else dir = get('extend') ? 1 : -1;
  const stroke = Math.max(1, numParam(c, 'strokeMs'));
  s.pos = clamp01(s.pos + (dir * dtMs) / stroke);
}

function stepMotor(c: PlantComponent, s: MotorCompState, dtMs: number, get: (port: string) => boolean) {
  const start = strParam(c, 'start');
  let target = 0;
  let mode: MotorCompState['mode'] = 'off';
  let shortNow = false;
  if (start === 'starDelta') {
    const k1 = get('main');
    const k2 = get('star');
    const k3 = get('delta');
    if (k2 && k3) shortNow = true;
    else if (k1 && k2) {
      mode = 'star';
      target = 0.9;
    } else if (k1 && k3) {
      mode = 'delta';
      target = 1;
    }
  } else if (start === 'reversing') {
    const f = get('fwd');
    const r = get('rev');
    if (f && r) shortNow = true;
    else if (f || r) {
      mode = 'run';
      target = f ? 1 : -1;
    }
  } else if (get('run')) {
    mode = 'run';
    target = 1;
  }
  if (shortNow) {
    s.short = true;
    mode = 'short';
  }
  // Hard starts: delta straight from standstill, or reversing while still turning the other way.
  if (target !== 0 && target !== s.lastTarget) {
    if (mode === 'delta' && Math.abs(s.speed) < 0.5 && s.lastTarget === 0) s.hardStarts++;
    if (Math.sign(target) === -Math.sign(s.speed) && Math.abs(s.speed) > 0.3) s.hardStarts++;
  }
  s.lastTarget = target;
  s.mode = mode;
  const ramp = Math.max(1, numParam(c, 'rampMs')) * (mode === 'star' ? 1.9 : 1);
  s.speed += (target - s.speed) * Math.min(1, dtMs / ramp);
  const slip = Math.abs(target - s.speed);
  s.current =
    mode === 'off'
      ? 0
      : mode === 'short'
        ? 20
        : mode === 'star'
          ? 0.4 + 2 * slip
          : 0.9 + 6 * Math.min(slip, 2) * (mode === 'delta' ? 1 : 0.85);
  const on = mode !== 'off' && mode !== 'short';
  const heat = on ? (s.heavy ? 0.25 : 0.02) : -0.05;
  s.temperature = Math.max(0, Math.min(1.2, s.temperature + (heat * dtMs) / 1000));
  if (s.temperature >= 1) s.tripped = true;
}

/** Advances the plant by `dtMs` (0 = only publish the sensors). */
export function stepPlant(design: PlantDesign, st: PlantState, dtMs: number, io: PlantIo): void {
  const dt = dtMs / 1000;
  const comps = design.components;
  const S = <T extends ComponentState>(c: PlantComponent): T =>
    (st.comps[c.id] ??= initComponentState(c)) as T;
  const getB = (c: PlantComponent, port: string): boolean => {
    const t = portTag(c, port);
    return t ? asBool(io.get(t)) : false;
  };
  const getN = (c: PlantComponent, port: string): number => {
    const t = portTag(c, port);
    if (!t) return 0;
    const v = io.get(t);
    return typeof v === 'number' ? v : v ? 1 : 0;
  };
  const put = (c: PlantComponent, port: string, v: boolean | number) => {
    const t = portTag(c, port);
    if (t) io.set(t, v);
  };

  const convs: PlantComponent[] = [];
  const tanks = new Map<string, { c: PlantComponent; s: TankCompState }>();
  for (const c of comps) {
    if (c.kind === 'conveyor') convs.push(c);
    if (c.kind === 'tank') tanks.set(c.id, { c, s: S<TankCompState>(c) });
  }

  // ---- 1. actuators
  for (const c of comps) {
    switch (c.kind) {
      case 'cylinder':
      case 'pusher':
        stepCylinder(c, S(c), dtMs, (p) => getB(c, p));
        break;
      case 'motor':
        stepMotor(c, S(c), dtMs, (p) => getB(c, p));
        break;
      case 'conveyor': {
        const sign = (strParam(c, 'dir') === 'left' ? -1 : 1) * (getB(c, 'rev') ? -1 : 1);
        S<ConveyorCompState>(c).v = getB(c, 'run') ? numParam(c, 'speed') * sign : 0;
        break;
      }
      case 'pump':
        S<PumpCompState>(c).running = getB(c, 'run');
        break;
      case 'valve': {
        const s = S<ValveCompState>(c);
        const mode = strParam(c, 'mode');
        const target =
          mode === 'manual'
            ? s.manual
            : mode === 'proportional'
              ? clamp01(getN(c, 'cmd') / Math.max(1, numParam(c, 'rawMax')))
              : getB(c, 'open')
                ? 1
                : 0;
        const lag = numParam(c, 'lagMs');
        s.opening = lag <= 0 ? target : s.opening + (target - s.opening) * Math.min(1, dtMs / lag);
        break;
      }
      case 'oven': {
        const s = S<OvenCompState>(c);
        const amb = numParam(c, 'ambient');
        const u = Math.max(
          getB(c, 'heat') ? 1 : 0,
          clamp01(getN(c, 'power') / Math.max(1, numParam(c, 'rawMax'))),
        );
        const loss = (s.temp - amb) * (getB(c, 'fan') ? 3 : 1);
        s.temp += ((numParam(c, 'gain') * u - loss) * dt) / Math.max(1, numParam(c, 'tau'));
        const hot = s.temp >= numParam(c, 'maxC');
        if (hot && !s.hot) s.overheats++;
        s.hot = hot;
        break;
      }
    }
  }

  // ---- 2. fluids (L/s between tanks; '' = outside supply / drain)
  for (const c of comps) {
    if (c.kind !== 'pump' && c.kind !== 'valve') continue;
    const src = tanks.get(strParam(c, 'from'));
    const dst = tanks.get(strParam(c, 'to'));
    let q: number;
    if (c.kind === 'pump') {
      const s = S<PumpCompState>(c);
      q = s.running ? numParam(c, 'flow') : 0;
      s.dry = s.running && !!src && src.s.level < 0.02;
    } else {
      q = numParam(c, 'flow') * S<ValveCompState>(c).opening;
      // Gravity outflow weakens as the source tank empties.
      if (src) q *= Math.min(1, src.s.level * 4);
    }
    let vol = q * dt;
    if (src) {
      const cap = Math.max(1, numParam(src.c, 'capacity'));
      vol = Math.min(vol, Math.max(0, src.s.level) * cap);
      src.s.level -= vol / cap;
    }
    if (dst) dst.s.level += vol / Math.max(1, numParam(dst.c, 'capacity'));
    const flow = dt > 0 ? vol / dt : q;
    if (c.kind === 'pump') S<PumpCompState>(c).q = flow;
    else S<ValveCompState>(c).q = flow;
  }
  for (const { s } of tanks.values()) {
    const over = s.level >= 1;
    if (over && !s.overflowing) s.overflows++;
    s.overflowing = over;
    s.level = clamp01(s.level);
  }

  // ---- 3. parts
  for (const c of comps) {
    if (c.kind !== 'feeder') continue;
    const s = S<FeederCompState>(c);
    const cmd = getB(c, 'feed');
    if (cmd && !s.last) dropPart(c, st);
    s.last = cmd;
    const interval = numParam(c, 'interval');
    if (s.auto && interval > 0 && dtMs > 0) {
      s.timer += dtMs;
      if (s.timer >= interval * 1000) {
        s.timer = 0;
        dropPart(c, st);
      }
    }
  }
  const byId = new Map(comps.map((c) => [c.id, c]));
  if (dtMs > 0)
    for (const p of st.parts) {
      if (p.mode === 'belt') {
        const cv = p.on ? byId.get(p.on) : undefined;
        if (!cv || cv.kind !== 'conveyor') {
          p.mode = 'fall';
          p.vx = 0;
          p.vy = 0;
          continue;
        }
        const v = S<ConveyorCompState>(cv).v;
        p.x += v * dt;
        p.y = cv.y;
        if (p.x < cv.x || p.x > cv.x + cv.w) {
          p.mode = 'fall';
          p.on = undefined;
          p.vx = v;
          p.vy = 0;
        }
      } else if (p.mode === 'fall') {
        p.vy += GRAVITY * dt;
        const nx = p.x + p.vx * dt;
        const ny = p.y + p.vy * dt;
        let landing: PlantComponent | undefined;
        for (const cv of convs)
          if (nx >= cv.x && nx <= cv.x + cv.w && cv.y >= p.y - 0.01 && cv.y <= ny)
            if (!landing || cv.y < landing.y) landing = cv;
        if (landing) {
          p.mode = 'belt';
          p.on = landing.id;
          p.x = nx;
          p.y = landing.y;
          p.vx = 0;
          p.vy = 0;
        } else {
          p.x = nx;
          p.y = ny;
        }
      } else {
        p.y += p.dy * PUSH_SPEED * dt;
        p.travel += PUSH_SPEED * dt;
      }
    }

  for (const pu of comps) {
    if (pu.kind !== 'pusher' || S<CylinderCompState>(pu).pos <= 0.5) continue;
    const cv = pusherTarget(pu, convs);
    if (!cv) continue;
    const cx = pu.x + pu.w / 2;
    const dy = strParam(pu, 'dir') === 'down' ? 1 : -1;
    for (const p of st.parts)
      if (p.mode === 'belt' && p.on === cv.id && partCovers(p, cx)) {
        p.mode = 'pushed';
        p.on = undefined;
        p.dy = dy;
        p.travel = 0;
      }
  }

  const bins = comps.filter((c) => c.kind === 'bin');
  st.parts = st.parts.filter((p) => {
    if (p.mode === 'belt') return true;
    const cy = p.y - p.h / 2;
    const bin = bins.find((b) => p.x >= b.x && p.x <= b.x + b.w && cy >= b.y && cy <= b.y + b.h);
    if (bin) {
      const s = S<BinCompState>(bin);
      s.count++;
      if (p.tall) s.tall++;
      if (p.metal) s.metal++;
      return false;
    }
    const gone =
      p.mode === 'pushed'
        ? p.travel > PUSH_TRAVEL
        : p.y - p.h > design.height + 20 || p.x < -50 || p.x > design.width + 50;
    if (gone) st.lost++;
    return !gone;
  });

  // ---- 4. sensors and operator devices
  for (const c of comps) {
    switch (c.kind) {
      case 'partSensor': {
        const bx = c.x + c.w / 2;
        const y0 = c.y + c.h;
        const y1 = y0 + numParam(c, 'range');
        const metalOnly = strParam(c, 'type') === 'inductive';
        const on = st.parts.some(
          (p) =>
            p.mode !== 'pushed' &&
            (!metalOnly || p.metal) &&
            partCovers(p, bx) &&
            p.y - p.h <= y1 &&
            p.y >= y0,
        );
        S<SensorCompState>(c).on = on;
        put(c, 'out', boolParam(c, 'nc') ? !on : on);
        break;
      }
      case 'cylinder':
      case 'pusher': {
        const s = S<CylinderCompState>(c);
        put(c, 'ret', s.pos <= 0.01);
        put(c, 'ext', s.pos >= 0.99);
        break;
      }
      case 'motor': {
        const s = S<MotorCompState>(c);
        put(c, 'fb', Math.abs(s.speed) > 0.2);
        put(c, 'ovl', !s.tripped);
        break;
      }
      case 'tank': {
        const s = S<TankCompState>(c);
        put(c, 'lsl', s.level * 100 >= numParam(c, 'lslPct'));
        put(c, 'lsh', s.level * 100 >= numParam(c, 'lshPct'));
        put(c, 'lt', Math.round(s.level * numParam(c, 'rawMax')));
        break;
      }
      case 'pump':
        put(c, 'fb', S<PumpCompState>(c).running);
        break;
      case 'oven': {
        const s = S<OvenCompState>(c);
        const raw = clamp01(s.temp / Math.max(1, numParam(c, 'maxC'))) * numParam(c, 'rawMax');
        put(c, 'temp', Math.round(raw));
        put(c, 'tsh', s.temp >= numParam(c, 'tshC'));
        break;
      }
      case 'bin': {
        const cap = numParam(c, 'capacity');
        put(c, 'full', cap > 0 && S<BinCompState>(c).count >= cap);
        break;
      }
      case 'pushbutton':
      case 'selector':
      case 'estop':
      case 'potentiometer': {
        // Operator devices only write when they change (or on a publish step), so the
        // I/O panel and the watch table can still drive the same tag.
        const s = S<OperatorCompState>(c);
        if (dtMs > 0 && s.value === s.written) break;
        s.written = s.value;
        let v: boolean | number;
        if (c.kind === 'pushbutton') v = boolParam(c, 'nc') ? !s.value : !!s.value;
        else if (c.kind === 'estop') v = !s.value;
        else if (c.kind === 'selector') v = !!s.value;
        else {
          const min = numParam(c, 'min');
          v = min + Number(s.value) * (numParam(c, 'max') - min);
        }
        put(c, 'out', v);
        break;
      }
    }
  }
}

/**
 * Operator / plant actions. `name` is `<componentId>:<action>`, or a global
 * action (`clearParts`).
 */
export function plantAction(design: PlantDesign, st: PlantState, name: string, value: unknown): void {
  if (name === 'clearParts') {
    st.parts = [];
    st.lost = 0;
    for (const c of design.components) if (c.kind === 'bin') st.comps[c.id] = initComponentState(c);
    return;
  }
  const sep = name.indexOf(':');
  const c = design.components.find((x) => x.id === name.slice(0, sep));
  if (!c) return;
  const act = name.slice(sep + 1);
  const s = (st.comps[c.id] ??= initComponentState(c));
  switch (c.kind) {
    case 'feeder': {
      const f = s as FeederCompState;
      if (act === 'drop') dropPart(c, st, value === 'tall' || value === 'short' ? value : undefined);
      if (act === 'toggleAuto') f.auto = !f.auto;
      break;
    }
    case 'bin':
      if (act === 'empty') Object.assign(s, initComponentState(c));
      break;
    case 'motor': {
      const m = s as MotorCompState;
      if (act === 'toggleLoad') m.heavy = !m.heavy;
      if (act === 'resetRelay' && m.temperature < 0.6) m.tripped = false;
      if (act === 'resetFault') {
        m.short = false;
        m.hardStarts = 0;
      }
      break;
    }
    case 'tank':
      if (act === 'resetFault') (s as TankCompState).overflows = 0;
      break;
    case 'oven':
      if (act === 'resetFault') (s as OvenCompState).overheats = 0;
      break;
    case 'valve':
      if (act === 'set') (s as ValveCompState).manual = clamp01(Number(value));
      break;
    case 'pushbutton':
      if (act === 'press') (s as OperatorCompState).value = true;
      if (act === 'release') (s as OperatorCompState).value = false;
      break;
    case 'selector':
    case 'estop':
      if (act === 'toggle') (s as OperatorCompState).value = !(s as OperatorCompState).value;
      break;
    case 'potentiometer':
      if (act === 'set') (s as OperatorCompState).value = clamp01(Number(value));
      break;
  }
}

/** Plant runner with the same shape the simulation worker uses for fixed scenarios. */
export interface PlantRunner<S> {
  init(): S;
  step(state: S, dtMs: number, io: PlantIo): void;
  action?(state: S, name: string, value: unknown, io: PlantIo): void;
}

export function plantRunner(design: PlantDesign): PlantRunner<PlantState> {
  return {
    init: () => initPlantState(design),
    step: (s, dt, io) => stepPlant(design, s, dt, io),
    action: (s, name, value) => plantAction(design, s, name, value),
  };
}
