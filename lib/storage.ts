import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

type Row = Record<string, unknown>;
export type QueryResult<T = Row> = { results: T[] };
export interface PreparedStatement {
  bind(...values: SQLInputValue[]): PreparedStatement;
  all<T = Row>(): Promise<QueryResult<T>>;
  run(): Promise<QueryResult>;
  first<T = Row>(): Promise<T | null>;
}
export interface Database {
  prepare(sql: string): PreparedStatement;
  batch(statements: PreparedStatement[]): Promise<QueryResult[]>;
}

class LocalStatement implements PreparedStatement {
  constructor(
    private sqlite: DatabaseSync,
    private sql: string,
    private values: SQLInputValue[] = [],
  ) {}
  bind(...values: SQLInputValue[]) {
    return new LocalStatement(this.sqlite, this.sql, values);
  }
  execute(): QueryResult {
    const statement = this.sqlite.prepare(this.sql);
    if (statement.columns().length) return { results: statement.all(...this.values) };
    statement.run(...this.values);
    return { results: [] };
  }
  async all<T = Row>(): Promise<QueryResult<T>> {
    return this.execute() as QueryResult<T>;
  }
  async run() {
    return this.execute();
  }
  async first<T = Row>(): Promise<T | null> {
    return (this.execute().results[0] as T | undefined) ?? null;
  }
}

export class LocalDatabase implements Database {
  readonly sqlite: DatabaseSync;
  constructor(dataDir: string, migrationsDir = path.resolve('drizzle')) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.sqlite = new DatabaseSync(path.join(dataDir, 'campus-talent.sqlite'));
    try {
      this.sqlite.exec(
        'PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;',
      );
      // Keep the migration journal and schema changes in the same write transaction.
      this.sqlite.exec('BEGIN IMMEDIATE');
      try {
        this.sqlite.exec(
          'CREATE TABLE IF NOT EXISTS _campus_migrations (name TEXT PRIMARY KEY, hash TEXT NOT NULL)',
        );
        const files = readdirSync(migrationsDir)
          .filter((file) => file.endsWith('.sql'))
          .sort();
        if (!files.length) throw new Error('未找到数据库迁移文件');
        for (const name of files) {
          const sql = readFileSync(path.join(migrationsDir, name), 'utf8');
          const hash = createHash('sha256').update(sql).digest('hex');
          const applied = this.sqlite
            .prepare('SELECT hash FROM _campus_migrations WHERE name=?')
            .get(name);
          if (applied) {
            if (applied.hash !== hash) throw new Error(`已应用的迁移文件被修改：${name}`);
            continue;
          }
          this.sqlite.exec(sql);
          this.sqlite
            .prepare('INSERT INTO _campus_migrations(name,hash) VALUES(?,?)')
            .run(name, hash);
        }
        this.sqlite.exec('COMMIT');
      } catch (error) {
        this.sqlite.exec('ROLLBACK');
        throw error;
      }
    } catch (error) {
      this.sqlite.close();
      throw error;
    }
  }
  prepare(sql: string) {
    return new LocalStatement(this.sqlite, sql);
  }
  async batch(statements: PreparedStatement[]) {
    // No await inside the transaction: other requests cannot interleave writes.
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement) => {
        if (!(statement instanceof LocalStatement)) throw new Error('无效的数据库语句');
        return statement.execute();
      });
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}

export class LocalBucket {
  private root: string;
  constructor(dataDir: string) {
    this.root = path.join(dataDir, 'attachments');
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
  }
  private filename(key: string) {
    if (!/^attachments\/[a-zA-Z0-9_-]+$/.test(key)) throw new Error('无效的附件路径');
    return path.join(this.root, key.slice('attachments/'.length));
  }
  async put(key: string, body: ReadableStream<Uint8Array>) {
    const filename = this.filename(key);
    const temporary = filename + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temporary, new Uint8Array(await new Response(body).arrayBuffer()), {
        mode: 0o600,
        flag: 'wx',
      });
      await rename(temporary, filename);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  async get(key: string) {
    const filename = this.filename(key);
    try {
      return { body: new Uint8Array(await readFile(filename)) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async delete(key: string) {
    await rm(this.filename(key), { force: true });
  }
}

const shared = globalThis as typeof globalThis & {
  campusTalentStorage?: { directory: string; database: LocalDatabase; bucket: LocalBucket };
};
function storage() {
  const directory = path.resolve(process.env.DATA_DIR || 'data');
  if (!shared.campusTalentStorage) {
    const database = new LocalDatabase(directory);
    shared.campusTalentStorage = { directory, database, bucket: new LocalBucket(directory) };
  }
  if (shared.campusTalentStorage.directory !== directory)
    throw new Error('数据目录更改后需要重启服务');
  return shared.campusTalentStorage;
}
export const getDatabase = () => storage().database;
export const getBucket = () => storage().bucket;
