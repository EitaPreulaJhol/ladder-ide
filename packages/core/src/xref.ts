/**
 * Cross reference (where each tag is read / written) and the "why does this
 * tag have this value?" explanation built from a simulation snapshot.
 */
import type { Element, InstructionId, LadderNode, Project, Rung, Series, Value } from './model.ts';
import { INSTRUCTIONS } from './instructions.ts';
import { parseOperand } from './operand.ts';
import { forEachElement } from './edit.ts';
import type { SimSnapshot } from './sim/engine.ts';

export type Access = 'read' | 'write' | 'readWrite';

export interface XRef {
  tag: string;
  /** Operand text as written (`T1.DN`, `MOTOR`). */
  operand: string;
  programId: string;
  programName: string;
  rungId: string;
  rungIndex: number;
  elementId: string;
  instr: InstructionId;
  operandIndex: number;
  access: Access;
}

function accessOf(instr: InstructionId, operandIndex: number): Access {
  const info = INSTRUCTIONS[instr];
  const spec = info.operands[operandIndex];
  if (!spec) return 'read';
  if (info.category === 'coil' && operandIndex === 0) return 'write';
  if (spec.kind === 'timer' || spec.kind === 'counter') return 'readWrite';
  if (spec.kind === 'timerOrCounter' || spec.kind === 'numberDest' || spec.kind === 'bitDest') return 'write';
  return 'read';
}

export const writes = (r: XRef) => r.access !== 'read';
export const reads = (r: XRef) => r.access !== 'write';

/** References per tag name, in program / rung order. */
export function crossReference(project: Project): Map<string, XRef[]> {
  const out = new Map<string, XRef[]>();
  for (const prog of project.programs)
    prog.rungs.forEach((rung, rungIndex) =>
      forEachElement(rung.body, (el) =>
        el.operands.forEach((operand, operandIndex) => {
          const spec = INSTRUCTIONS[el.instr].operands[operandIndex];
          if (!spec || spec.kind === 'label' || spec.kind === 'program') return; // names, not tags
          const p = parseOperand(operand);
          if (p.kind !== 'tag') return;
          const ref: XRef = {
            tag: p.name,
            operand: operand.trim(),
            programId: prog.id,
            programName: prog.name,
            rungId: rung.id,
            rungIndex,
            elementId: el.id,
            instr: el.instr,
            operandIndex,
            // A member access (T1.DN) on a timer/counter is always a read.
            access: p.member
              ? accessOf(el.instr, operandIndex) === 'read'
                ? 'read'
                : 'write'
              : accessOf(el.instr, operandIndex),
          };
          const list = out.get(p.name);
          if (list) list.push(ref);
          else out.set(p.name, [ref]);
        }),
      ),
    );
  return out;
}

// ------------------------------------------------------------------ explanation

/** Reads an operand (tag, member or literal) from snapshot values. */
export function readOperandValue(
  values: Record<string, Value>,
  operand: string | undefined,
): number | boolean | undefined {
  const p = parseOperand(operand);
  if (p.kind === 'literal') return p.value;
  if (p.kind !== 'tag') return undefined;
  const v = values[p.name];
  if (v === undefined) return undefined;
  if (p.bit !== undefined) return typeof v === 'number' ? ((Math.trunc(v) >>> p.bit) & 1) === 1 : undefined;
  if (typeof v !== 'object') return p.member ? undefined : v;
  if (!p.member) return undefined;
  const m: Record<string, number | boolean | undefined> = {
    DN: v.dn,
    ACC: v.acc,
    PRE: v.pre,
    EN: 'en' in v ? v.en : undefined,
    TT: 'tt' in v ? v.tt : undefined,
    CU: 'cu' in v ? v.cu : undefined,
    CD: 'cd' in v ? v.cd : undefined,
    QD: 'qd' in v ? v.qd : undefined,
  };
  return m[p.member];
}

export interface ExplainStep {
  elementId: string;
  instr: InstructionId | 'PAR';
  operand: string;
  /** Live value of the operand (contacts / compares), when known. */
  value?: number | boolean;
  /** true = lets power through, false = blocks it, null = not evaluated (no power reached it). */
  ok: boolean | null;
  /** Branch nesting level (0 = main line of the rung). */
  depth: number;
}

export interface WriterPath {
  ref: XRef;
  /** The instruction received power in the last scan. */
  powered: boolean;
  /** Conditions between the left rail and the instruction, in order. */
  steps: ExplainStep[];
  /** First step of the main line that blocks the power (if any). */
  blockedBy?: string;
}

