/**
 * Scan-cycle interpreter.
 *
 * Each scan: (1) copy the input image into memory and apply forces,
 * (2) evaluate every rung of every program in order, left to right, top to
 * bottom, (3) the resulting memory is the output image. Time is simulated:
 * every scan advances the clock by `dtMs`, which makes timers deterministic and
 * lets the UI run faster or slower than real time.
 */
import type {
  CounterValue,
  Element,
  LadderNode,
  Program,
  Project,
  Series,
  Tag,
  TimerValue,
  Value,
} from '../model.ts';
import { parseOperand, type Member, type ParsedOperand } from '../operand.ts';
import { INSTRUCTIONS } from '../instructions.ts';
import { isInputTag } from '../hardware.ts';
import { forEachElement } from '../edit.ts';

/** Max rungs evaluated in one scan before the watchdog trips (catches endless JMP loops). */
const WATCHDOG_RUNGS = 100_000;
const WATCHDOG = Symbol('watchdog');
const MAX_CALL_DEPTH = 8;

/** Power flow per node id: [powerIn, powerOut]. */
export type Trace = Record<string, [boolean, boolean]>;

export interface SimSnapshot {
  timeMs: number;
  scanCount: number;
  values: Record<string, Value>;
  trace: Trace;
  forces: Record<string, boolean | number>;
  faults: string[];
  /** Last instruction (element id) that wrote each tag during the last scan. */
  writers: Record<string, string>;
}

export function newTimer(): TimerValue {
  return { pre: 0, acc: 0, en: false, tt: false, dn: false };
}

export function newCounter(): CounterValue {
  return { pre: 0, acc: 0, cu: false, cd: false, dn: false, qd: true };
}

export function initialValue(tag: Tag): Value {
  switch (tag.type) {
    case 'BOOL':
      return Boolean(tag.initial ?? false);
    case 'TIMER':
      return newTimer();
    case 'COUNTER':
      return newCounter();
    default:
      return coerceNumber(tag.type, Number(tag.initial ?? 0));
  }
}

function coerceNumber(type: Tag['type'], v: number): number {
  if (!Number.isFinite(v)) v = 0;
  switch (type) {
    case 'INT':
      return ((Math.trunc(v) + 32768) & 0xffff) - 32768;
    case 'DINT':
      return Math.trunc(v) | 0;
    case 'BOOL':
      return v ? 1 : 0;
    default:
      return v;
  }
}

const isTimer = (v: Value | undefined): v is TimerValue => typeof v === 'object' && v !== null && 'tt' in v;
const isCounter = (v: Value | undefined): v is CounterValue =>
  typeof v === 'object' && v !== null && 'cu' in v;

/** Tags written by some instruction of the program (coils, boxes...). */
export function writtenTags(project: Project): Set<string> {
  const out = new Set<string>();
  const visit = (s: Series) => {
    for (const n of s) {
      if (n.kind === 'par') n.branches.forEach(visit);
      else {
        const info = INSTRUCTIONS[n.instr];
        info.operands.forEach((spec, i) => {
          const p = parseOperand(n.operands[i]);
          if (p.kind !== 'tag') return;
          if (spec.kind === 'label' || spec.kind === 'program') return;
          if (
            (info.category === 'coil' && spec.kind === 'bit' && i === 0) ||
            spec.kind === 'bitDest' ||
            spec.kind === 'numberDest' ||
            spec.kind === 'timer' ||
            spec.kind === 'counter' ||
            spec.kind === 'timerOrCounter'
          )
            out.add(p.name);
        });
      }
    }
  };
  for (const prog of project.programs) for (const r of prog.rungs) visit(r.body);
  return out;
}

