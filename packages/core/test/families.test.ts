import { describe, expect, it } from 'vitest';
import {
  applyScenario,
  createModule,
  createProject,
  DIALECTS,
  el,
  FAMILIES,
  ioList,
  nextFreeSlot,
  parseProject,
  rung,
  SCENARIOS,
  setPlcModel,
  tagAddress,
  validateProject,
  type Address,
  type DataType,
  type FamilyId,
  type Project,
} from '../src/index.ts';

function withModel(family: FamilyId, cpu: string): Project {
  const p = createProject();
  setPlcModel(p, family, cpu);
  return p;
}

function addModule(p: Project, catalogId: string) {
  const slot = nextFreeSlot(p.hardware);
  if (slot === null) throw new Error('rack full');
  p.hardware.modules.push(createModule(catalogId, slot, p.hardware));
}

const addresses = (p: Project, kind: string) =>
  ioList(p)
    .filter((r) => r.kind === kind)
    .map((r) => r.address);

describe('Siemens S7-1200', () => {
  it('CPU 1214C on-board I/O follows the manual (14 DI / 10 DO / 2 AI)', () => {
    const p = withModel('s7-1200', '1214C');
    expect(p.dialect).toBe('siemens');
    const di = addresses(p, 'DI');
    expect(di).toHaveLength(14);
    expect(di[0]).toBe('I0.0');
    expect(di[13]).toBe('I1.5');
    expect(addresses(p, 'DO').at(-1)).toBe('Q1.1');
    expect(addresses(p, 'AI')).toEqual(['IW64', 'IW66']);
  });

  it('first signal module (slot 2) starts at byte 8', () => {
    const p = withModel('s7-1200', '1214C');
    addModule(p, 'sm1221-di8');
    addModule(p, 'sm1231-ai4');
    expect(addresses(p, 'DI').slice(14)).toEqual([
      'I8.0',
      'I8.1',
      'I8.2',
      'I8.3',
      'I8.4',
      'I8.5',
      'I8.6',
      'I8.7',
    ]);
    expect(addresses(p, 'AI').slice(2, 4)).toEqual(['IW112', 'IW114']);
  });

  it('respects the number of signal modules per CPU', () => {
    expect(nextFreeSlot(withModel('s7-1200', '1211C').hardware)).toBeNull();
    const p = withModel('s7-1200', '1212C');
    addModule(p, 'sm1221-di8');
    addModule(p, 'sm1221-di8');
    expect(nextFreeSlot(p.hardware)).toBeNull();
  });
});

describe('Allen-Bradley MicroLogix', () => {
  it('embedded I/O is slot 0, expansion modules are slots 1..7 in order', () => {
    const p = withModel('micrologix', '1766-L32BWA');
    expect(p.dialect).toBe('ab');
    expect(addresses(p, 'DI').at(-1)).toBe('I:0/19');
    expect(addresses(p, 'DO').at(-1)).toBe('O:0/11');
    addModule(p, '1762-IQ8');
    addModule(p, '1762-IF4');
    expect(addresses(p, 'DI').at(20)).toBe('I:1/0');
    expect(addresses(p, 'AI')).toEqual(['I:2.0', 'I:2.1', 'I:2.2', 'I:2.3']);
  });

  it('MicroLogix 1100 accepts 4 modules and warns about unsupported instructions', () => {
    const p = withModel('micrologix', '1763-L16BWA');
    for (let i = 0; i < 4; i++) addModule(p, '1762-IQ8');
    expect(nextFreeSlot(p.hardware)).toBeNull();
    p.tags.push({ name: 'A', type: 'BOOL' }, { name: 'T1', type: 'TIMER' });
    p.programs[0]!.rungs = [rung([el('NO', 'A'), el('TP', 'T1', 'T#1s')])];
    const codes = validateProject(p).map((d) => d.code);
    expect(codes).toContain('unsupportedInstruction');
  });
});

describe('Schneider M221', () => {
  it('embedded %I0.z and expansion %Iy.z addressing', () => {
    const p = withModel('m221', 'TM221CE24R');
    expect(p.dialect).toBe('schneider');
    expect(addresses(p, 'DI')).toHaveLength(14);
    expect(addresses(p, 'DI').at(-1)).toBe('%I0.13');
    expect(addresses(p, 'AI')).toEqual(['%IW0.0', '%IW0.1']);
    addModule(p, 'TM3DI8');
    addModule(p, 'TM3DQ8R');
    expect(addresses(p, 'DI').at(14)).toBe('%I1.0');
    expect(addresses(p, 'DO').at(10)).toBe('%Q2.0');
  });
});

describe('Haiwell', () => {
  it('C series has no expansion, T series up to 7 modules with continuous X/Y numbering', () => {
    expect(nextFreeSlot(withModel('haiwell', 'C24S0R').hardware)).toBeNull();
    const p = withModel('haiwell', 'T24S0R');
    expect(p.dialect).toBe('haiwell');
    expect(addresses(p, 'DI')).toEqual(Array.from({ length: 16 }, (_, i) => `X${i}`));
    expect(addresses(p, 'DO').at(-1)).toBe('Y7');
    addModule(p, 'H08DI');
    addModule(p, 'S04AI');
    expect(addresses(p, 'DI').at(16)).toBe('X16');
    expect(addresses(p, 'AI')[0]).toBe('AI0');
  });
});

