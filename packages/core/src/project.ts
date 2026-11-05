import type { DialectId, Project } from './model.ts';
import { SCHEMA_VERSION } from './model.ts';
import { defaultHardware } from './hardware.ts';
import { newId } from './ids.ts';
import { program, rung } from './build.ts';

export function createProject(name = 'Novo projeto', dialect: DialectId = 'iec'): Project {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId('prj_', 12),
    meta: { name, createdAt: now, updatedAt: now },
    dialect,
    tags: [],
    programs: [program('Principal', [rung([])])],
    hardware: defaultHardware(),
    ioPanel: [],
    sim: { scanTimeMs: 10 },
  };
}

/** Copy of a project with a fresh id (used for forks and "save as"). */
export function forkProject(p: Project, forkedFrom?: string): Project {
  const now = new Date().toISOString();
  const copy = structuredClone(p);
  copy.id = newId('prj_', 12);
  copy.meta = { ...copy.meta, createdAt: now, updatedAt: now, ...(forkedFrom ? { forkedFrom } : {}) };
  return copy;
}