export class Simulator {
  private project!: Project;
  private tags = new Map<string, Tag>();
  private compiled = new Map<string, ParsedOperand[]>();
  /** Tags whose value comes from the input image (refreshed at the start of every scan). */
  private inputTags = new Set<string>();
  private values = new Map<string, Value>();
  private inputImage = new Map<string, boolean | number>();
  /** Field faults on inputs (stuck sensor, broken wire): override the input image, invisible as forces. */
  private inputFaults = new Map<string, boolean | number>();
  private forces = new Map<string, boolean | number>();
  private edgeMem = new Map<string, boolean>();
  private trace: Trace = {};
  private faults = new Set<string>();
  private writers: Record<string, string> = {};
  /** Label -> rung index, per program id (JMP/LBL). */
  private labels = new Map<string, Map<string, number>>();
  private programsByName = new Map<string, Program>();
  private jumpTo: string | null = null;
  private callDepth = 0;
  private rungBudget = 0;
  private pidState = new Map<string, { integral: number; prevPv: number | null }>();
  private currentEl = '';
  private dt = 0;
  timeMs = 0;
  scanCount = 0;

  constructor(project: Project) {
    this.load(project);
  }

  /** Loads (or hot-reloads) a project, keeping the memory of tags whose type did not change. */
  load(project: Project): void {
    this.project = project;
    const old = this.tags;
    this.tags = new Map(project.tags.map((t) => [t.name, t]));
    for (const [name] of this.values) {
      const t = this.tags.get(name);
      if (!t || old.get(name)?.type !== t.type) this.values.delete(name);
    }
    for (const t of project.tags) if (!this.values.has(t.name)) this.values.set(t.name, initialValue(t));
    for (const name of [...this.forces.keys()]) if (!this.tags.has(name)) this.forces.delete(name);

    this.compiled.clear();
    const visit = (s: Series) => {
      for (const n of s) {
        if (n.kind === 'par') n.branches.forEach(visit);
        else this.compiled.set(n.id, n.operands.map(parseOperand));
      }
    };
    for (const prog of project.programs) for (const r of prog.rungs) visit(r.body);

    this.programsByName = new Map(project.programs.map((p) => [p.name, p]));
    this.labels.clear();
    for (const prog of project.programs) {
      const map = new Map<string, number>();
      prog.rungs.forEach((r, i) =>
        forEachElement(r.body, (el) => {
          const name = el.operands[0]?.trim();
          if (el.instr === 'LBL' && name && !map.has(name)) map.set(name, i);
        }),
      );
      this.labels.set(prog.id, map);
    }

    const written = writtenTags(project);
    this.inputTags = new Set(
      project.tags
        .filter(
          (t) =>
            isInputTag(t, project.hardware) ||
            (!t.address && !t.io && !written.has(t.name) && t.type !== 'TIMER' && t.type !== 'COUNTER'),
        )
        .map((t) => t.name),
    );
    for (const name of [...this.inputImage.keys()])
      if (!this.inputTags.has(name)) this.inputImage.delete(name);
  }

  /** Cold restart: every tag goes back to its initial value. Forces are kept. */
  reset(): void {
    this.values.clear();
    for (const t of this.project.tags) this.values.set(t.name, initialValue(t));
    this.edgeMem.clear();
    this.pidState.clear();
    this.trace = {};
    this.faults.clear();
    this.timeMs = 0;
    this.scanCount = 0;
    this.applyInputs();
  }

  /** Input image (with field faults) into memory, then forces. Priority: force > fault > field. */
  private applyInputs(): void {
    for (const [name, v] of this.inputImage)
      if (!this.forces.has(name) && !this.inputFaults.has(name)) this.values.set(name, this.coerce(name, v));
    for (const [name, v] of this.inputFaults)
      if (!this.forces.has(name) && this.inputTags.has(name)) this.values.set(name, this.coerce(name, v));
    for (const [name, v] of this.forces) this.values.set(name, this.coerce(name, v));
  }

  /** Simulates a field fault on an input tag (undefined clears it). */
  setInputFault(name: string, value: boolean | number | undefined): void {
    if (value === undefined) this.inputFaults.delete(name);
    else if (this.inputTags.has(name)) this.inputFaults.set(name, value);
  }

  isInputTag(name: string): boolean {
    return this.inputTags.has(name);
  }

  /**
   * Writes a value coming from outside the program (I/O panel, virtual plant, HMI).
   * Input tags go through the input image; other tags are written directly, like an HMI write.
   */
  setInput(name: string, value: boolean | number): void {
    if (!this.tags.has(name)) return;
    if (this.inputTags.has(name)) this.inputImage.set(name, value);
    else if (!this.forces.has(name)) this.values.set(name, this.coerce(name, value));
  }

