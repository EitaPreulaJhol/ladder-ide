/**
 * Modbus TCP mapping of tags (used by the local bridge in apps/bridge).
 * Bits go to coils (read/write) or discrete inputs (read-only); numbers go to
 * holding registers (read/write) or input registers (read-only). DINT and REAL
 * use two consecutive registers, high word first (the most common convention).
 */
import type { DataType, ModbusArea, ModbusEntry, Project } from './model.ts';

export const isBitArea = (a: ModbusArea) => a === 'coil' || a === 'discrete';
export const isWritableArea = (a: ModbusArea) => a === 'coil' || a === 'holding';
export const registerCount = (t: DataType | undefined) => (t === 'DINT' || t === 'REAL' ? 2 : 1);

/** Traditional 5/6-digit reference shown to users (00001, 10001, 40001, 30001). */
export function modbusReference(e: Pick<ModbusEntry, 'area' | 'address'>): string {
  const base = { coil: 0, discrete: 100000, input: 300000, holding: 400000 }[e.area];
  return String(base + e.address + 1).padStart(6, '0');
}

/** Maps every BOOL/INT/DINT/REAL tag: bits to coils, numbers to holding registers, in tag order. */
export function autoModbusMap(project: Project): ModbusEntry[] {
  const map: ModbusEntry[] = [];
  let coil = 0;
  let reg = 0;
  for (const t of project.tags) {
    if (t.type === 'BOOL') map.push({ tag: t.name, area: 'coil', address: coil++ });
    else if (t.type === 'INT' || t.type === 'DINT' || t.type === 'REAL') {
      map.push({ tag: t.name, area: 'holding', address: reg });
      reg += registerCount(t.type);
    }
  }
  return map;
}

export interface ModbusIssue {
  tag: string;
  code: 'unknownTag' | 'wrongArea' | 'overlap';
  other?: string;
}

/** Problems in a map: unknown tags, numeric tag in a bit area (or vice versa), overlapping addresses. */
export function checkModbusMap(project: Project, map: ModbusEntry[]): ModbusIssue[] {
  const issues: ModbusIssue[] = [];
  const tags = new Map(project.tags.map((t) => [t.name, t]));
  const used = new Map<string, string>();
  for (const e of map) {
    const t = tags.get(e.tag);
    if (!t) {
      issues.push({ tag: e.tag, code: 'unknownTag' });
      continue;
    }
    if (isBitArea(e.area) !== (t.type === 'BOOL')) issues.push({ tag: e.tag, code: 'wrongArea' });
    const bitSpace = isBitArea(e.area) ? 'bits' : 'regs';
    for (let i = 0; i < (isBitArea(e.area) ? 1 : registerCount(t.type)); i++) {
      // Coils share space only with coils, holding with holding, etc.
      const k = `${e.area}:${bitSpace}:${e.address + i}`;
      const other = used.get(k);
      if (other && other !== e.tag) issues.push({ tag: e.tag, code: 'overlap', other });
      used.set(k, e.tag);
    }
  }
  return issues;
}
