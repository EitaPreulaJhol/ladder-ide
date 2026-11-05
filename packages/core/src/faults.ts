/**
 * Field faults for troubleshooting practice. Faults live in the field (sensors,
 * wiring, contactors), never in the program:
 *  - input faults change what the PLC reads (the monitor shows the faulty value,
 *    as on a real PLC);
 *  - output faults change what the field does while the PLC output looks right
 *    (Q=1 but the contactor never pulls in, or a welded contactor stays on).
 */
import type { Project, Tag } from './model.ts';
import { isInputTag, isOutputTag } from './hardware.ts';
import { crossReference } from './xref.ts';
import type { Simulator } from './sim/engine.ts';

/** stuckOn: sensor stuck at 1 / welded contactor · stuckOff: broken wire, dead sensor, burnt output · frozen: analog value stuck. */
export type FaultKind = 'stuckOn' | 'stuckOff' | 'frozen';

export interface FieldFault {
  signal: string;
  kind: FaultKind;
  direction: 'input' | 'output';
  value: boolean | number;
}

export interface FaultCandidate {
  signal: string;
  direction: 'input' | 'output';
  analog: boolean;
}

const isAnalogTag = (t: Tag) => t.type === 'INT' || t.type === 'DINT' || t.type === 'REAL';

/** I/O tags that can receive a field fault. */
export function faultCandidates(project: Project): FaultCandidate[] {
  const out: FaultCandidate[] = [];
  for (const t of project.tags) {
    if (t.type === 'TIMER' || t.type === 'COUNTER') continue;
    if (isInputTag(t, project.hardware))
      out.push({ signal: t.name, direction: 'input', analog: isAnalogTag(t) });
    else if (isOutputTag(t, project.hardware))
      out.push({ signal: t.name, direction: 'output', analog: isAnalogTag(t) });
  }
  return out;
}

export function kindsFor(c: Pick<FaultCandidate, 'analog'>): FaultKind[] {
  return c.analog ? ['stuckOff', 'frozen'] : ['stuckOn', 'stuckOff'];
}

export type GuessResult = 'correct' | 'wrongSignal' | 'wrongKind' | 'noChallenge';

export class FieldFaults {
  private faults = new Map<string, FieldFault>();
  private hiddenSignal: string | null = null;
  attempts = 0;

  /** Faults the user injected (the challenge fault stays hidden). */
  visible(): FieldFault[] {
    return [...this.faults.values()].filter((f) => f.signal !== this.hiddenSignal);
  }

  get challengeActive(): boolean {
    return this.hiddenSignal !== null;
  }

  /** Field value of an output as the plant / panel sees it (undefined = normal). */
  outputOverride(signal: string): boolean | number | undefined {
    const f = this.faults.get(signal);
    return f?.direction === 'output' ? f.value : undefined;
  }

  /** Every output override (for the UI: panel lamps show the field, not the PLC). */
  outputOverrides(): Record<string, boolean | number> {
    const out: Record<string, boolean | number> = {};
    for (const f of this.faults.values()) if (f.direction === 'output') out[f.signal] = f.value;
    return out;
  }

  add(project: Project, sim: Simulator, signal: string, kind: FaultKind): FieldFault | null {
    const c = faultCandidates(project).find((x) => x.signal === signal);
    if (!c || !kindsFor(c).includes(kind)) return null;
    const current = sim.getValue(signal);
    const value =
      kind === 'stuckOn'
        ? true
        : kind === 'stuckOff'
          ? c.analog
            ? 0
            : false
          : typeof current === 'number'
            ? current
            : 0;
    const fault: FieldFault = { signal, kind, direction: c.direction, value };
    this.remove(sim, signal);
    this.faults.set(signal, fault);
    if (c.direction === 'input') sim.setInputFault(signal, value);
    return fault;
  }

  remove(sim: Simulator, signal: string): void {
    const f = this.faults.get(signal);
    if (!f) return;
    this.faults.delete(signal);
    if (f.direction === 'input') sim.setInputFault(signal, undefined);
    if (signal === this.hiddenSignal) this.hiddenSignal = null;
  }

  clear(sim: Simulator): void {
    for (const s of [...this.faults.keys()]) this.remove(sim, s);
    this.attempts = 0;
  }

  /** Re-applies input faults after the simulator was rebuilt / reloaded; drops faults of removed tags. */
  reapply(project: Project, sim: Simulator): void {
    const valid = new Set(faultCandidates(project).map((c) => c.signal));
    for (const f of [...this.faults.values()]) {
      if (!valid.has(f.signal)) this.remove(sim, f.signal);
      else if (f.direction === 'input') sim.setInputFault(f.signal, f.value);
    }
  }

  /**
   * Hides a random digital fault on a signal the program actually uses.
   * Returns false when the project has no suitable signal.
   */
  startChallenge(project: Project, sim: Simulator, rand: () => number = Math.random): boolean {
    if (this.hiddenSignal) this.remove(sim, this.hiddenSignal);
    const xref = crossReference(project);
    const pool = faultCandidates(project).filter(
      (c) =>
        !c.analog &&
        !this.faults.has(c.signal) &&
        (xref.get(c.signal) ?? []).some((r) =>
          c.direction === 'input' ? r.access !== 'write' : r.access !== 'read',
        ),
    );
    if (!pool.length) return false;
    const c = pool[Math.floor(rand() * pool.length)]!;
    const kinds = kindsFor(c);
    const kind = kinds[Math.floor(rand() * kinds.length)]!;
    this.add(project, sim, c.signal, kind);
    this.hiddenSignal = c.signal;
    this.attempts = 0;
    return true;
  }

  guess(sim: Simulator, signal: string, kind: FaultKind): GuessResult {
    if (!this.hiddenSignal) return 'noChallenge';
    this.attempts++;
    const f = this.faults.get(this.hiddenSignal)!;
    if (signal !== f.signal) return 'wrongSignal';
    if (kind !== f.kind) return 'wrongKind';
    this.remove(sim, f.signal);
    return 'correct';
  }

  /** Gives up: removes the hidden fault and tells which one it was. */
  reveal(sim: Simulator): FieldFault | null {
    if (!this.hiddenSignal) return null;
    const f = this.faults.get(this.hiddenSignal)!;
    this.remove(sim, f.signal);
    return f;
  }
}
