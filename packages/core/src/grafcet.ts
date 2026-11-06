/**
 * GRAFCET (IEC 60848 / SFC) to ladder.
 *
 * The GRAFCET is the source: its ladder program is regenerated on every change
 * using the classic "one memory bit per step" method:
 *   - initialization: when no step is active, the initial step is set;
 *   - one rung per transition: step active AND receptivity -> SET next, RESET current;
 *   - one rung per action: OR of the steps where it is active -> coil.
 * Chained (fugitive) evolutions within a scan are allowed, as in IEC 60848.
 */
import type { Diagnostic } from './validate.ts';
import type { Grafcet, LadderNode, Project, Rung, Series, Tag } from './model.ts';
import { coil, el, nc, no, par, reset, rung, set } from './build.ts';
import { newId } from './ids.ts';
import { forEachElement } from './edit.ts';
import { escapeRegExp, formatTime, isValidTagName, parseOperand, parseTime } from './operand.ts';

export type ConditionLiteral =
  { kind: 'tag'; operand: string; negated: boolean } | { kind: 'time'; ms: number } | { kind: 'true' };

export type ParsedCondition =
  | { ok: true; groups: ConditionLiteral[][] }
  | { ok: false; error: 'empty' | 'invalidTerm' | 'multipleTimes' | 'negatedTime'; term?: string };

/** `A0 & B0 | !S1`, `NOT X`, `T#2s`, `1` (always true). `&` binds tighter than `|`. */
export function parseCondition(text: string): ParsedCondition {
  const src = text.trim();
  if (!src) return { ok: false, error: 'empty' };
  const groups: ConditionLiteral[][] = [];
  let times = 0;
  for (const g of src.split('|')) {
    const lits: ConditionLiteral[] = [];
    for (const raw of g.split('&')) {
      let term = raw.trim();
      let negated = false;
      if (term.startsWith('!')) {
        negated = true;
        term = term.slice(1).trim();
      } else if (/^not\s+/i.test(term)) {
        negated = true;
        term = term.replace(/^not\s+/i, '');
      }
      if (!term) return { ok: false, error: 'invalidTerm', term: raw.trim() };
      if (term === '1' && !negated) {
        lits.push({ kind: 'true' });
        continue;
      }
      const ms = parseTime(term);
      if (ms !== null) {
        if (negated) return { ok: false, error: 'negatedTime', term };
        times++;
        lits.push({ kind: 'time', ms });
        continue;
      }
      const p = parseOperand(term);
      if (p.kind !== 'tag') return { ok: false, error: 'invalidTerm', term };
      lits.push({ kind: 'tag', operand: term, negated });
    }
    groups.push(lits);
  }
  if (times > 1) return { ok: false, error: 'multipleTimes' };
  return { ok: true, groups };
}

export const stepTag = (g: Grafcet, i: number) => `${g.prefix}X${i}`;
export const stepTimer = (g: Grafcet, i: number) => `${g.prefix}T${i}`;
export const nextStep = (g: Grafcet, i: number) => (i + 1 < g.steps.length ? i + 1 : g.loopTo);

function conditionNode(g: Grafcet, i: number, groups: ConditionLiteral[][]): LadderNode[] {
  const series = (lits: ConditionLiteral[]): Series =>
    lits.flatMap((l): LadderNode[] =>
      l.kind === 'true'
        ? []
        : l.kind === 'time'
          ? [no(`${stepTimer(g, i)}.DN`)]
          : [l.negated ? nc(l.operand) : no(l.operand)],
    );
  if (groups.length === 1) return series(groups[0]!);
  return [par(...groups.map((gr) => series(gr)))];
}

/** Ladder rungs of a GRAFCET. Transitions with an invalid condition generate no rung (see validation). */
export function grafcetRungs(g: Grafcet): Rung[] {
  const rungs: Rung[] = [];
  rungs.push(
    rung(
      [...g.steps.map((_, i) => nc(stepTag(g, i))), set(stepTag(g, 0))],
      `${g.name}: etapa inicial ${stepTag(g, 0)} ativa quando nenhuma etapa está ativa`,
    ),
  );
  g.transitions.forEach((t, i) => {
    if (i >= g.steps.length) return;
    const parsed = parseCondition(t.condition);
    if (!parsed.ok) return;
    const time = parsed.groups.flat().find((l) => l.kind === 'time');
    if (time && time.kind === 'time')
      rungs.push(
        rung([no(stepTag(g, i)), el('TON', stepTimer(g, i), formatTime(time.ms))], `Tempo da etapa ${i}`),
      );
    const to = nextStep(g, i);
    const evolve: LadderNode =
      to === i ? set(stepTag(g, to)) : par([set(stepTag(g, to))], [reset(stepTag(g, i))]);
    rungs.push(
      rung(
        [no(stepTag(g, i)), ...conditionNode(g, i, parsed.groups), evolve],
        `Transição ${i} → ${to}: ${t.condition.trim()}`,
      ),
    );
  });
  const actions = new Map<string, number[]>();
  g.steps.forEach((s, i) =>
    s.actions.forEach((a) => {
      const name = a.trim();
      if (!name) return;
      actions.set(name, [...(actions.get(name) ?? []), i]);
    }),
  );
  for (const [tag, steps] of actions) {
    const cond: LadderNode[] =
      steps.length === 1 ? [no(stepTag(g, steps[0]!))] : [par(...steps.map((i) => [no(stepTag(g, i))]))];
    rungs.push(rung([...cond, coil(tag)], `Ação ${tag}: etapa(s) ${steps.join(', ')}`));
  }
  return rungs;
}