  setForce(name: string, value: boolean | number | undefined): void {
    if (value === undefined) this.forces.delete(name);
    else if (this.tags.has(name)) {
      this.forces.set(name, value);
      this.values.set(name, this.coerce(name, value));
    }
  }

  /** Copies the input image into memory without running the program (keeps the display live in STOP). */
  refreshInputs(): void {
    this.applyInputs();
  }

  getValue(name: string): Value | undefined {
    return this.values.get(name);
  }

  private signalCache = new Map<string, ParsedOperand>();

  /** Reads a signal: a tag (`MOTOR`), a member (`T1.DN`, `C1.ACC`) or a literal. Undefined for unknown tags. */
  readSignal(signal: string): number | boolean | undefined {
    let op = this.signalCache.get(signal);
    if (!op) {
      op = parseOperand(signal);
      this.signalCache.set(signal, op);
    }
    if (op.kind === 'tag') {
      const v = this.values.get(op.name);
      if (v === undefined || (typeof v === 'object' && !op.member)) return undefined;
    }
    return op.kind === 'invalid' || op.kind === 'empty' ? undefined : this.read(op);
  }

  scan(dtMs: number): void {
    this.dt = dtMs;
    this.timeMs += dtMs;
    this.scanCount++;
    this.faults.clear();
    this.trace = {};
    this.writers = {};

    this.applyInputs();

    this.rungBudget = WATCHDOG_RUNGS;
    this.callDepth = 0;
    try {
      for (const prog of this.project.programs) if ((prog.kind ?? 'main') === 'main') this.runProgram(prog);
    } catch (e) {
      if (e !== WATCHDOG) throw e;
      // Endless jump loop: a real PLC trips its watchdog and stops the scan.
      this.faults.add('scan:watchdog');
    }
  }

  snapshot(): SimSnapshot {
    const values: Record<string, Value> = {};
    for (const [k, v] of this.values) values[k] = typeof v === 'object' ? { ...v } : v;
    return {
      timeMs: this.timeMs,
      scanCount: this.scanCount,
      values,
      trace: this.trace,
      forces: Object.fromEntries(this.forces),
      faults: [...this.faults],
      writers: { ...this.writers },
    };
  }

  // ------------------------------------------------------------ evaluation

  /** Runs the rungs of a program, following JMP/LBL jumps. */
  private runProgram(prog: Program): void {
    const outerJump = this.jumpTo;
    const labels = this.labels.get(prog.id);
    let i = 0;
    while (i < prog.rungs.length) {
      if (--this.rungBudget < 0) throw WATCHDOG;
      this.jumpTo = null;
      this.evalSeries(prog.rungs[i]!.body, true);
      if (this.jumpTo !== null) {
        const target = labels?.get(this.jumpTo);
        if (target !== undefined) {
          i = target;
          continue;
        }
        this.faults.add(`${prog.id}:missingLabel:${this.jumpTo}`);
      }
      i++;
    }
    this.jumpTo = outerJump;
  }

  private evalSeries(series: Series, power: boolean): boolean {
    for (const node of series) power = this.evalNode(node, power);
    return power;
  }

  private evalNode(node: LadderNode, powerIn: boolean): boolean {
    let out: boolean;
    if (node.kind === 'par') {
      out = false;
      // Every branch is evaluated (outputs on branches must run even if an upper branch is true).
      for (const b of node.branches) if (this.evalSeries(b, powerIn)) out = true;
    } else {
      out = this.exec(node, powerIn);
    }
    this.trace[node.id] = [powerIn, out];
    return out;
  }