export interface Explanation {
  tag: string;
  value: Value | undefined;
  /** forced: forced by the user · input: comes from the field / panel · program: written in the last scan ·
   *  held: written by the program before, kept since (SET/RESET, retentive) · none: nothing writes it. */
  source: 'forced' | 'input' | 'program' | 'held' | 'none';
  lastWriter?: XRef;
  paths: WriterPath[];
  /** More than one COIL/NCOIL writes the tag: only the last one counts. */
  duplicateCoils: boolean;
}

function containsId(node: LadderNode, id: string): boolean {
  if (node.id === id) return true;
  return node.kind === 'par' && node.branches.some((b) => b.some((n) => containsId(n, id)));
}

function elementCondition(
  el: Element,
  trace: SimSnapshot['trace'],
  values: Record<string, Value>,
): Pick<ExplainStep, 'ok' | 'value'> {
  const info = INSTRUCTIONS[el.instr];
  const value = readOperandValue(values, el.operands[0]);
  const bit = value === undefined ? undefined : typeof value === 'boolean' ? value : value !== 0;
  if ((el.instr === 'NO' || el.instr === 'NC') && bit !== undefined)
    return { ok: el.instr === 'NO' ? bit : !bit, value };
  const t = trace[el.id];
  if (!t || !t[0]) return { ok: null, value: info.category === 'contact' ? value : undefined };
  return { ok: t[1], value: info.category === 'contact' ? value : undefined };
}

/** Conditions on the way from the left rail to `targetId`. */
function pathTo(
  rung: Rung,
  targetId: string,
  trace: SimSnapshot['trace'],
  values: Record<string, Value>,
): ExplainStep[] {
  const steps: ExplainStep[] = [];
  const addNode = (node: LadderNode, depth: number) => {
    if (node.kind === 'el') {
      steps.push({
        elementId: node.id,
        instr: node.instr,
        operand: node.operands[0] ?? '',
        depth,
        ...elementCondition(node, trace, values),
      });
      return;
    }
    const t = trace[node.id];
    steps.push({ elementId: node.id, instr: 'PAR', operand: '', depth, ok: t && t[0] ? t[1] : null });
    for (const b of node.branches) for (const n of b) addNode(n, depth + 1);
  };
  const walk = (series: Series, depth: number): boolean => {
    for (const node of series) {
      if (node.id === targetId) return true;
      if (node.kind === 'par' && containsId(node, targetId)) {
        const branch = node.branches.find((b) => b.some((n) => containsId(n, targetId)))!;
        return walk(branch, depth + 1);
      }
      addNode(node, depth);
    }
    return false;
  };
  walk(rung.body, 0);
  return steps;
}

export function explainTag(project: Project, snapshot: SimSnapshot, tag: string): Explanation {
  const refs = crossReference(project).get(tag) ?? [];
  const writerRefs = refs.filter(writes);
  const lastId = snapshot.writers?.[tag];
  const lastWriter = writerRefs.find((r) => r.elementId === lastId);
  const tagDef = project.tags.find((t) => t.name === tag);

  let source: Explanation['source'];
  if (tag in snapshot.forces) source = 'forced';
  else if (lastWriter) source = 'program';
  else if (writerRefs.length) source = 'held';
  // Nothing in the program writes it: field input, I/O panel / HMI write or initial value.
  else if (tagDef && tagDef.type !== 'TIMER' && tagDef.type !== 'COUNTER') source = 'input';
  else source = 'none';

  const rungs = new Map(project.programs.flatMap((p) => p.rungs.map((r) => [r.id, r] as const)));
  const ordered = lastWriter ? [lastWriter, ...writerRefs.filter((r) => r !== lastWriter)] : writerRefs;
  const paths: WriterPath[] = ordered.map((ref) => {
    const rung = rungs.get(ref.rungId)!;
    const steps = pathTo(rung, ref.elementId, snapshot.trace, snapshot.values);
    const blocked = steps.find((s) => s.depth === 0 && s.ok === false);
    return {
      ref,
      powered: snapshot.trace[ref.elementId]?.[0] ?? false,
      steps,
      blockedBy: blocked?.elementId,
    };
  });

  const coils = writerRefs.filter((r) => r.instr === 'COIL' || r.instr === 'NCOIL');
  return { tag, value: snapshot.values[tag], source, lastWriter, paths, duplicateCoils: coils.length > 1 };
}
