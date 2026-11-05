/** Static checks shown in the editor's problems panel. Messages are i18n keys (`diag.<code>`). */
import type { Element, Project, Series, Tag } from './model.ts';
import { INSTRUCTIONS, type OperandKind } from './instructions.ts';
import { isValidTagName, NUMERIC_MEMBERS, parseOperand } from './operand.ts';
import { channelType, isInputTag, tagAddress } from './hardware.ts';
import { forEachElement } from './edit.ts';
import { familyCpu, getFamily } from './families.ts';
import { getDialect } from './dialects.ts';

export interface Diagnostic {
  severity: 'error' | 'warning';
  code: string;
  params?: Record<string, string | number>;
  programId?: string;
  rungId?: string;
  elementId?: string;
  tag?: string;
}

const NUMERIC_TYPES = new Set(['INT', 'DINT', 'REAL']);

function checkOperand(
  kind: OperandKind,
  text: string | undefined,
  tags: Map<string, Tag>,
): { code: string; params?: Record<string, string> } | null {
  if (kind === 'label' || kind === 'program') {
    // Names, not tags: checked against labels / programs in validateProject.
    const name = (text ?? '').trim();
    if (!name) return { code: 'missingOperand' };
    return isValidTagName(name) || kind === 'program'
      ? null
      : { code: 'invalidOperand', params: { text: name } };
  }
  const p = parseOperand(text);
  if (p.kind === 'empty') return { code: 'missingOperand' };
  if (p.kind === 'invalid') return { code: 'invalidOperand', params: { text: p.text } };
  if (p.kind === 'literal') {
    if (
      kind === 'numberDest' ||
      kind === 'bitDest' ||
      kind === 'timer' ||
      kind === 'counter' ||
      kind === 'timerOrCounter'
    )
      return { code: 'literalNotAllowed' };
    return null;
  }
  const tag = tags.get(p.name);
  if (!tag) return { code: 'unknownTag', params: { name: p.name } };
  const t = tag.type;
  const isStruct = t === 'TIMER' || t === 'COUNTER';
  const mismatch = (expected: string) => ({ code: 'typeMismatch', params: { name: text!.trim(), expected } });
  if (p.member && !isStruct) return { code: 'invalidMember', params: { name: p.name } };
  switch (kind) {
    case 'bitDest':
      if (p.member) return mismatch('BOOL');
      return t === 'BOOL' ? null : mismatch('BOOL');
    case 'bit':
      if (p.member) return NUMERIC_MEMBERS.has(p.member) ? mismatch('BOOL') : null;
      return t === 'BOOL' ? null : mismatch('BOOL');
    case 'timer':
      return t === 'TIMER' && !p.member ? null : mismatch('TIMER');
    case 'counter':
      return t === 'COUNTER' && !p.member ? null : mismatch('COUNTER');
    case 'timerOrCounter':
      return isStruct && !p.member ? null : mismatch('TIMER/COUNTER');
    case 'time':
    case 'number':
    case 'numberDest':
      if (p.member) return NUMERIC_MEMBERS.has(p.member) ? null : mismatch('INT/DINT/REAL');
      if (NUMERIC_TYPES.has(t)) return null;
      if (t === 'BOOL' && kind !== 'numberDest') return null;
      return mismatch('INT/DINT/REAL');
  }
}

export function validateProject(project: Project): Diagnostic[] {
  const out: Diagnostic[] = [];
  const tags = new Map(project.tags.map((t) => [t.name, t]));
  const coilUses = new Map<string, number>();
  const timerUses = new Map<string, number>();
  const family = getFamily(project.hardware.family);
  const cpu = familyCpu(project.hardware);
  if (family && cpu) {
    const expansions = project.hardware.modules.filter(
      (m) => !m.embedded && m.kind !== 'CPU' && m.kind !== 'PS',
    ).length;
    if (expansions > cpu.maxModules)
      out.push({ severity: 'error', code: 'tooManyModules', params: { cpu: cpu.name, max: cpu.maxModules } });
  }

  for (const prog of project.programs) {
    for (const rung of prog.rungs) {
      const at = { programId: prog.id, rungId: rung.id };
      if (rung.body.length === 0) {
        out.push({ severity: 'warning', code: 'emptyRung', ...at });
        continue;
      }
      let hasOutput = false;
      forEachElement(rung.body, (el: Element) => {
        const info = INSTRUCTIONS[el.instr];
        if (info.isOutput) hasOutput = true;
        if (family?.unsupported.includes(el.instr))
          out.push({
            severity: 'warning',
            code: 'unsupportedInstruction',
            params: { instr: getDialect(project.dialect).mnemonic(el.instr), family: family.name },
            ...at,
            elementId: el.id,
          });
        info.operands.forEach((spec, i) => {
          const problem = checkOperand(spec.kind, el.operands[i], tags);
          if (problem)
            out.push({
              severity: 'error',
              ...problem,
              params: { ...problem.params, operand: spec.label },
              ...at,
              elementId: el.id,
            });
        });
        const first = parseOperand(el.operands[0]);
        if (first.kind === 'tag' && !first.member) {
          if (el.instr === 'COIL' || el.instr === 'NCOIL')
            coilUses.set(first.name, (coilUses.get(first.name) ?? 0) + 1);
          if (info.category === 'timer') timerUses.set(first.name, (timerUses.get(first.name) ?? 0) + 1);
          const tag = tags.get(first.name);
          if (tag && info.category === 'coil' && isInputTag(tag, project.hardware))
            out.push({
              severity: 'warning',
              code: 'writesInput',
              params: { name: tag.name },
              ...at,
              elementId: el.id,
            });
        }
      });
      if (!hasOutput) out.push({ severity: 'warning', code: 'noOutput', ...at });
      if (project.dialect === 'ab')
        checkOutputsLast(rung.body, (el) =>
          out.push({ severity: 'warning', code: 'outputNotLast', ...at, elementId: el.id }),
        );
    }
  }

  checkProgramFlow(project, out);

  for (const [name, n] of coilUses)
    if (n > 1)
      out.push({ severity: 'warning', code: 'duplicateCoil', params: { name, count: n }, tag: name });
  for (const [name, n] of timerUses)
    if (n > 1)
      out.push({ severity: 'warning', code: 'duplicateTimer', params: { name, count: n }, tag: name });

  const byAddress = new Map<string, string>();
  const byChannel = new Map<string, string>();
  for (const t of project.tags) {
    if (t.io) {
      const m = project.hardware.modules.find((x) => x.id === t.io!.module);
      if (!m) out.push({ severity: 'error', code: 'missingModule', params: { name: t.name }, tag: t.name });
      else {
        if (t.io.channel >= m.channels)
          out.push({ severity: 'error', code: 'missingModule', params: { name: t.name }, tag: t.name });
        if (channelType(m.kind) !== t.type)
          out.push({
            severity: 'warning',
            code: 'channelType',
            params: { name: t.name, expected: channelType(m.kind) },
            tag: t.name,
          });
      }
      const key = `${t.io.module}:${t.io.channel}`;
      const other = byChannel.get(key);
      if (other)
        out.push({
          severity: 'error',
          code: 'duplicateChannel',
          params: { name: t.name, other },
          tag: t.name,
        });
      else byChannel.set(key, t.name);
    }
    const addr = tagAddress(t, project);
    if (addr) {
      const other = byAddress.get(addr);
      if (other && !t.io)
        out.push({
          severity: 'warning',
          code: 'duplicateAddress',
          params: { name: t.name, other, address: addr },
          tag: t.name,
        });
      else byAddress.set(addr, t.name);
    }
  }
  return out;
}

