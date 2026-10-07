import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function normalizeBindings(values) {
  return values.map((v) => v === undefined ? null : v);
}

class D1PreparedStatement {
  constructor(owner, sql) {
    this.owner = owner;
    this.sql = sql;
    this.values = [];
  }
  bind(...values) {
    this.values = normalizeBindings(values);
    return this;
  }
  _statement() {
    return this.owner.db.prepare(this.sql);
  }
  async first(column) {
    this.owner.metrics.reads++;
    const row = this._statement().get(...this.values) ?? null;
    if (column !== undefined) return row ? row[column] ?? null : null;
    return row;
  }
  async all() {
    this.owner.metrics.reads++;
    const results = this._statement().all(...this.values);
    return { success: true, results, meta: { duration: 0 } };
  }
  async run() {
    this.owner.metrics.writes++;
    const result = this._statement().run(...this.values);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0)
      }
    };
  }
}

export class D1Compat {
  constructor(filename) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.metrics = { reads: 0, writes: 0 };
    try { this.db.exec('PRAGMA journal_mode=WAL;'); } catch {}
    try { this.db.exec('PRAGMA synchronous=NORMAL;'); } catch {}
    try { this.db.exec('PRAGMA busy_timeout=5000;'); } catch {}
    try { this.db.exec('PRAGMA foreign_keys=ON;'); } catch {}
  }
  prepare(sql) {
    return new D1PreparedStatement(this, sql);
  }
  async batch(statements) {
    const results = [];
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const statement of statements) results.push(await statement.run());
      this.db.exec('COMMIT');
      return results;
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw err;
    }
  }
  exec(sql) {
    this.db.exec(sql);
    return { count: 1, duration: 0 };
  }
  close() {
    this.db.close();
  }
}
