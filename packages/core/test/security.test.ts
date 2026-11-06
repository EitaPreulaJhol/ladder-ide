import { describe, expect, it } from 'vitest';
import {
  cleanTitle,
  createGrafcet,
  createProject,
  descendants,
  escapeRegExp,
  importPlcopen,
  MAX_XML_DEPTH,
  parseProject,
  parseXml,
  renameTag,
  syncGrafcet,
} from '../src/index.ts';

const plcopenWithVar = (name: string) => `<?xml version="1.0"?>
<project xmlns="http://www.plcopen.org/xml/tc6_0201"><contentHeader name="x"/><types><pous>
<pou name="main" pouType="program">
<interface><localVars>
  <variable name="${name}"><type><BOOL/></type></variable>
  <variable name="OK"><type><BOOL/></type></variable>
</localVars></interface>
<body><LD><leftPowerRail localId="1"><position x="0" y="0"/></leftPowerRail>
<contact localId="2"><position x="0" y="0"/><connectionPointIn><connection refLocalId="1"/></connectionPointIn><variable>OK</variable></contact>
<coil localId="3"><position x="0" y="0"/><connectionPointIn><connection refLocalId="2"/></connectionPointIn><variable>OK</variable></coil>
</LD></body></pou></pous></types></project>`;

describe('untrusted input hardening', () => {
  it('project titles lose control, zero-width and bidi-override characters', () => {
    expect(cleanTitle(' Motor\u202Etxt.exe\u200B\u0000 ')).toBe('Motortxt.exe');
    expect(cleanTitle('Partida estrela-triângulo ✓')).toBe('Partida estrela-triângulo ✓');
    const p = createProject();
    p.meta.name = 'A\u2066B';
    const r = parseProject(JSON.parse(JSON.stringify(p)));
    expect(r.ok && r.project.meta.name).toBe('AB');
  });

  it('escapeRegExp makes metacharacters literal', () => {
    for (const s of ['(', '[', 'a.*', 'a.*.*.*.*.*.*b', 'G(', '$&', '\\'])
      expect(new RegExp(`^${escapeRegExp(s)}$`).test(s)).toBe(true);
    expect(new RegExp(escapeRegExp('a.*')).test('ab')).toBe(false);
  });

  it('renameTag treats names literally in GRAFCET conditions', () => {
    const p = createProject();
    p.tags.push({ name: 'a.*', type: 'BOOL' }, { name: '(', type: 'BOOL' });
    const g = createGrafcet(p, 'G');
    g.transitions[0]!.condition = 'a & victim';
    renameTag(p, 'a.*', 'renamed');
    expect(g.transitions[0]!.condition).toBe('a & victim');
    expect(() => renameTag(p, '(', 'X')).not.toThrow();
    // `$&` in the new name is not a replacement pattern.
    p.tags.push({ name: 'A', type: 'BOOL' });
    g.transitions[0]!.condition = 'A & B';
    renameTag(p, 'A', 'Z$&');
    expect(g.transitions[0]!.condition).toBe('Z$& & B');
  });

  it('syncGrafcet tolerates a prefix with regex metacharacters', () => {
    const p = createProject();
    const g = createGrafcet(p, 'G');
    g.prefix = 'G(';
    expect(() => syncGrafcet(p, g.id)).not.toThrow();
  });

  it('PLCopen import skips variables with invalid names', () => {
    for (const bad of ['(', 'a.*', 'a.*.*.*.*.*.*b', '1abc']) {
      const { project, warnings } = importPlcopen(plcopenWithVar(bad));
      expect(project.tags.map((t) => t.name)).toEqual(['OK']);
      expect(warnings.some((w) => w.includes('nome inválido'))).toBe(true);
      expect(parseProject(JSON.parse(JSON.stringify(project))).ok).toBe(true);
    }
  });

  it('rejects deeply nested XML instead of overflowing the stack', () => {
    const deep = (n: number) =>
      `<project><contentHeader name="x"/>${'<a>'.repeat(n)}${'</a>'.repeat(n)}<types><pous/></types></project>`;
    expect(() => importPlcopen(deep(50_000))).toThrow(/aninhamento/);
    expect(() => parseXml(deep(MAX_XML_DEPTH - 2))).not.toThrow();
  });

  it('descendants is iterative and keeps document order', () => {
    const root = parseXml('<r><v n="1"><v n="2"/></v><x><v n="3"/></x><v n="4"/></r>');
    expect(descendants(root, 'v').map((v) => v.attrs.n)).toEqual(['1', '2', '3', '4']);
  });

  it('rejects series chains too long to walk', () => {
    const n = 1500;
    const els = Array.from(
      { length: n },
      (_, i) =>
        `<contact localId="${i + 2}"><position x="0" y="0"/><connectionPointIn><connection refLocalId="${i + 1}"/></connectionPointIn><variable>OK</variable></contact>`,
    ).join('');
    const xml = plcopenWithVar('OK2').replace(
      /<body><LD>[\s\S]*<\/LD>/,
      `<body><LD><leftPowerRail localId="1"/>${els}</LD>`,
    );
    expect(() => importPlcopen(xml)).toThrow(/série/);
  });
});
