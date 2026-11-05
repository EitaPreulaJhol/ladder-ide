import { describe, expect, it } from 'vitest';
import {
  autoModbusMap,
  checkModbusMap,
  EXAMPLES,
  modbusReference,
  parseProject,
  tag,
  createProject,
} from '../src/index.ts';

describe('Modbus map', () => {
  it('maps bits to coils and numbers to holding registers (DINT/REAL take 2)', () => {
    const p = createProject();
    p.tags = [
      tag('A', 'BOOL'),
      tag('N', 'INT'),
      tag('B', 'BOOL'),
      tag('R', 'REAL'),
      tag('M', 'INT'),
      tag('T1', 'TIMER'),
    ];
    const map = autoModbusMap(p);
    expect(map).toEqual([
      { tag: 'A', area: 'coil', address: 0 },
      { tag: 'N', area: 'holding', address: 0 },
      { tag: 'B', area: 'coil', address: 1 },
      { tag: 'R', area: 'holding', address: 1 },
      { tag: 'M', area: 'holding', address: 3 },
    ]);
    expect(checkModbusMap(p, map)).toEqual([]);
    expect(modbusReference({ area: 'holding', address: 0 })).toBe('400001');
    expect(modbusReference({ area: 'coil', address: 9 })).toBe('000010');
  });

  it('flags unknown tags, wrong areas and overlaps', () => {
    const p = createProject();
    p.tags = [tag('A', 'BOOL'), tag('R', 'REAL'), tag('N', 'INT')];
    const issues = checkModbusMap(p, [
      { tag: 'X', area: 'coil', address: 0 },
      { tag: 'A', area: 'holding', address: 10 },
      { tag: 'R', area: 'holding', address: 0 },
      { tag: 'N', area: 'holding', address: 1 },
    ]);
    expect(issues.map((i) => i.code).sort()).toEqual(['overlap', 'unknownTag', 'wrongArea']);
  });

  it('is saved with the project', () => {
    const p = EXAMPLES[0]!.build();
    p.modbus = { map: autoModbusMap(p) };
    const r = parseProject(JSON.parse(JSON.stringify(p)));
    expect(r.ok && r.project.modbus).toEqual(p.modbus);
  });
});
