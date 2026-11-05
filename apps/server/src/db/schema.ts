import { integer, jsonb, pgTable, text, timestamp, index } from 'drizzle-orm/pg-core';

/** Immutable snapshots created by "Compartilhar". */
export const shares = pgTable(
  'shares',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    project: jsonb('project').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('shares_created_at_idx').on(t.createdAt)],
);
