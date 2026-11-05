/**
 * Derives a grid layout from a rung tree. Units are cells: an element occupies
 * [col, col + 1) on its row; wires run along the middle of rows and vertical
 * wires sit on column edges. Trailing output instructions are right-aligned
 * against the right power rail, as in most PLC editors.
 *
 * Every wire carries a `src` key telling which power value it shows:
 * 'rail' (always energized while running), an element id (its output power) or
 * a parallel id (its OR-ed output). Parallel inputs use the key of the wire
 * that feeds them.
 */
import type { Element, LadderNode, Rung, Series } from './model.ts';
import { INSTRUCTIONS } from './instructions.ts';
import type { SlotRef } from './edit.ts';

export interface PlacedElement {
  el: Element;
  col: number;
  row: number;
}

export interface HWire {
  x1: number;
  x2: number;
  row: number;
  src: string;
}

export interface VWire {
  x: number;
  row1: number;
  row2: number;
  src: string;
}

export interface PlacedSlot extends SlotRef {
  x: number;
  row: number;
}

export interface EmptyBranch {
  parallel: string;
  branch: number;
  x1: number;
  x2: number;
  row: number;
}

export interface RungLayout {
  cols: number;
  rows: number;
  items: PlacedElement[];
  hwires: HWire[];
  vwires: VWire[];
  slots: PlacedSlot[];
  emptyBranches: EmptyBranch[];
}

interface Ctx {
  out: RungLayout;
}

const isOutputNode = (n: LadderNode): boolean =>
  n.kind === 'el'
    ? INSTRUCTIONS[n.instr].isOutput
    : n.branches.length > 0 && n.branches.every((b) => b.length > 0 && isOutputNode(b[b.length - 1]!));

function measure(series: Series): { w: number; h: number } {
  let w = 0;
  let h = 1;
  for (const n of series) {
    if (n.kind === 'el') w += 1;
    else {
      const m = measurePar(n.branches);
      w += m.w;
      h = Math.max(h, m.h);
    }
  }
  return { w, h };
}

function measurePar(branches: Series[]): { w: number; h: number } {
  let w = 1;
  let h = 0;
  for (const b of branches) {
    const m = measure(b);
    w = Math.max(w, m.w);
    h += m.h;
  }
  return { w, h };
}

/** Lays out a series starting at (col,row). Returns the column after it and the src key of its output. */
function placeSeries(
  ctx: Ctx,
  series: Series,
  container: string,
  branch: number,
  col: number,
  row: number,
  src: string,
  startIndex = 0,
  count = series.length,
): { col: number; src: string } {
  for (let i = startIndex; i < startIndex + count; i++) {
    const n = series[i]!;
    ctx.out.slots.push({ container, branch, index: i, x: col, row });
    if (n.kind === 'el') {
      ctx.out.items.push({ el: n, col, row });
      col += 1;
      src = n.id;
    } else {
      const { w } = measurePar(n.branches);
      let r = row;
      let lastRow = row;
      n.branches.forEach((b, bi) => {
        lastRow = r;
        if (b.length === 0) {
          ctx.out.hwires.push({ x1: col, x2: col + w, row: r, src });
          ctx.out.emptyBranches.push({ parallel: n.id, branch: bi, x1: col, x2: col + w, row: r });
          ctx.out.slots.push({ container: n.id, branch: bi, index: 0, x: col, row: r });
          r += 1;
          return;
        }
        const res = placeSeries(ctx, b, n.id, bi, col, r, src);
        ctx.out.slots.push({ container: n.id, branch: bi, index: b.length, x: res.col, row: r });
        if (res.col < col + w) ctx.out.hwires.push({ x1: res.col, x2: col + w, row: r, src: res.src });
        r += measure(b).h;
      });
      if (lastRow > row) {
        ctx.out.vwires.push({ x: col, row1: row, row2: lastRow, src });
        ctx.out.vwires.push({ x: col + w, row1: row, row2: lastRow, src: n.id });
      }
      col += w;
      src = n.id;
    }
  }
  return { col, src };
}

export function layoutRung(rung: Rung, minCols = 8): RungLayout {
  const out: RungLayout = {
    cols: 0,
    rows: 1,
    items: [],
    hwires: [],
    vwires: [],
    slots: [],
    emptyBranches: [],
  };
  const ctx: Ctx = { out };
  const body = rung.body;

  // Split into logic + trailing outputs (right aligned).
  let split = body.length;
  while (split > 0 && isOutputNode(body[split - 1]!)) split--;
  const logic = body.slice(0, split);
  const outputs = body.slice(split);
  const lw = measure(logic).w;
  const ow = measure(outputs).w;
  const cols = Math.max(minCols, lw + ow + 1);
  out.cols = cols;
  out.rows = Math.max(1, measure(body).h);

  const a = placeSeries(ctx, body, rung.id, 0, 0, 0, 'rail', 0, split);
  const outStart = cols - ow;
  out.hwires.push({ x1: a.col, x2: outStart, row: 0, src: a.src });
  out.slots.push({
    container: rung.id,
    branch: 0,
    index: split,
    x: outputs.length ? outStart : a.col,
    row: 0,
  });
  if (outputs.length) {
    const b = placeSeries(ctx, body, rung.id, 0, outStart, 0, a.src, split, outputs.length);
    out.slots.push({ container: rung.id, branch: 0, index: body.length, x: b.col, row: 0 });
  }
  // Deduplicate slots that ended up at the same index of the same series.
  const seen = new Set<string>();
  out.slots = out.slots.filter((s) => {
    const k = `${s.container}/${s.branch}/${s.index}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return out;
}
