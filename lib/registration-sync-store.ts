import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getDatabase, type LocalDatabase } from './storage';
import { DEFAULT_CONFIG, type Candidate, type Config } from './talent';
import {
  planRegistrationSync,
  RegistrationSyncError,
  type RegistrationConflict,
  type RegistrationMapping,
  type RegistrationRecord,
  type RegistrationSyncPlan,
} from './registration-sync';
import { fetchTencentRegistrations } from './tencent-docs';

export type RegistrationSyncConfig = {
  enabled: boolean;
  sourceId: string;
  source: string;
  fileId: string;
  sheetId: string;
  batch: string;
  intervalSeconds: number;
  tokenFile: string;
};
export type RegistrationSyncStatus = {
  configured: boolean;
  enabled: boolean;
  running: boolean;
  source?: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  nextRunAt?: string;
  error?: string;
  counts?: RegistrationSyncPlan['counts'];
  conflictCount?: number;
  conflicts?: Pick<RegistrationConflict, 'remoteId' | 'candidateId' | 'fields'>[];
};
type StoredStatus = Omit<
  RegistrationSyncStatus,
  'configured' | 'enabled' | 'running' | 'source'
> & {
  sourceId?: string;
  failures?: number;
};
type StateRow = { state: string; lease_owner: string; lease_until: number };
const LEASE_MS = 180_000;
const CONFIG_ERROR = '腾讯文档同步配置无效，请检查服务器上的同步配置';
const dataDirectory = () => path.resolve(process.env.DATA_DIR || 'data');