  private exec(el: Element, pin: boolean): boolean {
    const ops = this.compiled.get(el.id) ?? [];
    const a = ops[0] ?? { kind: 'empty' };
    this.currentEl = el.id;
    switch (el.instr) {
      case 'NO':
        return pin && this.readBool(a);
      case 'NC':
        return pin && !this.readBool(a);
      case 'POS':
      case 'NEG': {
        const cur = this.readBool(a);
        const prev = this.edgeMem.get(el.id) ?? cur;
        this.edgeMem.set(el.id, cur);
        const edge = el.instr === 'POS' ? cur && !prev : !cur && prev;
        return pin && edge;
      }
      case 'COIL':
        this.writeBool(a, pin);
        return pin;
      case 'NCOIL':
        this.writeBool(a, !pin);
        return pin;
      case 'SET':
        if (pin) this.writeBool(a, true);
        return pin;
      case 'RESET':
        if (pin) this.writeBool(a, false);
        return pin;
      case 'TON':
      case 'TOF':
      case 'TP':
      case 'RTO':
        return this.execTimer(el, a, ops[1], pin);
      case 'CTU':
      case 'CTD':
      case 'CTUD':
        return this.execCounter(el, a, ops[1], ops[2], pin);
      case 'RES': {
        if (!pin || a.kind !== 'tag') return pin;
        const v = this.values.get(a.name);
        if (isTimer(v) || isCounter(v)) this.writers[a.name] = el.id;
        if (isTimer(v)) Object.assign(v, { acc: 0, en: false, tt: false, dn: false });
        else if (isCounter(v)) Object.assign(v, { acc: 0, dn: false, qd: true });
        return pin;
      }
      case 'EQ':
      case 'NE':
      case 'GT':
      case 'GE':
      case 'LT':
      case 'LE': {
        if (!pin) return false;
        const x = this.readNum(a);
        const y = this.readNum(ops[1]);
        switch (el.instr) {
          case 'EQ':
            return x === y;
          case 'NE':
            return x !== y;
          case 'GT':
            return x > y;
          case 'GE':
            return x >= y;
          case 'LT':
            return x < y;
          default:
            return x <= y;
        }
      }
      case 'MOVE':
        if (pin) this.writeNum(ops[1], this.readNum(a));
        return pin;
      case 'ADD':
      case 'SUB':
      case 'MUL':
      case 'DIV':
      case 'MOD': {
        if (!pin) return false;
        const x = this.readNum(a);
        const y = this.readNum(ops[1]);
        let r: number;
        if ((el.instr === 'DIV' || el.instr === 'MOD') && y === 0) {
          this.faults.add(`${el.id}:divByZero`);
          return false;
        }
        switch (el.instr) {
          case 'ADD':
            r = x + y;
            break;
          case 'SUB':
            r = x - y;
            break;
          case 'MUL':
            r = x * y;
            break;
          case 'DIV':
            r = this.isIntegerDest(ops[2]) ? Math.trunc(x / y) : x / y;
            break;
          default:
            r = x % y;
        }
        this.writeNum(ops[2], r);
        return true;
      }
      case 'SR':
      case 'RS': {
        // SR: set dominant (Q = S or (not R and Q)); RS: reset dominant (Q = not R and (S or Q)).
        const q = this.readBool(a);
        const r = this.readBool(ops[1] ?? { kind: 'empty' });
        const next = el.instr === 'SR' ? pin || (!r && q) : !r && (pin || q);
        this.writeBool(a, next);
        return next;
      }
      case 'LBL':
        return pin;
      case 'JMP':
        if (pin) this.jumpTo = el.operands[0]?.trim() ?? '';
        return pin;
      case 'CALL': {
        if (!pin) return false;
        const sub = this.programsByName.get(el.operands[0]?.trim() ?? '');
        if (!sub) {
          this.faults.add(`${el.id}:missingProgram`);
          return false;
        }
        if (this.callDepth >= MAX_CALL_DEPTH) {
          this.faults.add(`${el.id}:callDepth`);
          return false;
        }
        this.callDepth++;
        try {
          this.runProgram(sub);
        } finally {
          this.callDepth--;
          this.currentEl = el.id;
        }
        return true;
      }
      case 'SCALE': {
        if (!pin) return false;
        const [x, inMin, inMax, outMin, outMax] = [0, 1, 2, 3, 4].map((i) => this.readNum(ops[i]));
        if (inMax === inMin) {
          this.faults.add(`${el.id}:scaleRange`);
          return false;
        }
        const r = ((x! - inMin!) * (outMax! - outMin!)) / (inMax! - inMin!) + outMin!;
        this.writeNum(ops[5], this.isIntegerDest(ops[5]) ? Math.round(r) : r);
        return true;
      }
      case 'PID':
        return this.execPid(el, ops, pin);
    }
  }

