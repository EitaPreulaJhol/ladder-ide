import { describe, expect, it } from 'vitest';
import {
  addBranch,
  coil,
  insertNode,
  layoutRung,
  locate,
  moveNode,
  no,
  par,
  removeNode,
  rung,
  wrapInBranch,
  createElement,
} from '../src/index.ts';

describe('rung editing', () => {
  it('wraps an element into a branch and inserts into the empty branch', () => {
    const a = no('A');
    const r = rung([a, coil('Y')]);
    const p = wrapInBranch(r, a.id)!;
    expect(r.body[0]).toBe(p);
    expect(p.branches).toEqual([[a], []]);
    insertNode(r, { container: p.id, branch: 1, index: 0 }, no('B'));
    expect(p.branches[1]!.length).toBe(1);
  });

  it('removing elements collapses degenerate parallels', () => {
    const a = no('A');
    const b = no('B');
    const r = rung([par([a], [b]), coil('Y')]);
    removeNode(r, b.id);
    expect(r.body.map((n) => n.id)).toEqual([a.id, r.body[1]!.id]);
    expect(r.body[0]!.kind).toBe('el');
  });

  it('wraps a range of elements', () => {
    const a = no('A');
    const b = no('B');
    const c = coil('Y');
    const r = rung([a, b, c]);
    const p = wrapInBranch(r, a.id, b.id)!;
    expect(p.branches[0]).toEqual([a, b]);
    expect(r.body.length).toBe(2);
  });

  it('moves a node within the same series and across branches', () => {
    const a = no('A');
    const b = no('B');
    const c = coil('Y');
    const r = rung([a, b, c]);
    moveNode(r, a.id, { container: r.id, branch: 0, index: 2 });
    expect(r.body.map((n) => n.id)).toEqual([b.id, a.id, c.id]);
    const p = wrapInBranch(r, b.id)!;
    moveNode(r, a.id, { container: p.id, branch: 1, index: 0 });
    expect(p.branches[1]).toEqual([a]);
    // cannot move a parallel into itself
    expect(moveNode(r, p.id, { container: p.id, branch: 0, index: 0 })).toBe(false);
  });

  it('flattens nested single parallels when adding branches', () => {
    const a = no('A');
    const r = rung([a, coil('Y')]);
    const p = wrapInBranch(r, a.id)!;
    addBranch(r, p.id);
    expect(p.branches.length).toBe(3);
    expect(locate(r, a.id)?.container).toBe(p.id);
  });
});

describe('layout', () => {
  it('right-aligns trailing outputs and creates wires', () => {
    const r = rung([no('A'), coil('Y')]);
    const l = layoutRung(r, 6);
    expect(l.cols).toBe(6);
    expect(l.items.map((i) => i.col)).toEqual([0, 5]);
    expect(l.hwires).toContainEqual({ x1: 1, x2: 5, row: 0, src: r.body[0]!.id });
  });

  it('stacks parallel branches on rows with vertical wires', () => {
    const a = no('A');
    const b1 = no('B');
    const b2 = no('C');
    const r = rung([par([a], [b1, b2]), coil('Y')]);
    const l = layoutRung(r, 4);
    expect(l.rows).toBe(2);
    expect(l.items.find((i) => i.el.id === b2.id)).toMatchObject({ col: 1, row: 1 });
    expect(l.vwires.length).toBe(2);
    // shorter upper branch is padded with a wire up to the branch width
    expect(l.hwires.some((w) => w.row === 0 && w.x1 === 1 && w.x2 === 2 && w.src === a.id)).toBe(true);
  });

  it('exposes insertion slots for every position, including empty rungs and branches', () => {
    const empty = rung([]);
    expect(layoutRung(empty).slots).toEqual([{ container: empty.id, branch: 0, index: 0, x: 0, row: 0 }]);
    const a = createElement('NO', ['A']);
    const r = rung([a]);
    const p = wrapInBranch(r, a.id)!;
    const l = layoutRung(r);
    expect(l.emptyBranches).toHaveLength(1);
    expect(l.slots.some((s) => s.container === p.id && s.branch === 1 && s.index === 0)).toBe(true);
  });
});
