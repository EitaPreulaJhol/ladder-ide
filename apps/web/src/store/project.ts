import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import {
  addBranch,
  cloneNode,
  cloneRung,
  createElement,
  defaultTypeForOperand,
  findNode,
  getDialect,
  INSTRUCTIONS,
  insertNode,
  isValidTagName,
  locate,
  moveNode,
  newRung,
  parseOperand,
  removeBranch,
  removeNode,
  tagAddress,
  wrapInBranch,
  ioList,
  channelType,
  forEachElement,
  newId,
  type InstructionId,
  type LadderNode,
  type Program,
  type Project,
  type Rung,
  type SlotRef,
  type Tag,
} from '@ladder/core';

export interface Selection {
  rungId: string;
  /** Selected node; undefined means the whole rung. */
  nodeId?: string;
  /** End of a range selection inside the same series (shift+click). */
  toNodeId?: string;
}

export interface Cursor extends SlotRef {
  rungId: string;
}

type Clip = { kind: 'rung'; rung: Rung } | { kind: 'node'; node: LadderNode };

export type View = 'editor' | 'tags' | 'hardware' | 'doc' | 'projects';

interface State {
  project: Project;
  past: Project[];
  future: Project[];
  programId: string;
  selection: Selection | null;
  cursor: Cursor | null;
  clipboard: Clip | null;
  view: View;
  /** Set when viewing a shared snapshot: editing disabled until forked. */
  sharedId: string | null;

  setView(v: View): void;
  /** Trend signals: a view preference, so it skips undo history and also works on shared (read-only) projects. */
  setTrend(signals: string[]): void;
  load(project: Project, opts?: { sharedId?: string | null }): void;
  update(recipe: (draft: Draft<Project>) => void): void;
  undo(): void;
  redo(): void;
  select(sel: Selection | null): void;
  setCursor(c: Cursor | null): void;
  setProgram(id: string): void;
  addProgram(kind: 'main' | 'sub', name: string): void;
  renameProgram(id: string, name: string): boolean;
  deleteProgram(id: string): void;
  moveProgram(id: string, delta: number): void;
  setProgramKind(id: string, kind: 'main' | 'sub'): void;

  insertInstruction(instr: InstructionId, at?: Cursor): void;
  moveNodeTo(fromRungId: string, nodeId: string, to: Cursor): void;
  deleteSelection(): void;
  branchAroundSelection(): void;
  addBranchToSelection(): void;
  removeBranch(rungId: string, parallelId: string, branch: number): void;
  setOperand(rungId: string, elementId: string, index: number, text: string): void;
  setInstruction(rungId: string, elementId: string, instr: InstructionId): void;

  addRung(afterRungId?: string): void;
  moveRung(rungId: string, delta: number): void;
  setRungComment(rungId: string, comment: string): void;
  copy(): void;
  paste(): void;
  duplicateRung(rungId: string): void;
}

const HISTORY_LIMIT = 200;

export const isEditable = () => useProject.getState().sharedId === null;

function currentProgram(p: Draft<Project> | Project, id: string) {
  return p.programs.find((g) => g.id === id) ?? p.programs[0]!;
}

function findRung(p: Draft<Project>, programId: string, rungId: string) {
  return currentProgram(p, programId).rungs.find((r) => r.id === rungId) as Rung | undefined;
}

/**
 * Resolves an operand typed by the user: an address in the current dialect becomes the
 * matching tag (created if needed); unknown identifiers become new tags of the expected type.
 */
function resolveOperand(
  p: Draft<Project>,
  text: string,
  operandKind: Parameters<typeof defaultTypeForOperand>[0],
): string {
  const s = text.trim();
  if (!s) return s;
  const project = p as Project;
  const wanted = s.toUpperCase();
  const tagName = (raw: string) => {
    let name = raw.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!/^[A-Z_]/.test(name)) name = '_' + name;
    return name.replace(/_+$/, '');
  };

  // 1. A tag already at this address (hardware channel or manual address).
  const existing = p.tags.find((t) => tagAddress(t as Tag, project).toUpperCase() === wanted);
  if (existing) return existing.name;

  // 2. A free hardware channel with this address: create a tag bound to it.
  const row = ioList(project).find((r) => r.address.toUpperCase() === wanted);
  if (row && !p.tags.some((t) => t.name === s)) {
    let name = tagName(s);
    if (p.tags.some((t) => t.name === name)) name = `${name}_IO`;
    p.tags.push({ name, type: channelType(row.kind), io: { module: row.moduleId, channel: row.channel } });
    return name;
  }

  // 3. A memory address in the current dialect: create a tag with a manual address.
  const parsedAddr = getDialect(p.dialect).parseAddress(s);
  // (A tag whose *name* looks like an address, e.g. "T1" in Haiwell, is used as is.)
  if (parsedAddr && !p.tags.some((t) => t.name === s)) {
    const name = tagName(s);
    if (!p.tags.some((t) => t.name === name))
      p.tags.push({ name, type: parsedAddr.type, address: parsedAddr.address });
    return name;
  }

  // 4. A plain identifier: create a tag of the expected type.
  const op = parseOperand(s);
  if (op.kind === 'tag' && !op.member && isValidTagName(op.name) && !p.tags.some((t) => t.name === op.name)) {
    const type = defaultTypeForOperand(operandKind);
    if (type) p.tags.push({ name: op.name, type });
  }
  return s;
}

