import {
  sqliteTable,
  text,
  integer,
  index,
  primaryKey,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
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
export const registrationSyncState = sqliteTable('registration_sync_state', {
  id: text('id').primaryKey(),
  state: text('state').notNull().default('{}'),
  leaseOwner: text('lease_owner').notNull().default(''),
  leaseUntil: integer('lease_until').notNull().default(0),
});
// Mappings survive a missing source row or locally removed candidate. A later sync
// must report the missing association rather than silently recreating a person.
export const registrationSyncMappings = sqliteTable(
  'registration_sync_mappings',
  {
    sourceId: text('source_id').notNull(),
    remoteId: text('remote_id').notNull(),
    candidateId: text('candidate_id').notNull(),
    data: text('data').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sourceId, table.remoteId] }),
    uniqueIndex('registration_sync_candidate').on(table.sourceId, table.candidateId),
  ],
);
