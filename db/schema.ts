import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const workspace = sqliteTable('workspace', {
  id: text('id').primaryKey(),
  revision: integer('revision').notNull().default(0),
  token: text('token').notNull().default(''),
  config: text('config').notNull(),
});
export const candidates = sqliteTable('candidates', {
  id: text('id').primaryKey(),
  data: text('data').notNull(),
});
export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  time: text('time').notNull(),
  data: text('data').notNull(),
});
export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(),
  candidateId: text('candidate_id')
    .notNull()
    .references(() => candidates.id),
  name: text('name').notNull(),
  key: text('key').notNull(),
  type: text('type').notNull(),
  size: integer('size').notNull(),
  createdAt: text('created_at').notNull(),
});
export const editorSessions = sqliteTable(
  'editor_sessions',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    name: text('name').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [index('editor_sessions_client_expiry').on(table.clientId, table.expiresAt)],
);
