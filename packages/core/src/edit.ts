/**
 * Structural edits on a rung's series/parallel tree. Functions mutate the rung
 * in place (the web store calls them inside immer `produce`) and keep the tree
 * normalized: no single-branch parallels, no parallels made only of shorts.
 */
import type { Element, InstructionId, LadderNode, Parallel, Project, Rung, Series } from './model.ts';
import { parseOperand } from './operand.ts';
import { defaultOperands } from './instructions.ts';
import { newId } from './ids.ts';

/** An insertion point: position `index` in branch `branch` of `container` (rung id or parallel id). */
export interface SlotRef {
  container: string;
  branch: number;
  index: number;
}

export interface NodeLocation {
  series: Series;
  index: number;
  container: string;
  branch: number;
}

export function createElement(instr: InstructionId, operands?: string[]): Element {
  return { kind: 'el', id: newId('e_'), instr, operands: operands ?? defaultOperands(instr) };
}

export function findSeries(rung: Rung, container: string, branch: number): Series | null {
  if (container === rung.id) return branch === 0 ? rung.body : null;
  const par = findNode(rung, container);
  if (!par || par.kind !== 'par') return null;
  return par.branches[branch] ?? null;
}

export function locate(rung: Rung, nodeId: string): NodeLocation | null {
  const walk = (series: Series, container: string, branch: number): NodeLocation | null => {
    for (let i = 0; i < series.length; i++) {
      const n = series[i]!;
      if (n.id === nodeId) return { series, index: i, container, branch };
      if (n.kind === 'par') {
        for (let b = 0; b < n.branches.length; b++) {
          const r = walk(n.branches[b]!, n.id, b);
          if (r) return r;
        }
      }
    }
    return null;
  };
  return walk(rung.body, rung.id, 0);
}

export function findNode(rung: Rung, nodeId: string): LadderNode | null {
  const loc = locate(rung, nodeId);
  return loc ? loc.series[loc.index]! : null;
}

function containsId(node: LadderNode, id: string): boolean {
  if (node.id === id) return true;
  return node.kind === 'par' && node.branches.some((b) => b.some((n) => containsId(n, id)));
}

export function forEachElement(series: Series, fn: (el: Element) => void): void {
  for (const n of series) {
    if (n.kind === 'el') fn(n);
    else n.branches.forEach((b) => forEachElement(b, fn));
  }
}

/** Removes degenerate structures created by deletions/moves. */
export function normalize(series: Series): void {
  for (let i = 0; i < series.length; i++) {
    const n = series[i]!;
    if (n.kind !== 'par') continue;
    n.branches.forEach(normalize);
    // a || (b || c)  ->  a || b || c
    const flat: Series[] = [];
    for (const b of n.branches) {
      if (b.length === 1 && b[0]!.kind === 'par') flat.push(...b[0]!.branches);
      else flat.push(b);
    }
    n.branches = flat;
    const nonEmpty = n.branches.filter((b) => b.length > 0);
    if (nonEmpty.length === 0) {
      series.splice(i, 1);
      i--;
    } else if (n.branches.length === 1) {
      series.splice(i, 1, ...n.branches[0]!);
      i--;
    }
  }
}

export function insertNode(rung: Rung, slot: SlotRef, node: LadderNode): boolean {
  const series = findSeries(rung, slot.container, slot.branch);
  if (!series) return false;
  series.splice(Math.max(0, Math.min(slot.index, series.length)), 0, node);
  return true;
}

export function removeNode(rung: Rung, nodeId: string): LadderNode | null {
  const loc = locate(rung, nodeId);
  if (!loc) return null;
  const [removed] = loc.series.splice(loc.index, 1);
  // A branch emptied by a deletion would silently become a short circuit: drop the branch too.
  if (loc.series.length === 0 && loc.container !== rung.id) {
    const par = findNode(rung, loc.container);
    if (par?.kind === 'par') par.branches.splice(loc.branch, 1);
  }
  normalize(rung.body);
  return removed ?? null;
}

/** Moves a node to a slot (drag and drop). The slot is interpreted before the removal. */
export function moveNode(rung: Rung, nodeId: string, slot: SlotRef): boolean {
  const loc = locate(rung, nodeId);
  if (!loc) return false;
  const node = loc.series[loc.index]!;
  if (containsId(node, slot.container)) return false; // cannot move a branch into itself
  const target = findSeries(rung, slot.container, slot.branch);
  if (!target) return false;
  let index = slot.index;
  if (target === loc.series && index > loc.index) index--;
  loc.series.splice(loc.index, 1);
  target.splice(Math.max(0, Math.min(index, target.length)), 0, node);
  normalize(rung.body);
  return true;
}

/** Wraps nodes [from, to] of a series into a new parallel with an empty (short) branch below. */
export function wrapInBranch(rung: Rung, nodeId: string, toNodeId?: string): Parallel | null {
  const a = locate(rung, nodeId);
  if (!a) return null;
  let from = a.index;
  let to = a.index;
  if (toNodeId) {
    const b = locate(rung, toNodeId);
    if (!b || b.series !== a.series) return null;
    from = Math.min(a.index, b.index);
    to = Math.max(a.index, b.index);
  }
  const nodes = a.series.slice(from, to + 1);
  const par: Parallel = { kind: 'par', id: newId('p_'), branches: [nodes, []] };
  a.series.splice(from, to - from + 1, par);
  return par;
}

export function addBranch(rung: Rung, parallelId: string): number {
  const par = findNode(rung, parallelId);
  if (!par || par.kind !== 'par') return -1;
  par.branches.push([]);
  return par.branches.length - 1;
}

export function removeBranch(rung: Rung, parallelId: string, branch: number): void {
  const par = findNode(rung, parallelId);
  if (!par || par.kind !== 'par') return;
  par.branches.splice(branch, 1);
  normalize(rung.body);
}

export function cloneNode<T extends LadderNode>(node: T): T {
  if (node.kind === 'el') return { ...node, id: newId('e_'), operands: [...node.operands] } as T;
  return { ...node, id: newId('p_'), branches: node.branches.map((b) => b.map(cloneNode)) } as T;
}

export function cloneRung(rung: Rung): Rung {
  return { ...rung, id: newId('r_'), body: rung.body.map(cloneNode) };
}

export function newRung(body: Series = []): Rung {
  return { id: newId('r_'), body };
}

// ------------------------------------------------------------------ project-level tag helpers

function renameOperand(text: string, from: string, to: string): string {
  const p = parseOperand(text);
  if (p.kind !== 'tag' || p.name !== from) return text;
  const s = text.trim();
  const dot = s.indexOf('.');
  return dot < 0 ? to : to + s.slice(dot);
}

/** Renames a tag and every reference to it (operands, I/O panel). Mutates the project. */
export function renameTag(project: Project, from: string, to: string): void {
  const tag = project.tags.find((t) => t.name === from);
  if (!tag) return;
  tag.name = to;
  for (const prog of project.programs)
    for (const r of prog.rungs)
      forEachElement(r.body, (el) => (el.operands = el.operands.map((o) => renameOperand(o, from, to))));
  for (const w of project.ioPanel) if (w.tag === from) w.tag = to;
}

/** Number of program references per tag name. */
export function tagUsage(project: Project): Map<string, number> {
  const m = new Map<string, number>();
  for (const prog of project.programs)
    for (const r of prog.rungs)
      forEachElement(r.body, (el) =>
        el.operands.forEach((o) => {
          const p = parseOperand(o);
          if (p.kind === 'tag') m.set(p.name, (m.get(p.name) ?? 0) + 1);
        }),
      );
  return m;
}
