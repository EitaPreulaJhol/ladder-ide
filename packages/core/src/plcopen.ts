/**
 * PLCopen XML (TC6 v2.01) export / import of Ladder (LD) programs.
 *
 * Export turns each series/parallel rung into PLCopen's connection graph
 * (power rails, contacts, coils, blocks fed by in/outVariables, jumps, labels).
 * Import rebuilds series/parallel rungs from that graph: every path from the left
 * rail to a sink (coil, block or jump with nothing after it) becomes a series,
 * and paths are merged by factoring common prefixes into parallel branches.
 *
 * Non-standard blocks (RES, SCALE, PID, BSL/BSR, CALL of another program, RTO as
 * TONR) are exported with descriptive names so they survive a round trip; other
 * tools may not know them.
 */
import type {
  DataType,
  Element,
  InstructionId,
  LadderNode,
  Program,
  Project,
  Rung,
  Series,
  Tag,
} from './model.ts';
import { getDialect } from './dialects.ts';
import { tagAddress } from './hardware.ts';
import { layoutRung } from './layout.ts';
import { newId } from './ids.ts';
import { formatTime, parseOperand } from './operand.ts';
import { createElement, forEachElement, newRung } from './edit.ts';
import { createProject } from './project.ts';
import {
  cdata,
  child,
  children,
  descendants,
  parseXml,
  renderXml,
  x,
  type XmlElement,
  type XmlNode,
} from './xml.ts';

type OpMap = { in: string } | { out: string } | { inout: string } | { instance: true };

interface BlockDef {
  type: (el: Element) => string;
  power: string;
  out: string;
  ops: OpMap[];
}

const fixed = (t: string) => () => t;
const inst: OpMap = { instance: true };
const BIN = (): BlockDef => ({
  type: (e) => e.instr,
  power: 'EN',
  out: 'ENO',
  ops: [{ in: 'IN1' }, { in: 'IN2' }, { out: 'OUT' }],
});

const BLOCKS: Partial<Record<InstructionId, BlockDef>> = {
  TON: { type: fixed('TON'), power: 'IN', out: 'Q', ops: [inst, { in: 'PT' }] },
  TOF: { type: fixed('TOF'), power: 'IN', out: 'Q', ops: [inst, { in: 'PT' }] },
  TP: { type: fixed('TP'), power: 'IN', out: 'Q', ops: [inst, { in: 'PT' }] },
  RTO: { type: fixed('TONR'), power: 'IN', out: 'Q', ops: [inst, { in: 'PT' }] },
  CTU: { type: fixed('CTU'), power: 'CU', out: 'Q', ops: [inst, { in: 'PV' }] },
  CTD: { type: fixed('CTD'), power: 'CD', out: 'Q', ops: [inst, { in: 'PV' }] },
  CTUD: { type: fixed('CTUD'), power: 'CU', out: 'QU', ops: [inst, { in: 'PV' }, { in: 'CD' }] },
  RES: { type: fixed('RES'), power: 'EN', out: 'ENO', ops: [{ in: 'IN' }] },
  SR: { type: fixed('SR'), power: 'S1', out: 'Q1', ops: [{ out: 'Q1' }, { in: 'R' }] },
  RS: { type: fixed('RS'), power: 'S', out: 'Q1', ops: [{ out: 'Q1' }, { in: 'R1' }] },
  ...Object.fromEntries(
    (['EQ', 'NE', 'GT', 'GE', 'LT', 'LE'] as const).map((id) => [
      id,
      { type: fixed(id), power: 'EN', out: 'OUT', ops: [{ in: 'IN1' }, { in: 'IN2' }] } satisfies BlockDef,
    ]),
  ),
  MOVE: { type: fixed('MOVE'), power: 'EN', out: 'ENO', ops: [{ in: 'IN' }, { out: 'OUT' }] },
  ADD: BIN(),
  SUB: BIN(),
  MUL: BIN(),
  DIV: BIN(),
  MOD: BIN(),
  SCALE: {
    type: fixed('SCALE'),
    power: 'EN',
    out: 'ENO',
    ops: [
      { in: 'IN' },
      { in: 'IN_MIN' },
      { in: 'IN_MAX' },
      { in: 'OUT_MIN' },
      { in: 'OUT_MAX' },
      { out: 'OUT' },
    ],
  },
  PID: {
    type: fixed('PID'),
    power: 'EN',
    out: 'ENO',
    ops: [{ in: 'PV' }, { in: 'SP' }, { out: 'CV' }, { in: 'KP' }, { in: 'TI' }, { in: 'TD' }],
  },
  BSL: {
    type: fixed('BSL'),
    power: 'EN',
    out: 'ENO',
    ops: [{ inout: 'WORD' }, { in: 'BIT' }, { in: 'LEN' }],
  },
  BSR: {
    type: fixed('BSR'),
    power: 'EN',
    out: 'ENO',
    ops: [{ inout: 'WORD' }, { in: 'BIT' }, { in: 'LEN' }],
  },
  SHL: { type: fixed('SHL'), power: 'EN', out: 'ENO', ops: [{ in: 'IN' }, { in: 'N' }, { out: 'OUT' }] },
  SHR: { type: fixed('SHR'), power: 'EN', out: 'ENO', ops: [{ in: 'IN' }, { in: 'N' }, { out: 'OUT' }] },
  NORM_X: {
    type: fixed('NORM_X'),
    power: 'EN',
    out: 'ENO',
    ops: [{ in: 'MIN' }, { in: 'VALUE' }, { in: 'MAX' }, { out: 'OUT' }],
  },
  SCALE_X: {
    type: fixed('SCALE_X'),
    power: 'EN',
    out: 'ENO',
    ops: [{ in: 'MIN' }, { in: 'VALUE' }, { in: 'MAX' }, { out: 'OUT' }],
  },
  CALL: { type: (e) => (e.operands[0] ?? '').trim(), power: 'EN', out: 'ENO', ops: [] },
};