  /**
   * Simplified PID (ISA form, derivative on measurement, output 0..100 %, conditional
   * integration as anti-windup). Ti and Td in seconds; Ti = 0 disables the integral.
   * Without power the controller is in manual: the output is not written and the integral resets.
   */
  private execPid(el: Element, ops: ParsedOperand[], pin: boolean): boolean {
    const st = this.pidState.get(el.id) ?? { integral: 0, prevPv: null };
    this.pidState.set(el.id, st);
    if (!pin) {
      st.integral = 0;
      st.prevPv = null;
      return false;
    }
    const pv = this.readNum(ops[0]);
    const sp = this.readNum(ops[1]);
    const kp = this.readNum(ops[3]);
    const ti = this.readNum(ops[4]);
    const td = this.readNum(ops[5]);
    const dt = this.dt / 1000;
    const e = sp - pv;
    const dPv = st.prevPv === null || dt <= 0 ? 0 : (pv - st.prevPv) / dt;
    st.prevPv = pv;
    const p = kp * e;
    const d = -kp * td * dPv;
    const di = ti > 0 ? (kp * e * dt) / ti : 0;
    let cv = p + st.integral + di + d;
    const saturatedHigh = cv > 100;
    const saturatedLow = cv < 0;
    // Only integrate when it does not push further into saturation.
    if (!(saturatedHigh && di > 0) && !(saturatedLow && di < 0)) st.integral += di;
    cv = Math.max(0, Math.min(100, p + st.integral + d));
    this.writeNum(ops[2], cv);
    return true;
  }

  private execTimer(
    el: Element,
    target: ParsedOperand,
    presetOp: ParsedOperand | undefined,
    pin: boolean,
  ): boolean {
    const t = this.timerOf(target);
    if (!t) {
      this.faults.add(`${el.id}:noTimer`);
      return false;
    }
    if (target.kind === 'tag') this.writers[target.name] = el.id;
    t.pre = Math.max(0, this.readNum(presetOp));
    const dt = this.dt;
    switch (el.instr) {
      case 'TON':
        t.en = pin;
        if (pin) {
          t.acc = Math.min(t.acc + dt, t.pre);
          t.dn = t.acc >= t.pre;
          t.tt = !t.dn;
        } else {
          t.acc = 0;
          t.dn = false;
          t.tt = false;
        }
        return t.dn;
      case 'RTO':
        t.en = pin;
        if (pin) t.acc = Math.min(t.acc + dt, t.pre);
        t.dn = t.acc >= t.pre;
        t.tt = pin && !t.dn;
        return t.dn;
      case 'TOF':
        if (pin) {
          t.en = true;
          t.dn = true;
          t.tt = false;
          t.acc = 0;
        } else {
          t.en = false;
          if (t.dn) {
            t.acc = Math.min(t.acc + dt, t.pre);
            if (t.acc >= t.pre) t.dn = false;
          }
          t.tt = t.dn;
        }
        return t.dn;
      default: {
        // TP: fixed-length pulse started on the rising edge of the input. DN/Q is the pulse.
        const rising = pin && !t.en;
        t.en = pin;
        if (rising && !t.tt) {
          t.tt = true;
          t.acc = 0;
        }
        if (t.tt) {
          t.acc = Math.min(t.acc + dt, t.pre);
          if (t.acc >= t.pre) t.tt = false;
        } else if (!pin) {
          t.acc = 0;
        }
        t.dn = t.tt;
        return t.dn;
      }
    }
  }

  private execCounter(
    el: Element,
    target: ParsedOperand,
    presetOp: ParsedOperand | undefined,
    cdOp: ParsedOperand | undefined,
    pin: boolean,
  ): boolean {
    const c = this.counterOf(target);
    if (!c) {
      this.faults.add(`${el.id}:noCounter`);
      return false;
    }
    if (target.kind === 'tag') this.writers[target.name] = el.id;
    c.pre = this.readNum(presetOp);
    const clamp = (n: number) => Math.max(-32768, Math.min(32767, n));
    if (el.instr === 'CTU' || el.instr === 'CTUD') {
      if (pin && !c.cu) c.acc = clamp(c.acc + 1);
      c.cu = pin;
    }
    if (el.instr === 'CTD') {
      if (pin && !c.cd) c.acc = clamp(c.acc - 1);
      c.cd = pin;
    }
    if (el.instr === 'CTUD') {
      const down = this.readBool(cdOp ?? { kind: 'empty' });
      if (down && !c.cd) c.acc = clamp(c.acc - 1);
      c.cd = down;
    }
    c.dn = c.acc >= c.pre;
    c.qd = c.acc <= 0;
    return el.instr === 'CTD' ? c.qd : c.dn;
  }

