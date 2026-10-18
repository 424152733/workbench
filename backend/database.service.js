import { Injectable } from '@nestjs/common';
import { readFile,readdir } from 'node:fs/promises';
import { Pool, types } from 'pg';

const DATE_OID = 1082;
const identity = (value) => value;
export const postgresTypes = {
  getTypeParser(oid,format) {
    if (oid === DATE_OID && format === 'text') return identity;
    return types.getTypeParser(oid,format);
  },
};

export class DatabaseService {
  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://localhost/insurance_workbench',
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
      types:postgresTypes,
    });
  }

  async onModuleInit() {
    await this.pool.query('SELECT 1');
    const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
    await this.pool.query(schema);
    const client = await this.pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtext('insurance_workbench_migrations'))");
      await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      const migrationDir = new URL('./migrations/',import.meta.url);
      const files = (await readdir(migrationDir)).filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
      for (const version of files) {
        const applied = await client.query('SELECT 1 FROM schema_migrations WHERE version=$1',[version]);
        if (applied.rowCount) continue;
        const sql = await readFile(new URL(version,migrationDir),'utf8');
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations(version) VALUES($1)',[version]);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('insurance_workbench_migrations'))");
      client.release();
    }
  }

  query(sql, params) {
    return this.pool.query(sql, params);
  }

  async transaction(work) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
Injectable()(DatabaseService);

