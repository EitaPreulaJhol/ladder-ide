import { describe, expect, it } from 'vitest';
import {
  EXAMPLES,
  exportPlcopen,
  importPlcopen,
  parseProject,
  parseXml,
  runScenarioChecks,
  SCENARIOS,
  validateProject,
  type LadderNode,
  type Project,
  type Series,
} from '../src/index.ts';

const norm = (s: Series): unknown[] =>
  s.map((n: LadderNode) =>
    n.kind === 'el' ? [n.instr, ...n.operands.map((o) => o.trim())] : { par: n.branches.map(norm) },
  );

/** Structure that must survive a PLCopen round trip (ids, hardware bindings and GRAFCET are not exported). */
const essence = (p: Project) => ({
  programs: p.programs.map((g) => ({
    name: g.name,
    kind: g.kind ?? 'main',
    rungs: g.rungs.map((r) => ({ comment: r.comment ?? '', body: norm(r.body) })),
  })),
  tags: p.tags
    .map((t) => ({ name: t.name, type: t.type, comment: t.comment ?? '', initial: t.initial }))
    .sort((a, b) => a.name.localeCompare(b.name)),
});

describe('PLCopen XML', () => {
  it('exports well-formed TC6 XML with POUs, variables and a task', () => {
    const xml = exportPlcopen(EXAMPLES.find((e) => e.id === 'sealIn')!.build());
    const root = parseXml(xml);
    expect(root.name).toBe('project');
    expect(xml).toContain('xmlns="http://www.plcopen.org/xml/tc6_0201"');
    expect(xml).toContain('<leftPowerRail');
    expect(xml).toContain('<contact');
    expect(xml).toContain('<coil');
    expect(xml).toContain('address="%IX0.0"');
    expect(xml).toContain('<pouInstance name="Principal_inst" typeName="Principal"/>');
  });

  for (const ex of EXAMPLES)
    it(`round-trips "${ex.id}" without changing the program`, () => {
      const original = ex.build();
      const { project, warnings } = importPlcopen(exportPlcopen(original));
      expect(warnings).toEqual([]);
      expect(essence(project)).toEqual(essence(original));
      expect(parseProject(JSON.parse(JSON.stringify(project))).ok).toBe(true);
      expect(validateProject(project).filter((d) => d.severity === 'error')).toEqual([]);
    });

  it('imported scenario solutions still pass the automatic checks', () => {
    for (const sc of SCENARIOS) {
      const ex = EXAMPLES.find((e) => e.id === `scenario:${sc.id}`)!.build();
      const { project } = importPlcopen(exportPlcopen(ex));
      project.scenarioId = sc.id;
      const failed = runScenarioChecks(project, sc.id)
        .filter((r) => !r.passed)
        .map((r) => `${r.id}:${r.failure?.code}`);
      expect(failed, sc.id).toEqual([]);
    }
  });

  it('imports a hand-written file in the usual editor style (Beremiz / OpenPLC)', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<project xmlns="http://www.plcopen.org/xml/tc6_0201" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <contentHeader name="Externo"/>
  <types><pous>
    <pou name="main" pouType="program">
      <interface><localVars>
        <variable name="start" address="%IX0.0"><type><BOOL/></type></variable>
        <variable name="lamp" address="%QX0.0"><type><BOOL/></type><documentation><xhtml:p><![CDATA[Lâmpada & sinal]]></xhtml:p></documentation></variable>
        <variable name="T0"><type><derived name="TON"/></type></variable>
      </localVars></interface>
      <body><LD>
        <leftPowerRail localId="1"><position x="10" y="10"/><connectionPointOut formalParameter=""/></leftPowerRail>
        <contact localId="2" negated="false"><position x="50" y="10"/><connectionPointIn><connection refLocalId="1"/></connectionPointIn><connectionPointOut/><variable>start</variable></contact>
        <inVariable localId="3"><position x="80" y="40"/><connectionPointOut/><expression>T#2s</expression></inVariable>
        <block localId="4" typeName="TON" instanceName="T0"><position x="100" y="10"/>
          <inputVariables>
            <variable formalParameter="IN"><connectionPointIn><connection refLocalId="2"/></connectionPointIn></variable>
            <variable formalParameter="PT"><connectionPointIn><connection refLocalId="3"/></connectionPointIn></variable>
          </inputVariables>
          <inOutVariables/>
          <outputVariables><variable formalParameter="Q"><connectionPointOut/></variable><variable formalParameter="ET"><connectionPointOut/></variable></outputVariables>
        </block>
        <coil localId="5" negated="false"><position x="200" y="10"/><connectionPointIn><connection refLocalId="4" formalParameter="Q"/></connectionPointIn><connectionPointOut/><variable>lamp</variable></coil>
        <rightPowerRail localId="6"><position x="250" y="10"/><connectionPointIn><connection refLocalId="5"/></connectionPointIn></rightPowerRail>
      </LD></body>
    </pou>
    <pou name="calc" pouType="function"><body><ST><xhtml:p>x := 1;</xhtml:p></ST></body></pou>
  </pous></types>
  <instances><configurations><configuration name="c"><resource name="r"><task name="t" priority="0"><pouInstance name="i" typeName="main"/></task></resource></configuration></configurations></instances>
</project>`;
    const { project, warnings } = importPlcopen(xml);
    expect(project.meta.name).toBe('Externo');
    expect(norm(project.programs[0]!.rungs[0]!.body)).toEqual([
      ['NO', 'start'],
      ['TON', 'T0', 'T#2s'],
      ['COIL', 'lamp'],
    ]);
    expect(project.tags.find((t) => t.name === 'lamp')?.comment).toBe('Lâmpada & sinal');
    expect(project.tags.find((t) => t.name === 'start')?.address).toEqual({ area: 'I', index: 0, bit: 0 });
    expect(warnings.some((w) => w.includes('calc'))).toBe(true);
  });

  it('rejects files that are not PLCopen', () => {
    expect(() => importPlcopen('<html></html>')).toThrow();
    expect(() => importPlcopen('<project><unclosed></project>')).toThrow();
  });
});
