import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/** Immutable snapshots created by "Compartilhar". */
export const shares = pgTable(
  'shares',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    project: jsonb('project').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** JSON size of the project, used for the total storage limit. */
    sizeBytes: integer('size_bytes').notNull().default(0),
    /** Optional expiration chosen by the author (null = never). */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Hidden after enough reports, until an administrator reviews it. */
    hidden: boolean('hidden').notNull().default(false),
    reportCount: integer('report_count').notNull().default(0),
  },
  (t) => [index('shares_created_at_idx').on(t.createdAt), index('shares_expires_at_idx').on(t.expiresAt)],
);

/** Abuse reports. Reporters are identified only by a salted hash (no raw IP is stored). */
export const shareReports = pgTable(
  'share_reports',
  {
    id: serial('id').primaryKey(),
    shareId: text('share_id')
      .notNull()
      .references(() => shares.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    details: text('details'),
    reporterHash: text('reporter_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('share_reports_unique_reporter').on(t.shareId, t.reporterHash)],
);
