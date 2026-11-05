import { SCHEMA_VERSION } from './model.ts';

type Migration = (p: Record<string, unknown>) => Record<string, unknown>;

/**
 * migrations[n] upgrades a project from schemaVersion n to n + 1.
 * Add an entry here whenever the project format changes, then bump SCHEMA_VERSION.
 */
const migrations: Record<number, Migration> = {
  // v1 -> v2: hardware families. Old projects keep the free ("generic") rack.
  1: (p) => ({ ...p, hardware: { family: 'generic', ...(p.hardware as object) } }),
};

export function migrateProject(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Arquivo de projeto inválido.');
  let p = raw as Record<string, unknown>;
  let v = typeof p.schemaVersion === 'number' ? p.schemaVersion : 0;
  if (v > SCHEMA_VERSION) throw new Error('Projeto criado por uma versão mais nova da IDE.');
  while (v < SCHEMA_VERSION) {
    const m = migrations[v];
    if (!m) throw new Error(`Versão de projeto não suportada: ${v}.`);
    p = { ...m(p), schemaVersion: v + 1 };
    v++;
  }
  return p;
}