export const useProject = create<State>((set, get) => {
  const commit = (recipe: (draft: Draft<Project>) => void) => {
    const { project, past, sharedId } = get();
    if (sharedId) return;
    const changed = produce(project, recipe);
    if (changed === project) return;
    const next = produce(changed, (d) => {
      d.meta.updatedAt = new Date().toISOString();
    });
    set({ project: next, past: [...past.slice(-HISTORY_LIMIT + 1), project], future: [] });
  };

  const editRung = (rungId: string, fn: (r: Rung, d: Draft<Project>) => void) =>
    commit((d) => {
      const r = findRung(d, get().programId, rungId);
      if (r) fn(r, d);
    });

  return {
    project: null as unknown as Project,
    past: [],
    future: [],
    programId: '',
    selection: null,
    cursor: null,
    clipboard: null,
    view: 'editor',
    sharedId: null,

    setView: (view) => set({ view }),
    setTrend(signals) {
      const { project } = get();
      set({
        project: produce(project, (d) => {
          d.trend = signals;
        }),
      });
    },
    load(project, opts) {
      set({
        project,
        past: [],
        future: [],
        programId: project.programs[0]!.id,
        selection: null,
        cursor: null,
        sharedId: opts?.sharedId ?? null,
      });
    },
    update: commit,
    undo() {
      const { past, project, future } = get();
      const prev = past[past.length - 1];
      if (!prev) return;
      set({ project: prev, past: past.slice(0, -1), future: [project, ...future] });
    },
    redo() {
      const { past, project, future } = get();
      const next = future[0];
      if (!next) return;
      set({ project: next, past: [...past, project], future: future.slice(1) });
    },
    select: (selection) => set({ selection }),
    setCursor: (cursor) => set({ cursor }),
    setProgram: (programId) => set({ programId, selection: null, cursor: null }),

    addProgram(kind, name) {
      const existing = new Set(get().project.programs.map((p) => p.name));
      let unique = name;
      for (let i = 2; existing.has(unique); i++) unique = `${name} ${i}`;
      const prog: Program = { id: newId('g_'), name: unique, kind, rungs: [newRung()] };
      commit((d) => {
        d.programs.push(prog);
      });
      set({
        programId: prog.id,
        selection: null,
        cursor: { rungId: prog.rungs[0]!.id, container: prog.rungs[0]!.id, branch: 0, index: 0 },
      });
    },

    renameProgram(id, name) {
      const clean = name.trim();
      const { project } = get();
      const prog = project.programs.find((p) => p.id === id);
      if (!prog || !clean || clean === prog.name) return clean === prog?.name;
      if (project.programs.some((p) => p.id !== id && p.name === clean)) return false;
      const old = prog.name;
      commit((d) => {
        const p = d.programs.find((x) => x.id === id)!;
        p.name = clean;
        // Keep CALL instructions pointing to the renamed program.
        for (const g of d.programs)
          for (const r of g.rungs)
            forEachElement(r.body, (el) => {
              if (el.instr === 'CALL' && el.operands[0]?.trim() === old) el.operands[0] = clean;
            });
      });
      return true;
    },

    deleteProgram(id) {
      const { project, programId } = get();
      if (project.programs.length <= 1) return;
      const idx = project.programs.findIndex((p) => p.id === id);
      commit((d) => {
        d.programs = d.programs.filter((p) => p.id !== id);
      });
      if (programId === id) {
        const next = get().project.programs[Math.max(0, idx - 1)]!;
        set({ programId: next.id, selection: null, cursor: null });
      }
    },

    moveProgram(id, delta) {
      commit((d) => {
        const i = d.programs.findIndex((p) => p.id === id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= d.programs.length) return;
        const [p] = d.programs.splice(i, 1);
        d.programs.splice(j, 0, p!);
      });
    },

    setProgramKind(id, kind) {
      commit((d) => {
        const p = d.programs.find((x) => x.id === id);
        if (!p) return;
        if (kind === 'main') delete p.kind;
        else p.kind = 'sub';
      });
    },

    insertInstruction(instr, at) {
      const { selection, programId, project } = get();
      let cursor = at ?? get().cursor;
      const prog = currentProgram(project, programId);
      if (!cursor && selection?.nodeId) {
        const rung = prog.rungs.find((r) => r.id === selection.rungId);
        const loc = rung && locate(rung, selection.toNodeId ?? selection.nodeId);
        if (rung && loc)
          cursor = { rungId: rung.id, container: loc.container, branch: loc.branch, index: loc.index + 1 };
      }
      if (!cursor) {
        const rung =
          (selection && prog.rungs.find((r) => r.id === selection.rungId)) ??
          prog.rungs[prog.rungs.length - 1];
        if (!rung) return;
        const info = INSTRUCTIONS[instr];
        // Outputs go to the end of the rung, conditions before the trailing outputs.
        let index = rung.body.length;
        if (!info.isOutput)
          while (
            index > 0 &&
            rung.body[index - 1]!.kind === 'el' &&
            INSTRUCTIONS[(rung.body[index - 1] as { instr: InstructionId }).instr].isOutput
          )
            index--;
        cursor = { rungId: rung.id, container: rung.id, branch: 0, index };
      }
      const el = createElement(instr);
      const c = cursor;
      editRung(c.rungId, (r) => insertNode(r, c, el));
      set({ selection: { rungId: c.rungId, nodeId: el.id }, cursor: { ...c, index: c.index + 1 } });
    },

    moveNodeTo(fromRungId, nodeId, to) {
      if (fromRungId === to.rungId) {
        editRung(fromRungId, (r) => moveNode(r, nodeId, to));
      } else {
        commit((d) => {
          const from = findRung(d, get().programId, fromRungId);
          const dest = findRung(d, get().programId, to.rungId);
          if (!from || !dest) return;
          const node = removeNode(from, nodeId);
          if (node) insertNode(dest, to, node);
        });
      }
      set({ selection: { rungId: to.rungId, nodeId }, cursor: null });
    },

    deleteSelection() {
      const { selection } = get();
      if (!selection) return;
      if (!selection.nodeId) {
        commit((d) => {
          const prog = currentProgram(d, get().programId);
          prog.rungs = prog.rungs.filter((r) => r.id !== selection.rungId);
          if (prog.rungs.length === 0) prog.rungs.push(newRung());
        });
        set({ selection: null, cursor: null });
        return;
      }
      editRung(selection.rungId, (r) => {
        const loc = locate(r, selection.nodeId!);
        if (!loc) return;
        let ids = [selection.nodeId!];
        if (selection.toNodeId) {
          const b = locate(r, selection.toNodeId);
          if (b && b.series === loc.series) {
            const [from, to] = [Math.min(loc.index, b.index), Math.max(loc.index, b.index)];
            ids = loc.series.slice(from, to + 1).map((n) => n.id);
          }
        }
        ids.forEach((id) => removeNode(r, id));
      });
      set({ selection: { rungId: selection.rungId }, cursor: null });
    },

    branchAroundSelection() {
      const { selection } = get();
      if (!selection?.nodeId) return;
      editRung(selection.rungId, (r) => {
        const par = wrapInBranch(r, selection.nodeId!, selection.toNodeId);
        if (par) set({ cursor: { rungId: r.id, container: par.id, branch: 1, index: 0 } });
      });
    },

    addBranchToSelection() {
      const { selection } = get();
      if (!selection?.nodeId) return;
      editRung(selection.rungId, (r) => {
        const node = findNode(r, selection.nodeId!);
        // Selected element inside a parallel: add a branch to that parallel.
        const parId = node?.kind === 'par' ? node.id : locate(r, selection.nodeId!)?.container;
        if (!parId || parId === r.id) return;
        const b = addBranch(r, parId);
        if (b >= 0) set({ cursor: { rungId: r.id, container: parId, branch: b, index: 0 } });
      });
    },

    removeBranch(rungId, parallelId, branch) {
      editRung(rungId, (r) => removeBranch(r, parallelId, branch));
      set({ cursor: null });
    },

    setOperand(rungId, elementId, index, text) {
      editRung(rungId, (r, d) => {
        const el = findNode(r, elementId);
        if (el?.kind !== 'el') return;
        const spec = INSTRUCTIONS[el.instr].operands[index];
        if (!spec) return;
        // Labels and program names are plain names, never tags or addresses.
        const value =
          spec.kind === 'label' || spec.kind === 'program' ? text.trim() : resolveOperand(d, text, spec.kind);
        if (el.operands[index] === value) return;
        while (el.operands.length <= index) el.operands.push('');
        el.operands[index] = value;
      });
    },

    setInstruction(rungId, elementId, instr) {
      editRung(rungId, (r) => {
        const el = findNode(r, elementId);
        if (el?.kind !== 'el' || el.instr === instr) return;
        const old = INSTRUCTIONS[el.instr];
        const next = INSTRUCTIONS[instr];
        const fresh = createElement(instr).operands;
        el.operands = next.operands.map((spec, i) =>
          old.operands[i]?.kind === spec.kind ? (el.operands[i] ?? '') : fresh[i]!,
        );
        el.instr = instr;
      });
    },

    addRung(afterRungId) {
      const rung = newRung();
      commit((d) => {
        const prog = currentProgram(d, get().programId);
        const i = afterRungId ? prog.rungs.findIndex((r) => r.id === afterRungId) : -1;
        prog.rungs.splice(i >= 0 ? i + 1 : prog.rungs.length, 0, rung);
      });
      set({
        selection: { rungId: rung.id },
        cursor: { rungId: rung.id, container: rung.id, branch: 0, index: 0 },
      });
    },

    moveRung(rungId, delta) {
      commit((d) => {
        const prog = currentProgram(d, get().programId);
        const i = prog.rungs.findIndex((r) => r.id === rungId);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= prog.rungs.length) return;
        const [r] = prog.rungs.splice(i, 1);
        prog.rungs.splice(j, 0, r!);
      });
    },

    setRungComment(rungId, comment) {
      editRung(rungId, (r) => {
        if (comment.trim()) r.comment = comment;
        else delete r.comment;
      });
    },

    copy() {
      const { selection, project, programId } = get();
      if (!selection) return;
      const rung = currentProgram(project, programId).rungs.find((r) => r.id === selection.rungId);
      if (!rung) return;
      if (!selection.nodeId) set({ clipboard: { kind: 'rung', rung: structuredClone(rung) } });
      else {
        const node = findNode(rung, selection.nodeId);
        if (node) set({ clipboard: { kind: 'node', node: structuredClone(node) } });
      }
    },

    paste() {
      const { clipboard, selection, cursor } = get();
      if (!clipboard) return;
      if (clipboard.kind === 'rung') {
        const rung = cloneRung(clipboard.rung);
        commit((d) => {
          const prog = currentProgram(d, get().programId);
          const i = selection ? prog.rungs.findIndex((r) => r.id === selection.rungId) : -1;
          prog.rungs.splice(i >= 0 ? i + 1 : prog.rungs.length, 0, rung);
        });
        set({ selection: { rungId: rung.id } });
        return;
      }
      const node = cloneNode(clipboard.node);
      let at = cursor;
      if (!at && selection?.nodeId) {
        const rung = currentProgram(get().project, get().programId).rungs.find(
          (r) => r.id === selection.rungId,
        );
        const loc = rung && locate(rung, selection.nodeId);
        if (loc)
          at = {
            rungId: selection.rungId,
            container: loc.container,
            branch: loc.branch,
            index: loc.index + 1,
          };
      }
      if (!at) return;
      const target = at;
      editRung(target.rungId, (r) => insertNode(r, target, node));
      set({ selection: { rungId: target.rungId, nodeId: node.id }, cursor: null });
    },

    duplicateRung(rungId) {
      const rung = currentProgram(get().project, get().programId).rungs.find((r) => r.id === rungId);
      if (!rung) return;
      const copy = cloneRung(rung);
      commit((d) => {
        const prog = currentProgram(d, get().programId);
        prog.rungs.splice(prog.rungs.findIndex((r) => r.id === rungId) + 1, 0, copy);
      });
      set({ selection: { rungId: copy.id } });
    },
  };
});

export function useCurrentProgram(): Program {
  return useProject((s) => currentProgram(s.project, s.programId) as Program);
}