/**
 * Regenerates the GRAFCET's ladder program and the tags it needs (mutates the project).
 * Step bits and step timers are created with the GRAFCET prefix; unknown action and
 * condition tags are created as BOOL, like the ladder editor does.
 */
export function syncGrafcet(project: Project, grafcetId: string): void {
  const g = project.grafcets?.find((x) => x.id === grafcetId);
  if (!g) return;
  let prog = project.programs.find((p) => p.id === g.programId);
  if (!prog) {
    prog = { id: g.programId, name: g.name, rungs: [], generatedBy: g.id };
    project.programs.push(prog);
  }
  prog.generatedBy = g.id;
  prog.name = uniqueProgramName(project, g.name, prog.id);
  prog.rungs = grafcetRungs(g);
  delete prog.kind;

  const tags = new Map(project.tags.map((t) => [t.name, t]));
  const ensure = (name: string, type: Tag['type'], comment?: string) => {
    const t = tags.get(name);
    if (t) {
      if (comment && !t.comment) t.comment = comment;
      return;
    }
    const tag: Tag = { name, type, ...(comment ? { comment } : {}) };
    project.tags.push(tag);
    tags.set(name, tag);
  };
  g.steps.forEach((s, i) =>
    ensure(stepTag(g, i), 'BOOL', `${g.name}: etapa ${i}${s.comment ? ` (${s.comment})` : ''}`),
  );
  for (const r of prog.rungs)
    forEachElement(r.body, (e) => {
      const p = parseOperand(e.operands[0]);
      if (p.kind !== 'tag') return;
      if (e.instr === 'TON') ensure(p.name, 'TIMER', `${g.name}: tempo de etapa`);
      else if (!p.member && isValidTagName(p.name)) ensure(p.name, 'BOOL');
    });

  // Drop step bits / timers of removed steps (only the GRAFCET's own prefixed tags, when unused).
  const used = new Set<string>();
  for (const pr of project.programs)
    for (const r of pr.rungs)
      forEachElement(r.body, (e) =>
        e.operands.forEach((o) => {
          const p = parseOperand(o);
          if (p.kind === 'tag') used.add(p.name);
        }),
      );
  const own = new RegExp(`^${escapeRegExp(g.prefix)}[XT]\\d+$`);
  project.tags = project.tags.filter((t) => !own.test(t.name) || used.has(t.name));
}

function uniqueProgramName(project: Project, name: string, selfId: string): string {
  const taken = new Set(project.programs.filter((p) => p.id !== selfId).map((p) => p.name));
  let n = name;
  for (let i = 2; taken.has(n); i++) n = `${name} ${i}`;
  return n;
}

/** Creates a 2-step GRAFCET with its (generated) ladder program. Mutates the project; returns it. */
export function createGrafcet(project: Project, name: string): Grafcet {
  const used = new Set((project.grafcets ?? []).map((g) => g.prefix));
  let k = 1;
  while (used.has(`G${k}_`)) k++;
  const g: Grafcet = {
    id: newId('sfc_'),
    name: `${name} ${k}`,
    prefix: `G${k}_`,
    steps: [
      { id: newId('s_'), actions: [], comment: 'Repouso' },
      { id: newId('s_'), actions: [] },
    ],
    transitions: [
      { id: newId('t_'), condition: '' },
      { id: newId('t_'), condition: '' },
    ],
    loopTo: 0,
    programId: newId('g_'),
  };
  project.grafcets = [...(project.grafcets ?? []), g];
  syncGrafcet(project, g.id);
  return g;
}

/** Validation of GRAFCET structures (conditions, actions). */
export function validateGrafcets(project: Project): Diagnostic[] {
  const out: Diagnostic[] = [];
  const tags = new Map(project.tags.map((t) => [t.name, t]));
  for (const g of project.grafcets ?? []) {
    g.transitions.forEach((t, i) => {
      const p = parseCondition(t.condition);
      if (!p.ok)
        out.push({
          severity: 'error',
          code: `grafcet_${p.error}`,
          params: { grafcet: g.name, transition: i, term: p.term ?? '' },
          programId: g.programId,
        });
    });
    g.steps.forEach((s, i) =>
      s.actions.forEach((a) => {
        const tag = tags.get(a.trim());
        if (tag && tag.type !== 'BOOL')
          out.push({
            severity: 'error',
            code: 'grafcetActionType',
            params: { grafcet: g.name, step: i, name: a.trim() },
            programId: g.programId,
          });
      }),
    );
    if (g.loopTo >= g.steps.length)
      out.push({
        severity: 'error',
        code: 'grafcetLoop',
        params: { grafcet: g.name },
        programId: g.programId,
      });
  }
  return out;
}