/** Allen-Bradley requires output instructions to be the last ones of their branch. */
function checkOutputsLast(series: Series, report: (el: Element) => void): void {
  series.forEach((n, i) => {
    if (n.kind === 'par') n.branches.forEach((b) => checkOutputsLast(b, report));
    else if (INSTRUCTIONS[n.instr].isOutput && i < series.length - 1) {
      const rest = series.slice(i + 1);
      const onlyOutputs = rest.every((r) => r.kind === 'el' && INSTRUCTIONS[r.instr].isOutput);
      if (!onlyOutputs) report(n);
    }
  });
}

/** JMP/LBL inside each program, CALL targets and recursive calls. */
function checkProgramFlow(project: Project, out: Diagnostic[]): void {
  const byName = new Map(project.programs.map((p) => [p.name, p]));
  const calls = new Map<string, Set<string>>();
  for (const prog of project.programs) {
    const labels = new Map<string, number>();
    const jumps: { label: string; rungId: string; elementId: string }[] = [];
    const callees = new Set<string>();
    for (const rung of prog.rungs) {
      const at = { programId: prog.id, rungId: rung.id };
      forEachElement(rung.body, (el) => {
        const name = el.operands[0]?.trim() ?? '';
        if (!name) return;
        if (el.instr === 'LBL') {
          labels.set(name, (labels.get(name) ?? 0) + 1);
          if (labels.get(name) === 2)
            out.push({
              severity: 'error',
              code: 'duplicateLabel',
              params: { label: name },
              ...at,
              elementId: el.id,
            });
          if (rung.body[0]?.id !== el.id)
            out.push({
              severity: 'warning',
              code: 'labelNotFirst',
              params: { label: name },
              ...at,
              elementId: el.id,
            });
        }
        if (el.instr === 'JMP') jumps.push({ label: name, ...at, elementId: el.id });
        if (el.instr === 'CALL') {
          const target = byName.get(name);
          if (!target)
            out.push({
              severity: 'error',
              code: 'unknownProgram',
              params: { name },
              ...at,
              elementId: el.id,
            });
          else if (target.id === prog.id)
            out.push({ severity: 'error', code: 'recursiveCall', params: { name }, ...at, elementId: el.id });
          else callees.add(target.name);
        }
      });
    }
    for (const j of jumps)
      if (!labels.has(j.label))
        out.push({
          severity: 'error',
          code: 'unknownLabel',
          params: { label: j.label },
          programId: prog.id,
          rungId: j.rungId,
          elementId: j.elementId,
        });
    calls.set(prog.name, callees);
  }
  // Indirect recursion (A calls B calls A).
  const visiting = new Set<string>();
  const done = new Set<string>();
  const reported = new Set<string>();
  const dfs = (name: string, path: string[]) => {
    if (visiting.has(name)) {
      const cycle = [...path.slice(path.indexOf(name)), name].join(' → ');
      if (!reported.has(cycle)) {
        reported.add(cycle);
        out.push({ severity: 'error', code: 'callCycle', params: { cycle } });
      }
      return;
    }
    if (done.has(name)) return;
    visiting.add(name);
    for (const c of calls.get(name) ?? []) dfs(c, [...path, name]);
    visiting.delete(name);
    done.add(name);
  };
  for (const name of calls.keys()) dfs(name, []);
  for (const prog of project.programs)
    if (prog.kind === 'sub' && ![...calls.values()].some((c) => c.has(prog.name)))
      out.push({
        severity: 'warning',
        code: 'subNeverCalled',
        params: { name: prog.name },
        programId: prog.id,
      });
}
