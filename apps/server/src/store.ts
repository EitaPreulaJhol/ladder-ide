import { and, desc, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import type { Project } from '@ladder/core';
import { shareReports, shares } from './db/schema.ts';

export interface ShareRecord {
  id: string;
  title: string;
  project: Project;
  createdAt: Date;
  sizeBytes: number;
  expiresAt: Date | null;
  hidden: boolean;
  reportCount: number;
}

export type NewShare = Omit<ShareRecord, 'hidden' | 'reportCount'>;

export const REPORT_REASONS = ['spam', 'offensive', 'personalData', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export interface ReportInput {
  shareId: string;
  reason: ReportReason;
  details?: string;
  /** Salted hash of the reporter (never the raw IP). */
  reporterHash: string;
}

export interface ReportResult {
  /** false when this reporter had already reported the share. */
  accepted: boolean;
  reportCount: number;
  hidden: boolean;
}

export interface ReportedShare {
  id: string;
  title: string;
  createdAt: Date;
  hidden: boolean;
  reportCount: number;
  reports: { reason: string; details: string | null; createdAt: Date }[];
}

export interface ShareStore {
  create(rec: NewShare): Promise<void>;
  get(id: string): Promise<ShareRecord | null>;
  /** Registers a report; hides the share once `hideAt` distinct reporters reported it. Null if not found. */
  report(input: ReportInput, hideAt: number): Promise<ReportResult | null>;
  listReported(): Promise<ReportedShare[]>;
  delete(id: string): Promise<boolean>;
  /** Restores a hidden share (clears its reports) or hides it manually. */
  setHidden(id: string, hidden: boolean): Promise<boolean>;
  totalBytes(): Promise<number>;
  deleteExpired(now: Date): Promise<number>;
  close(): Promise<void>;
}

/** In-memory store for tests and quick local runs without PostgreSQL. */
export class MemoryShareStore implements ShareStore {
  private map = new Map<string, ShareRecord>();
  private reports = new Map<string, (Omit<ReportInput, 'shareId'> & { createdAt: Date })[]>();

  async create(rec: NewShare) {
    if (this.map.has(rec.id)) throw new Error('duplicate id');
    this.map.set(rec.id, structuredClone({ ...rec, hidden: false, reportCount: 0 }));
  }
  async get(id: string) {
    const r = this.map.get(id);
    return r ? structuredClone(r) : null;
  }
  async report(input: ReportInput, hideAt: number) {
    const share = this.map.get(input.shareId);
    if (!share) return null;
    const list = this.reports.get(input.shareId) ?? [];
    if (list.some((r) => r.reporterHash === input.reporterHash))
      return { accepted: false, reportCount: share.reportCount, hidden: share.hidden };
    list.push({
      reason: input.reason,
      details: input.details,
      reporterHash: input.reporterHash,
      createdAt: new Date(),
    });
    this.reports.set(input.shareId, list);
    share.reportCount = list.length;
    if (share.reportCount >= hideAt) share.hidden = true;
    return { accepted: true, reportCount: share.reportCount, hidden: share.hidden };
  }
  async listReported() {
    return [...this.map.values()]
      .filter((s) => s.reportCount > 0 || s.hidden)
      .sort((a, b) => b.reportCount - a.reportCount)
      .map((s) => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        hidden: s.hidden,
        reportCount: s.reportCount,
        reports: (this.reports.get(s.id) ?? []).map((r) => ({
          reason: r.reason,
          details: r.details ?? null,
          createdAt: r.createdAt,
        })),
      }));
  }
  async delete(id: string) {
    this.reports.delete(id);
    return this.map.delete(id);
  }
  async setHidden(id: string, hidden: boolean) {
    const s = this.map.get(id);
    if (!s) return false;
    s.hidden = hidden;
    if (!hidden) {
      s.reportCount = 0;
      this.reports.delete(id);
    }
    return true;
  }
  async totalBytes() {
    let n = 0;
    for (const s of this.map.values()) n += s.sizeBytes;
    return n;
  }
  async deleteExpired(now: Date) {
    let n = 0;
    for (const [id, s] of this.map)
      if (s.expiresAt && s.expiresAt <= now) {
        this.map.delete(id);
        this.reports.delete(id);
        n++;
      }
    return n;
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

  async create(rec: NewShare) {
    await this.db.insert(shares).values({
      id: rec.id,
      title: rec.title,
      schemaVersion: rec.project.schemaVersion,
      project: rec.project,
      createdAt: rec.createdAt,
      sizeBytes: rec.sizeBytes,
      expiresAt: rec.expiresAt,
    });
  }

  async get(id: string) {
    const rows = await this.db.select().from(shares).where(eq(shares.id, id)).limit(1);
    const r = rows[0];
    return r
      ? {
          id: r.id,
          title: r.title,
          project: r.project as Project,
          createdAt: r.createdAt,
          sizeBytes: r.sizeBytes,
          expiresAt: r.expiresAt,
          hidden: r.hidden,
          reportCount: r.reportCount,
        }
      : null;
  }

  async report(input: ReportInput, hideAt: number) {
    return this.db.transaction(async (tx) => {
      const exists = await tx
        .select({ id: shares.id })
        .from(shares)
        .where(eq(shares.id, input.shareId))
        .limit(1);
      if (!exists.length) return null;
      const inserted = await tx
        .insert(shareReports)
        .values({
          shareId: input.shareId,
          reason: input.reason,
          details: input.details ?? null,
          reporterHash: input.reporterHash,
        })
        .onConflictDoNothing()
        .returning({ id: shareReports.id });
      const [row] = inserted.length
        ? await tx
            .update(shares)
            .set({
              reportCount: sql`${shares.reportCount} + 1`,
              hidden: sql`${shares.hidden} OR ${shares.reportCount} + 1 >= ${hideAt}`,
            })
            .where(eq(shares.id, input.shareId))
            .returning({ reportCount: shares.reportCount, hidden: shares.hidden })
        : await tx
            .select({ reportCount: shares.reportCount, hidden: shares.hidden })
            .from(shares)
            .where(eq(shares.id, input.shareId));
      return { accepted: inserted.length > 0, reportCount: row!.reportCount, hidden: row!.hidden };
    });
  }

  async listReported() {
    const rows = await this.db
      .select({
        id: shares.id,
        title: shares.title,
        createdAt: shares.createdAt,
        hidden: shares.hidden,
        reportCount: shares.reportCount,
      })
      .from(shares)
      .where(sql`${shares.reportCount} > 0 OR ${shares.hidden}`)
      .orderBy(desc(shares.reportCount))
      .limit(500);
    const out: ReportedShare[] = [];
    for (const r of rows) {
      const reports = await this.db
        .select({
          reason: shareReports.reason,
          details: shareReports.details,
          createdAt: shareReports.createdAt,
        })
        .from(shareReports)
        .where(eq(shareReports.shareId, r.id))
        .orderBy(desc(shareReports.createdAt));
      out.push({ ...r, reports });
    }
    return out;
  }

  async delete(id: string) {
    const rows = await this.db.delete(shares).where(eq(shares.id, id)).returning({ id: shares.id });
    return rows.length > 0;
  }

  async setHidden(id: string, hidden: boolean) {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(shares)
        .set(hidden ? { hidden: true } : { hidden: false, reportCount: 0 })
        .where(eq(shares.id, id))
        .returning({ id: shares.id });
      if (rows.length && !hidden) await tx.delete(shareReports).where(eq(shareReports.shareId, id));
      return rows.length > 0;
    });
  }

  async totalBytes() {
    const [r] = await this.db
      .select({ total: sql<string>`coalesce(sum(${shares.sizeBytes}), 0)` })
      .from(shares);
    return Number(r?.total ?? 0);
  }

  async deleteExpired(now: Date) {
    const rows = await this.db
      .delete(shares)
      .where(and(isNotNull(shares.expiresAt), lt(shares.expiresAt, now)))
      .returning({ id: shares.id });
    return rows.length;
  }

  async close() {
    await this.pool.end();
  }
}