const TYPE_TO_INSTR: Record<string, InstructionId> = Object.fromEntries(
  (Object.entries(BLOCKS) as [InstructionId, BlockDef][])
    .filter(([id]) => id !== 'CALL')
    .map(([id, def]) => [def.type({ kind: 'el', id: '', instr: id, operands: [] }), id]),
);

// ------------------------------------------------------------------ export

const CELL_X = 90;
const CELL_Y = 60;

const iecType = (t: DataType, timerType = 'TON', counterType = 'CTU'): XmlNode =>
  t === 'TIMER'
    ? x('derived', { name: timerType })
    : t === 'COUNTER'
      ? x('derived', { name: counterType })
      : x(t);

interface Src {
  id: number;
  param?: string;
}

/** Operand as an IEC expression (plain ms in a time slot becomes T#…ms). */
function expression(text: string, isTime: boolean): string {
  const s = (text ?? '').trim();
  if (isTime) {
    const p = parseOperand(s);
    if (p.kind === 'literal' && !/^t(ime)?#/i.test(s)) return formatTime(p.value);
  }
  return s;
}

function exportPou(prog: Program): XmlNode {
  let next = 1;
  const nodes: XmlNode[] = [];
  const conn = (srcs: Src[]) =>
    x(
      'connectionPointIn',
      {},
      ...srcs.map((s) => x('connection', { refLocalId: s.id, formalParameter: s.param })),
    );
  let yBase = 20;

  prog.rungs.forEach((rung) => {
    const layout = layoutRung(rung, 4);
    const pos = new Map(layout.items.map((it) => [it.el.id, it]));
    const P = (elId: string) => {
      const it = pos.get(elId);
      return x('position', { x: 60 + (it?.col ?? 0) * CELL_X, y: yBase + (it?.row ?? 0) * CELL_Y });
    };
    if (rung.comment) {
      nodes.push(
        x(
          'comment',
          { localId: next++, height: 30, width: 400 },
          x('position', { x: 20, y: yBase }),
          x('content', {}, x('xhtml:p', {}, cdata(rung.comment))),
        ),
      );
      yBase += 40;
    }
    const rail = next++;
    nodes.push(
      x(
        'leftPowerRail',
        { localId: rail, height: layout.rows * CELL_Y, width: 10 },
        x('position', { x: 20, y: yBase }),
        x('connectionPointOut', { formalParameter: '' }),
      ),
    );

    const elementNode = (el: Element, srcs: Src[]): Src[] => {
      const id = next++;
      const info = el.instr;
      const operand = (el.operands[0] ?? '').trim();
      if (info === 'LBL') {
        nodes.push(x('label', { localId: id, label: operand, height: 20, width: 60 }, P(el.id)));
        return srcs;
      }
      if (info === 'NO' || info === 'NC' || info === 'POS' || info === 'NEG') {
        nodes.push(
          x(
            'contact',
            {
              localId: id,
              negated: info === 'NC',
              edge: info === 'POS' ? 'rising' : info === 'NEG' ? 'falling' : 'none',
              height: 20,
              width: 20,
            },
            P(el.id),
            conn(srcs),
            x('connectionPointOut'),
            x('variable', {}, operand),
          ),
        );
        return [{ id }];
      }
      if (info === 'COIL' || info === 'NCOIL' || info === 'SET' || info === 'RESET') {
        nodes.push(
          x(
            'coil',
            {
              localId: id,
              negated: info === 'NCOIL',
              storage: info === 'SET' ? 'set' : info === 'RESET' ? 'reset' : 'none',
              height: 20,
              width: 20,
            },
            P(el.id),
            conn(srcs),
            x('connectionPointOut'),
            x('variable', {}, operand),
          ),
        );
        return [{ id }];
      }
      if (info === 'JMP') {
        nodes.push(x('jump', { localId: id, label: operand, height: 20, width: 40 }, P(el.id), conn(srcs)));
        return srcs;
      }
      const def = BLOCKS[info];
      if (!def) return srcs;
      const inputs: XmlNode[] = [x('variable', { formalParameter: def.power }, conn(srcs))];
      const outputs: XmlNode[] = [x('variable', { formalParameter: def.out }, x('connectionPointOut'))];
      const isTimer = el.instr === 'TON' || el.instr === 'TOF' || el.instr === 'TP' || el.instr === 'RTO';
      let instanceName: string | undefined;
      const outVars: [string, string][] = [];
      def.ops.forEach((m, i) => {
        const text = el.operands[i] ?? '';
        if ('instance' in m) instanceName = text.trim();
        else if ('in' in m || 'inout' in m) {
          const param = 'in' in m ? m.in : m.inout;
          const vid = next++;
          nodes.push(
            x(
              'inVariable',
              { localId: vid, height: 20, width: 60 },
              x('position', { x: 0, y: yBase }),
              x('connectionPointOut'),
              x('expression', {}, expression(text, isTimer && i === 1)),
            ),
          );
          inputs.push(x('variable', { formalParameter: param }, conn([{ id: vid }])));
          if ('inout' in m) outVars.push([param, text.trim()]);
        } else {
          if (m.out !== def.out)
            outputs.push(x('variable', { formalParameter: m.out }, x('connectionPointOut')));
          outVars.push([m.out, text.trim()]);
        }
      });
      if (el.instr === 'SR' || el.instr === 'RS')
        instanceName = `${el.instr}_${(el.operands[0] ?? '').trim()}`;
      if (outVars.some(([p]) => p === 'WORD'))
        outputs.push(x('variable', { formalParameter: 'WORD' }, x('connectionPointOut')));
      nodes.push(
        x(
          'block',
          { localId: id, typeName: def.type(el), instanceName, height: 60, width: 70 },
          P(el.id),
          x('inputVariables', {}, ...inputs),
          x('inOutVariables'),
          x('outputVariables', {}, ...outputs),
        ),
      );
      for (const [param, expr] of outVars) {
        const vid = next++;
        nodes.push(
          x(
            'outVariable',
            { localId: vid, height: 20, width: 60 },
            x('position', { x: 0, y: yBase }),
            conn([{ id, param }]),
            x('expression', {}, expr),
          ),
        );
      }
      return [{ id, param: def.out }];
    };

    const walk = (series: Series, srcs: Src[]): Src[] => {
      for (const n of series) {
        if (n.kind === 'el') srcs = elementNode(n, srcs);
        else {
          const outs: Src[] = [];
          for (const b of n.branches)
            for (const s of b.length ? walk(b, srcs) : srcs)
              if (!outs.some((o) => o.id === s.id && o.param === s.param)) outs.push(s);
          srcs = outs;
        }
      }
      return srcs;
    };
    const ends = walk(rung.body, [{ id: rail }]);
    const right = next++;
    nodes.push(
      x(
        'rightPowerRail',
        { localId: right, height: layout.rows * CELL_Y, width: 10 },
        x('position', { x: 60 + layout.cols * CELL_X, y: yBase }),
        ...ends.filter((s) => s.id !== rail).map((s) => conn([s])),
      ),
    );
    yBase += layout.rows * CELL_Y + 40;
  });

  return x(
    'pou',
    { name: prog.name, pouType: 'program' },
    x('interface', {}, x('localVars')),
    x('body', {}, x('LD', {}, ...nodes)),
  );
}

/** Timer/counter block type actually used with each tag (TON by default). */
function instanceTypes(project: Project): Map<string, string> {
  const m = new Map<string, string>();
  for (const prog of project.programs)
    for (const r of prog.rungs)
      forEachElement(r.body, (el) => {
        const def = BLOCKS[el.instr];
        if (def && def.ops[0] && 'instance' in def.ops[0]) {
          const name = (el.operands[0] ?? '').trim();
          if (name && !m.has(name)) m.set(name, def.type(el));
        }
      });
  return m;
}

export function exportPlcopen(project: Project): string {
  const iecProject = { ...project, dialect: 'iec' as const };
  const types = instanceTypes(project);
  const vars = project.tags.map((t) =>
    x(
      'variable',
      { name: t.name, address: tagAddress(t, iecProject) || undefined },
      x('type', {}, iecType(t.type, types.get(t.name) ?? 'TON', types.get(t.name) ?? 'CTU')),
      t.initial !== undefined &&
        x(
          'initialValue',
          {},
          x('simpleValue', {
            value: typeof t.initial === 'boolean' ? (t.initial ? 'TRUE' : 'FALSE') : String(t.initial),
          }),
        ),
      t.comment && x('documentation', {}, x('xhtml:p', {}, cdata(t.comment))),
    ),
  );
  const mains = project.programs.filter((p) => p.kind !== 'sub');
  const doc = x(
    'project',
    { xmlns: 'http://www.plcopen.org/xml/tc6_0201', 'xmlns:xhtml': 'http://www.w3.org/1999/xhtml' },
    x('fileHeader', {
      companyName: 'LADDER IDE',
      productName: 'LADDER IDE',
      productVersion: '1',
      creationDateTime: new Date().toISOString().slice(0, 19),
    }),
    x(
      'contentHeader',
      { name: project.meta.name },
      x(
        'coordinateInfo',
        {},
        x('fbd', {}, x('scaling', { x: 1, y: 1 })),
        x('ld', {}, x('scaling', { x: 1, y: 1 })),
        x('sfc', {}, x('scaling', { x: 1, y: 1 })),
      ),
    ),
    x('types', {}, x('dataTypes'), x('pous', {}, ...project.programs.map((p) => exportPou(p)))),
    x(
      'instances',
      {},
      x(
        'configurations',
        {},
        x(
          'configuration',
          { name: 'Config' },
          x(
            'resource',
            { name: 'Resource' },
            x(
              'task',
              { name: 'MainTask', priority: 0, interval: formatTime(project.sim.scanTimeMs) },
              ...mains.map((p) => x('pouInstance', { name: `${p.name}_inst`, typeName: p.name })),
            ),
            x('globalVars', {}, ...vars),
          ),
        ),
      ),
    ),
  );
  return `<?xml version="1.0" encoding="utf-8"?>\n${renderXml(doc)}\n`;
}

// ------------------------------------------------------------------ import

export interface PlcopenImport {
  project: Project;
  warnings: string[];
}

interface Ref {
  id: string;
  param?: string;
}

interface GNode {
  id: string;
  el: XmlElement;
  kind:
    | 'contact'
    | 'coil'
    | 'block'
    | 'jump'
    | 'left'
    | 'right'
    | 'inVar'
    | 'outVar'
    | 'label'
    | 'comment'
    | 'other';
  x: number;
  y: number;
  /** Connections per formal parameter ('' for plain connection points). */
  ins: Map<string, Ref[]>;
}

const KIND: Record<string, GNode['kind']> = {
  contact: 'contact',
  coil: 'coil',
  block: 'block',
  jump: 'jump',
  leftPowerRail: 'left',
  rightPowerRail: 'right',
  inVariable: 'inVar',
  outVariable: 'outVar',
  label: 'label',
  comment: 'comment',
};

const refsOf = (cpi: XmlElement | undefined): Ref[] =>
  children(cpi, 'connection').map((c) => ({
    id: c.attrs.refLocalId ?? '',
    param: c.attrs.formalParameter || undefined,
  }));

function parseTypeEl(typeEl: XmlElement | undefined): { type: DataType | null; derived?: string } {
  const t = typeEl?.children[0];
  if (!t) return { type: null };
  if (t.name === 'derived') {
    const n = (t.attrs.name ?? '').toUpperCase();
    if (['TON', 'TOF', 'TP', 'TONR', 'RTO'].includes(n)) return { type: 'TIMER', derived: n };
    if (['CTU', 'CTD', 'CTUD'].includes(n)) return { type: 'COUNTER', derived: n };
    return { type: null, derived: n };
  }
  const map: Record<string, DataType> = {
    BOOL: 'BOOL',
    INT: 'INT',
    SINT: 'INT',
    UINT: 'INT',
    WORD: 'INT',
    BYTE: 'INT',
    USINT: 'INT',
    DINT: 'DINT',
    UDINT: 'DINT',
    DWORD: 'DINT',
    REAL: 'REAL',
    LREAL: 'REAL',
  };
  return { type: map[t.name.toUpperCase()] ?? null, derived: t.name };
}

export function importPlcopen(xml: string): PlcopenImport {
  const warnings: string[] = [];
  const root = parseXml(xml);
  if (root.name !== 'project')
    throw new Error('Não é um arquivo PLCopen XML (elemento raiz <project> ausente).');
  const project = createProject(
    child(root, 'contentHeader')?.attrs.name || 'Projeto importado (PLCopen)',
    'iec',
  );
  project.hardware.modules = project.hardware.modules.filter((m) => m.kind === 'PS' || m.kind === 'CPU');
  project.tags = [];
  const iec = getDialect('iec');

  // Variables: global and POU-level, deduplicated by name.
  const seen = new Set<string>();
  for (const v of descendants(root, 'variable')) {
    const name = v.attrs.name;
    if (!name || seen.has(name) || !child(v, 'type')) continue;
    seen.add(name);
    const { type, derived } = parseTypeEl(child(v, 'type'));
    if (!type) {
      if (!['SR', 'RS'].includes(derived ?? ''))
        warnings.push(`Variável ${name}: tipo ${derived ?? '?'} não suportado (ignorada).`);
      continue;
    }
    const tag: Tag = { name, type };
    const addr = v.attrs.address ? iec.parseAddress(v.attrs.address) : null;
    if (addr) tag.address = addr.address;
    else if (v.attrs.address) warnings.push(`Variável ${name}: endereço ${v.attrs.address} não reconhecido.`);
    const init = descendants(v, 'simpleValue')[0]?.attrs.value;
    if (init !== undefined && type !== 'TIMER' && type !== 'COUNTER')
      tag.initial = type === 'BOOL' ? /^(true|1)$/i.test(init) : Number(init) || 0;
    const docText = descendants(v, 'p')[0]?.text.trim() || child(v, 'documentation')?.text.trim();
    if (docText) tag.comment = docText;
    project.tags.push(tag);
  }

  const pous = descendants(root, 'pou');
  const pouNames = new Set(pous.map((p) => p.attrs.name ?? ''));
  const taskOrder = descendants(root, 'pouInstance').map((pi) => pi.attrs.typeName ?? '');
  const programs: Program[] = [];
  for (const pou of pous) {
    const name = pou.attrs.name ?? 'POU';
    if (pou.attrs.pouType && pou.attrs.pouType !== 'program') {
      warnings.push(`POU ${name} (${pou.attrs.pouType}) ignorada: só programas são importados.`);
      continue;
    }
    const ld = child(child(pou, 'body'), 'LD');
    if (!ld) {
      warnings.push(`Programa ${name}: corpo não é Ladder (LD), ignorado.`);
      continue;
    }
    programs.push({
      id: newId('g_'),
      name,
      rungs: importLd(ld, pouNames, warnings, name),
      ...(taskOrder.includes(name) ? {} : { kind: 'sub' as const }),
    });
  }
  if (!programs.length) throw new Error('Nenhum programa em Ladder (LD) encontrado no arquivo.');
  programs.sort((a, b) => {
    const ia = taskOrder.indexOf(a.name);
    const ib = taskOrder.indexOf(b.name);
    return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
  });
  project.programs = programs;

  // Operands referring to unknown variables become BOOL / numeric tags, like the editor does.
  const known = new Set(project.tags.map((t) => t.name));
  for (const prog of programs)
    for (const r of prog.rungs)
      forEachElement(r.body, (el) =>
        el.operands.forEach((o, i) => {
          const p = parseOperand(o);
          if (
            p.kind !== 'tag' ||
            known.has(p.name) ||
            el.instr === 'JMP' ||
            el.instr === 'LBL' ||
            el.instr === 'CALL'
          )
            return;
          const spec = BLOCKS[el.instr]?.ops[i];
          const type: DataType =
            spec && 'instance' in spec
              ? el.instr.startsWith('CT')
                ? 'COUNTER'
                : 'TIMER'
              : ['NO', 'NC', 'POS', 'NEG', 'COIL', 'NCOIL', 'SET', 'RESET', 'SR', 'RS'].includes(el.instr) &&
                  i === 0
                ? 'BOOL'
                : 'INT';
          project.tags.push({ name: p.name, type });
          known.add(p.name);
          warnings.push(`Tag ${p.name} não declarada no arquivo: criada como ${type}.`);
        }),
      );
  return { project, warnings };
}

function importLd(ld: XmlElement, pouNames: Set<string>, warnings: string[], pouName: string): Rung[] {
  const nodes = new Map<string, GNode>();
  for (const el of ld.children) {
    const kind = KIND[el.name] ?? 'other';
    const id = el.attrs.localId ?? '';
    const p = child(el, 'position');
    const ins = new Map<string, Ref[]>();
    if (kind === 'block') {
      for (const v of [
        ...children(child(el, 'inputVariables'), 'variable'),
        ...children(child(el, 'inOutVariables'), 'variable'),
      ])
        ins.set(v.attrs.formalParameter ?? '', refsOf(child(v, 'connectionPointIn')));
    } else ins.set('', children(el, 'connectionPointIn').flatMap(refsOf));
    nodes.set(id, { id, el, kind, x: Number(p?.attrs.x ?? 0), y: Number(p?.attrs.y ?? 0), ins });
  }

  const blockDef = (n: GNode): { instr: InstructionId | null; def: BlockDef | null } => {
    const typeName = n.el.attrs.typeName ?? '';
    const instr = TYPE_TO_INSTR[typeName.toUpperCase()] ?? (pouNames.has(typeName) ? 'CALL' : null);
    return { instr, def: instr ? (BLOCKS[instr] ?? null) : null };
  };
  const powerRefs = (n: GNode): Ref[] => {
    if (n.kind === 'block') {
      const { def } = blockDef(n);
      return n.ins.get(def?.power ?? 'EN') ?? n.ins.get('EN') ?? [];
    }
    return n.ins.get('') ?? [];
  };
  const isPower = (n: GNode) =>
    n.kind === 'contact' || n.kind === 'coil' || n.kind === 'block' || n.kind === 'jump';
  const expr = (id: string) => {
    const n = nodes.get(id);
    return n?.kind === 'inVar' ? (child(n.el, 'expression')?.text.trim() ?? '') : '';
  };

  // Converts a graph node into an element (once: shared nodes keep the same element).
  const elements = new Map<string, Element>();
  const nodeOfElement = new Map<string, string>();
  const toElement = (n: GNode): Element => {
    const cached = elements.get(n.id);
    if (cached) return cached;
    let el: Element;
    const variable = child(n.el, 'variable')?.text.trim() ?? '';
    if (n.kind === 'contact') {
      const neg = n.el.attrs.negated === 'true';
      const edge = n.el.attrs.edge ?? 'none';
      if (neg && edge !== 'none')
        warnings.push(`${pouName}: contato negado com borda (${variable}) importado como borda simples.`);
      el = createElement(edge === 'rising' ? 'POS' : edge === 'falling' ? 'NEG' : neg ? 'NC' : 'NO', [
        variable,
      ]);
    } else if (n.kind === 'coil') {
      const storage = n.el.attrs.storage ?? 'none';
      el = createElement(
        storage === 'set'
          ? 'SET'
          : storage === 'reset'
            ? 'RESET'
            : n.el.attrs.negated === 'true'
              ? 'NCOIL'
              : 'COIL',
        [variable],
      );
    } else if (n.kind === 'jump') {
      el = createElement('JMP', [n.el.attrs.label ?? '']);
    } else {
      const { instr, def } = blockDef(n);
      if (!instr || !def) {
        warnings.push(
          `${pouName}: bloco ${n.el.attrs.typeName} não suportado (substituído por um contato sempre fechado).`,
        );
        el = createElement('NO', ['1']);
      } else {
        const outVarFor = (param: string) => {
          for (const m of nodes.values())
            if (
              m.kind === 'outVar' &&
              (m.ins.get('') ?? []).some((r) => r.id === n.id && (r.param ?? '') === param)
            )
              return child(m.el, 'expression')?.text.trim() ?? '';
          return '';
        };
        const operands = def.ops.map((m) => {
          if ('instance' in m) return n.el.attrs.instanceName ?? '';
          if ('in' in m) return expr(n.ins.get(m.in)?.[0]?.id ?? '');
          if ('inout' in m) return expr(n.ins.get(m.inout)?.[0]?.id ?? '') || outVarFor(m.inout);
          return outVarFor(m.out);
        });
        el = createElement(instr, instr === 'CALL' ? [n.el.attrs.typeName ?? ''] : operands);
      }
    }
    elements.set(n.id, el);
    nodeOfElement.set(el.id, n.id);
    return el;
  };

  // Path (series) feeding a set of refs.
  const keyOf = (node: LadderNode): string =>
    node.kind === 'el'
      ? `E${nodeOfElement.get(node.id) ?? node.id}`
      : `P(${node.branches.map((b) => b.map(keyOf).join(',')).join('|')})`;
  const merge = (list: Series[]): Series => {
    const nonEmpty = list.filter((s) => s.length);
    if (!nonEmpty.length) return [];
    const groups = new Map<string, Series[]>();
    for (const s of nonEmpty) {
      const k = keyOf(s[0]!);
      groups.set(k, [...(groups.get(k) ?? []), s]);
    }
    if (groups.size === 1 && nonEmpty.length === list.length) {
      const [g] = groups.values();
      return [g![0]![0]!, ...merge(g!.map((s) => s.slice(1)))];
    }
    const branches = [...groups.values()].map((g) => merge(g));
    if (nonEmpty.length < list.length) branches.push([]);
    return [{ kind: 'par', id: newId('p_'), branches }];
  };
  const visiting = new Set<string>();
  const seriesFor = (refs: Ref[]): Series => {
    const paths: Series[] = [];
    for (const r of refs) {
      const n = nodes.get(r.id);
      if (!n || n.kind === 'left') {
        paths.push([]);
        continue;
      }
      if (!isPower(n) || visiting.has(n.id)) continue;
      visiting.add(n.id);
      paths.push([...seriesFor(powerRefs(n)), toElement(n)]);
      visiting.delete(n.id);
    }
    return paths.length ? merge(paths) : [];
  };

  // Sinks: power elements with no power successor.
  const fed = new Set<string>();
  for (const n of nodes.values()) if (isPower(n)) for (const r of powerRefs(n)) fed.add(r.id);
  const sinks = [...nodes.values()].filter((n) => isPower(n) && !fed.has(n.id));

  // One rung per group of sinks that share the start of their path.
  const groups = new Map<string, { paths: Series[]; y: number }>();
  for (const s of sinks) {
    const path = [...seriesFor(powerRefs(s)), toElement(s)];
    const k = keyOf(path[0]!);
    const g = groups.get(k) ?? { paths: [], y: Infinity };
    g.paths.push(path);
    g.y = Math.min(g.y, s.y);
    groups.set(k, g);
  }
  const rungs = [...groups.values()]
    .map((g) => ({
      y: Math.min(g.y, ...g.paths.flat().map((n) => yOfNode(n))),
      rung: newRung(merge(g.paths)),
    }))
    .sort((a, b) => a.y - b.y);

  function yOfNode(node: LadderNode): number {
    if (node.kind === 'par') return Math.min(...node.branches.flat().map(yOfNode), Infinity);
    const id = nodeOfElement.get(node.id);
    return id ? (nodes.get(id)?.y ?? Infinity) : Infinity;
  }

  // Labels and comments go to the first rung at or below them.
  const attach = (y: number) => rungs.find((r) => r.y >= y - 1) ?? rungs[rungs.length - 1];
  for (const n of nodes.values()) {
    if (n.kind === 'label') {
      const target = attach(n.y);
      const lbl = createElement('LBL', [n.el.attrs.label ?? '']);
      if (target) target.rung.body.unshift(lbl);
      else rungs.push({ y: n.y, rung: newRung([lbl]) });
    } else if (n.kind === 'comment') {
      const text = descendants(n.el, 'p')[0]?.text.trim() || child(n.el, 'content')?.text.trim();
      const target = attach(n.y);
      if (target && text)
        target.rung.comment = target.rung.comment ? `${text}\n${target.rung.comment}` : text;
    }
  }
  return rungs.map((r) => r.rung);
}