describe('changing the PLC model', () => {
  it('re-binds I/O tags and keeps fitting expansion modules', () => {
    const p = createProject();
    applyScenario(p, 'motor', true);
    setPlcModel(p, 's7-1200', '1214C');
    const start = p.tags.find((t) => t.name === 'B_START')!;
    const motor = p.tags.find((t) => t.name === 'K_MOTOR')!;
    expect(tagAddress(start, p)).toBe('I0.0');
    expect(tagAddress(motor, p)).toBe('Q0.0');
    addModule(p, 'sm1221-di16');
    setPlcModel(p, 's7-1200', '1212C'); // keeps the SM (1212C allows 2)
    expect(p.hardware.modules.filter((m) => m.kind === 'DI' && !m.embedded)).toHaveLength(1);
    setPlcModel(p, 's7-1200', '1211C'); // no SM allowed
    expect(p.hardware.modules.filter((m) => !m.embedded && m.kind !== 'CPU')).toHaveLength(0);
    expect(validateProject(p).filter((d) => d.severity === 'error')).toEqual([]);
    setPlcModel(p, 'generic');
    expect(p.hardware.family).toBe('generic');
    // The generic rack keeps the current dialect (Siemens here).
    expect(p.dialect).toBe('siemens');
    expect(
      tagAddress(
        p.tags.find((t) => t.name === 'B_START')!,
        p,
      ),
    ).toBe('I0.0');
  });

  it('every scenario binds its I/O on every expandable family', () => {
    const models: [FamilyId, string][] = [
      ['s7-1200', '1214C'],
      ['micrologix', '1766-L32BWA'],
      ['m221', 'TM221CE24R'],
      ['haiwell', 'T24S0R'],
    ];
    for (const [fam, cpu] of models)
      for (const sc of SCENARIOS) {
        const p = withModel(fam, cpu);
        applyScenario(p, sc.id, true);
        for (const def of sc.tags.filter((d) => d.io !== 'MEM'))
          expect(p.tags.find((t) => t.name === def.name)?.io, `${fam} ${sc.id} ${def.name}`).toBeDefined();
        expect(
          validateProject(p).filter((d) => d.severity === 'error'),
          `${fam} ${sc.id}`,
        ).toEqual([]);
      }
  });

  it('documents sources for every family', () => {
    for (const f of FAMILIES) {
      expect(f.sources.length, f.id).toBeGreaterThan(0);
      expect(f.cpus.length, f.id).toBeGreaterThan(0);
    }
  });
});

describe('migration and new dialects', () => {
  it('upgrades v1 projects to the generic family', () => {
    const p = createProject() as unknown as Record<string, any>;
    p.schemaVersion = 1;
    delete p.hardware.family;
    const r = parseProject(JSON.parse(JSON.stringify(p)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.project.hardware.family).toBe('generic');
  });

  const cases: [Address, DataType, Record<string, string>][] = [
    [{ area: 'M', index: 1, bit: 9 }, 'BOOL', { schneider: '%M25', haiwell: 'M25' }],
    [{ area: 'M', index: 15 }, 'INT', { schneider: '%MW15', haiwell: 'V15' }],
    [{ area: 'I', index: 0, bit: 5 }, 'BOOL', { schneider: '%I0.5', haiwell: 'X5' }],
    [{ area: 'T', index: 5 }, 'TIMER', { schneider: '%TM5', haiwell: 'T5' }],
    [{ area: 'C', index: 2 }, 'COUNTER', { schneider: '%C2', haiwell: 'C2' }],
  ];
  for (const [addr, type, expected] of cases)
    for (const [id, text] of Object.entries(expected))
      it(`${id}: ${text} round-trips`, () => {
        const d = DIALECTS[id as 'schneider' | 'haiwell'];
        expect(d.formatAddress(addr, type)).toBe(text);
        expect(d.parseAddress(text)).toEqual({ address: addr, type });
      });

  it('Schneider member names', () => {
    expect(DIALECTS.schneider.memberName('ACC', 'TIMER')).toBe('V');
    expect(DIALECTS.schneider.memberName('DN', 'COUNTER')).toBe('D');
  });
});

describe('re-binding keeps channel numbers', () => {
  it('input 3 stays input 3 when switching families', () => {
    const p = withModel('s7-1200', '1214C');
    const di = p.hardware.modules.find((m) => m.kind === 'DI')!;
    p.tags.push({ name: 'S3', type: 'BOOL', io: { module: di.id, channel: 3 } });
    setPlcModel(p, 'm221', 'TM221CE16R');
    expect(tagAddress(p.tags[0]!, p)).toBe('%I0.3');
    setPlcModel(p, 'haiwell', 'C10S0R');
    expect(tagAddress(p.tags[0]!, p)).toBe('X3');
  });
});