/** Credentials stay in the private data directory and never enter a browser snapshot. */
export function readRegistrationSyncConfig(
  directory = dataDirectory(),
): RegistrationSyncConfig | null {
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(path.join(directory, 'tencent-sync.json'), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(CONFIG_ERROR);
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(CONFIG_ERROR);
  const value = input as Record<string, unknown>;
  if (value.enabled === false && Object.keys(value).every((key) => key === 'enabled')) return null;
  if (value.enabled !== true && value.enabled !== false) throw new Error(CONFIG_ERROR);
  for (const key of ['sourceId', 'source', 'fileId', 'sheetId', 'batch', 'tokenFile'])
    if (
      typeof value[key] !== 'string' ||
      !value[key].trim() ||
      value[key] !== value[key].trim() ||
      value[key].length > (key === 'source' || key === 'tokenFile' ? 2000 : 500)
    )
      throw new Error(CONFIG_ERROR);
  try {
    const url = new URL(value.source as string);
    if (url.protocol !== 'https:' || url.hostname !== 'docs.qq.com' || url.username || url.password)
      throw new Error(CONFIG_ERROR);
  } catch {
    throw new Error(CONFIG_ERROR);
  }
  const intervalSeconds = value.intervalSeconds ?? 120;
  if (
    typeof intervalSeconds !== 'number' ||
    !Number.isInteger(intervalSeconds) ||
    intervalSeconds < 60 ||
    intervalSeconds > 86400
  )
    throw new Error(CONFIG_ERROR);
  return {
    enabled: value.enabled,
    sourceId: value.sourceId as string,
    source: value.source as string,
    fileId: value.fileId as string,
    sheetId: value.sheetId as string,
    batch: value.batch as string,
    intervalSeconds,
    tokenFile: path.resolve(directory, value.tokenFile as string),
  };
}

function ensureState(database: LocalDatabase) {
  database.sqlite
    .prepare("INSERT OR IGNORE INTO registration_sync_state(id) VALUES ('main')")
    .run();
}
function readState(database: LocalDatabase): StateRow | undefined {
  return database.sqlite
    .prepare("SELECT state,lease_owner,lease_until FROM registration_sync_state WHERE id='main'")
    .get() as StateRow | undefined;
}
function statusData(row?: StateRow): StoredStatus {
  return row ? (JSON.parse(row.state) as StoredStatus) : {};
}
function transaction<T>(database: LocalDatabase, run: () => T): T {
  database.sqlite.exec('BEGIN IMMEDIATE');
  try {
    const result = run();
    database.sqlite.exec('COMMIT');
    return result;
  } catch (error) {
    database.sqlite.exec('ROLLBACK');
    throw error;
  }
}
function writeStatus(database: LocalDatabase, status: StoredStatus) {
  database.sqlite
    .prepare("UPDATE registration_sync_state SET state=? WHERE id='main'")
    .run(JSON.stringify(status));
}

export function getRegistrationSyncStatus(
  database = getDatabase(),
  now = Date.now(),
  directory = dataDirectory(),
): RegistrationSyncStatus {
  let config: RegistrationSyncConfig | null;
  try {
    config = readRegistrationSyncConfig(directory);
  } catch {
    return { configured: true, enabled: false, running: false, error: CONFIG_ERROR };
  }
  if (!config || !config.enabled)
    return {
      configured: !!config || existsSync(path.join(directory, 'tencent-sync.json')),
      enabled: false,
      running: false,
      ...(config?.source ? { source: config.source } : {}),
    };
  const row = readState(database);
  const saved = statusData(row);
  const current = saved.sourceId === config.sourceId ? saved : {};
  return {
    configured: true,
    enabled: true,
    running: !!row?.lease_owner && row.lease_until > now,
    source: config.source,
    ...(current.lastAttemptAt ? { lastAttemptAt: current.lastAttemptAt } : {}),
    ...(current.lastSuccessAt ? { lastSuccessAt: current.lastSuccessAt } : {}),
    ...(current.nextRunAt ? { nextRunAt: current.nextRunAt } : {}),
    ...(current.error ? { error: current.error } : {}),
    ...(current.counts ? { counts: current.counts } : {}),
    ...(current.conflictCount !== undefined ? { conflictCount: current.conflictCount } : {}),
    ...(current.conflicts ? { conflicts: current.conflicts } : {}),
  };
}

/** A SQLite lease coordinates the web process, worker, and accidental duplicate workers. */
export function acquireRegistrationSyncLease(
  database: LocalDatabase,
  owner: string,
  now = Date.now(),
  leaseMs = LEASE_MS,
): boolean {
  ensureState(database);
  return (
    database.sqlite
      .prepare(
        "UPDATE registration_sync_state SET lease_owner=?,lease_until=? WHERE id='main' AND lease_until<=?",
      )
      .run(owner, now + leaseMs, now).changes === 1
  );
}
export function releaseRegistrationSyncLease(database: LocalDatabase, owner: string) {
  database.sqlite
    .prepare(
      "UPDATE registration_sync_state SET lease_owner='',lease_until=0 WHERE id='main' AND lease_owner=?",
    )
    .run(owner);
}
function conflictSummary(conflicts: RegistrationConflict[]) {
  return conflicts.slice(0, 100).map(({ remoteId, candidateId, fields }) => ({
    remoteId,
    ...(candidateId ? { candidateId } : {}),
    fields,
  }));
}

/** Fetching is complete before this synchronous transaction reads the latest interview work. */
export function applyRegistrationSync(
  database: LocalDatabase,
  config: RegistrationSyncConfig,
  records: readonly RegistrationRecord[],
  now = new Date().toISOString(),
  leaseOwner?: string,
): RegistrationSyncPlan['counts'] {
  return transaction(database, () => {
    ensureState(database);
    const state = readState(database)!;
    if (leaseOwner && (state.lease_owner !== leaseOwner || state.lease_until <= Date.parse(now)))
      throw new RegistrationSyncError('同步任务已过期，请重新同步');
    database.sqlite
      .prepare('INSERT OR IGNORE INTO workspace (id,config) VALUES (?,?)')
      .run('main', JSON.stringify(DEFAULT_CONFIG));
    const workspace = database.sqlite
      .prepare("SELECT config FROM workspace WHERE id='main'")
      .get() as { config: string };
    const candidates = (
      database.sqlite.prepare('SELECT data FROM candidates').all() as { data: string }[]
    ).map((row) => JSON.parse(row.data) as Candidate);
    const mappings = (
      database.sqlite
        .prepare('SELECT data FROM registration_sync_mappings WHERE source_id=?')
        .all(config.sourceId) as { data: string }[]
    ).map((row) => JSON.parse(row.data) as RegistrationMapping);
    const plan = planRegistrationSync({
      sourceId: config.sourceId,
      source: config.source,
      batch: config.batch,
      config: JSON.parse(workspace.config) as Config,
      records,
      candidates,
      mappings,
      now,
    });
    const changes = [...plan.additions, ...plan.updates.map((change) => change.after)];
    if (changes.length) {
      // Rotate the token too: a web mutation planned against the old revision must retry.
      database.sqlite
        .prepare("UPDATE workspace SET revision=revision+1,token=? WHERE id='main'")
        .run(randomUUID());
      const upsert = database.sqlite.prepare(
        'INSERT INTO candidates(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      );
      for (const candidate of changes) upsert.run(candidate.id, JSON.stringify(candidate));
      const id = randomUUID();
      const audit = {
        id,
        time: now,
        actor: '腾讯文档同步',
        summary: `同步报名：新增 ${plan.counts.added} 人，更新 ${plan.counts.updated} 人，冲突 ${plan.counts.conflicts} 人`,
        undoable: false,
        changes: [],
      };
      database.sqlite
        .prepare('INSERT INTO events(id,time,data) VALUES(?,?,?)')
        .run(id, now, JSON.stringify(audit));
    }
    const saveMapping = database.sqlite.prepare(
      'INSERT INTO registration_sync_mappings(source_id,remote_id,candidate_id,data) VALUES(?,?,?,?) ON CONFLICT(source_id,remote_id) DO UPDATE SET candidate_id=excluded.candidate_id,data=excluded.data',
    );
    for (const mapping of plan.mappings)
      saveMapping.run(
        config.sourceId,
        mapping.remoteId,
        mapping.candidateId,
        JSON.stringify(mapping),
      );
    const previous = statusData(state);
    writeStatus(database, {
      ...previous,
      sourceId: config.sourceId,
      lastSuccessAt: now,
      nextRunAt: new Date(Date.parse(now) + config.intervalSeconds * 1000).toISOString(),
      error: undefined,
      counts: plan.counts,
      conflictCount: plan.conflicts.length,
      conflicts: conflictSummary(plan.conflicts),
      failures: 0,
    });
    return plan.counts;
  });
}

type TriggerOptions = {
  database?: LocalDatabase;
  dataDir?: string;
  fetchRecords?: (config: RegistrationSyncConfig) => Promise<RegistrationRecord[]>;
  now?: () => number;
};
/** Runs one complete snapshot; the API and background worker use this exact path. */
export async function triggerRegistrationSync(
  options: TriggerOptions = {},
): Promise<RegistrationSyncStatus> {
  const database = options.database || getDatabase();
  const directory = options.dataDir || dataDirectory();
  const clock = options.now || Date.now;
  const status = () => getRegistrationSyncStatus(database, clock(), directory);
  let config: RegistrationSyncConfig | null;
  try {
    config = readRegistrationSyncConfig(directory);
  } catch {
    return status();
  }
  if (!config?.enabled) return status();
  const owner = randomUUID();
  if (!acquireRegistrationSyncLease(database, owner, clock())) return status();
  try {
    transaction(database, () => {
      const previous = statusData(readState(database));
      writeStatus(database, {
        ...(previous.sourceId === config!.sourceId ? previous : {}),
        sourceId: config!.sourceId,
        lastAttemptAt: new Date(clock()).toISOString(),
        error: undefined,
      });
    });
    const records = await (options.fetchRecords || fetchTencentRegistrations)(config);
    const latestConfig = readRegistrationSyncConfig(directory);
    if (!latestConfig?.enabled || JSON.stringify(latestConfig) !== JSON.stringify(config))
      throw new RegistrationSyncError('同步配置已变更，请使用新配置重新同步');
    applyRegistrationSync(database, config, records, new Date(clock()).toISOString(), owner);
  } catch (error) {
    transaction(database, () => {
      const row = readState(database)!;
      if (row.lease_owner !== owner) return;
      const previous = statusData(row);
      const failures = (previous.failures || 0) + 1;
      const message =
        error instanceof RegistrationSyncError ||
        (error instanceof Error && error.name === 'TencentDocsError')
          ? error.message.slice(0, 200)
          : '同步未完成，请检查服务器配置后重试';
      const conflicts = error instanceof RegistrationSyncError ? error.conflicts : [];
      writeStatus(database, {
        ...previous,
        error: message,
        failures,
        nextRunAt: new Date(
          clock() + Math.min(3600, config!.intervalSeconds * 2 ** Math.min(failures - 1, 5)) * 1000,
        ).toISOString(),
        conflictCount: conflicts.length,
        conflicts: conflictSummary(conflicts),
      });
    });
  } finally {
    releaseRegistrationSyncLease(database, owner);
  }
  return status();
}
