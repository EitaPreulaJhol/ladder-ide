import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import type { Project } from '@ladder/core';
import { shares } from './db/schema.ts';

export interface ShareRecord {
  id: string;
  title: string;
  project: Project;
  createdAt: Date;
}

export interface ShareStore {
  create(rec: ShareRecord): Promise<void>;
  get(id: string): Promise<ShareRecord | null>;
  close(): Promise<void>;
}

/** In-memory store for tests and quick local runs without PostgreSQL. */
export class MemoryShareStore implements ShareStore {
  private map = new Map<string, ShareRecord>();
  async create(rec: ShareRecord) {
    if (this.map.has(rec.id)) throw new Error('duplicate id');
    this.map.set(rec.id, structuredClone(rec));
  }
  async get(id: string) {
    const r = this.map.get(id);
    return r ? structuredClone(r) : null;
  }
  async close() {}
}

export class PgShareStore implements ShareStore {
  private db: NodePgDatabase;
  private pool: pg.Pool;
  private constructor(pool: pg.Pool) {
    this.pool = pool;
    this.db = drizzle(pool);
  }

  static async connect(url: string): Promise<PgShareStore> {
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    const store = new PgShareStore(pool);
    await migrate(store.db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
    return store;
  }

  async create(rec: ShareRecord) {
    await this.db.insert(shares).values({
      id: rec.id,
      title: rec.title,
      schemaVersion: rec.project.schemaVersion,
      project: rec.project,
      createdAt: rec.createdAt,
    });
  }

  async get(id: string) {
    const rows = await this.db.select().from(shares).where(eq(shares.id, id)).limit(1);
    const r = rows[0];
    return r ? { id: r.id, title: r.title, project: r.project as Project, createdAt: r.createdAt } : null;
  }

  async close() {
    await this.pool.end();
  }
}