  // ------------------------------------------------------------ memory access

  private coerce(name: string, v: boolean | number): Value {
    const t = this.tags.get(name);
    if (!t || t.type === 'BOOL') return typeof v === 'boolean' ? v : v !== 0;
    if (t.type === 'TIMER' || t.type === 'COUNTER') return this.values.get(name)!;
    return coerceNumber(t.type, Number(v));
  }

  private timerOf(op: ParsedOperand): TimerValue | null {
    if (op.kind !== 'tag') return null;
    const v = this.values.get(op.name);
    return isTimer(v) ? v : null;
  }

  private counterOf(op: ParsedOperand): CounterValue | null {
    if (op.kind !== 'tag') return null;
    const v = this.values.get(op.name);
    return isCounter(v) ? v : null;
  }

  private readMember(v: Value | undefined, m: Member): number | boolean {
    if (isTimer(v)) {
      const map: Partial<Record<Member, number | boolean>> = {
        DN: v.dn,
        ACC: v.acc,
        PRE: v.pre,
        EN: v.en,
        TT: v.tt,
      };
      return map[m] ?? false;
    }
    if (isCounter(v)) {
      const map: Partial<Record<Member, number | boolean>> = {
        DN: v.dn,
        ACC: v.acc,
        PRE: v.pre,
        CU: v.cu,
        CD: v.cd,
        QD: v.qd,
      };
      return map[m] ?? false;
    }
    return false;
  }

  private read(op: ParsedOperand | undefined): number | boolean {
    if (!op) return 0;
    switch (op.kind) {
      case 'literal':
        return op.value;
      case 'tag': {
        const v = this.values.get(op.name);
        if (op.member) return this.readMember(v, op.member);
        if (typeof v === 'boolean' || typeof v === 'number') return v;
        return 0;
      }
      default:
        return 0;
    }
  }

  private readBool(op: ParsedOperand): boolean {
    const v = this.read(op);
    return typeof v === 'boolean' ? v : v !== 0;
  }

  private readNum(op: ParsedOperand | undefined): number {
    const v = this.read(op);
    return typeof v === 'boolean' ? (v ? 1 : 0) : v;
  }

  private isIntegerDest(op: ParsedOperand | undefined): boolean {
    if (op?.kind !== 'tag') return false;
    const t = this.tags.get(op.name);
    return t?.type === 'INT' || t?.type === 'DINT';
  }

  private writeBool(op: ParsedOperand, value: boolean): void {
    if (op.kind !== 'tag' || op.member || this.forces.has(op.name)) return;
    const t = this.tags.get(op.name);
    if (!t) return;
    this.values.set(op.name, t.type === 'BOOL' ? value : coerceNumber(t.type, value ? 1 : 0));
    this.writers[op.name] = this.currentEl;
  }

  private writeNum(op: ParsedOperand | undefined, value: number): void {
    if (op?.kind !== 'tag' || this.forces.has(op.name)) return;
    const t = this.tags.get(op.name);
    if (!t) return;
    const cur = this.values.get(op.name);
    if (op.member) {
      if ((isTimer(cur) || isCounter(cur)) && (op.member === 'ACC' || op.member === 'PRE')) {
        if (op.member === 'ACC') cur.acc = Math.trunc(value);
        else cur.pre = Math.trunc(value);
        this.writers[op.name] = this.currentEl;
      }
      return;
    }
    if (t.type === 'TIMER' || t.type === 'COUNTER') return;
    this.values.set(op.name, t.type === 'BOOL' ? value !== 0 : coerceNumber(t.type, value));
    this.writers[op.name] = this.currentEl;
  }
}
