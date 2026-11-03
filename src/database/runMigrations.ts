import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Pool, PoolClient } from 'pg';

interface Migration {
  version: string;
  fileName: string;
}

interface AppliedMigrationRow {
  version: string;
  checksum: string | null;
}

interface MigrationOptions {
  migrationDirectory?: URL;
}

const migrations: Migration[] = [
  { version: '001', fileName: '001_initial.sql' },
  { version: '002', fileName: '002_message_leases.sql' },
  { version: '003', fileName: '003_relationship_observations.sql' },
  { version: '004', fileName: '004_outbound_deliveries.sql' },
  { version: '005', fileName: '005_user_deletions.sql' },
  { version: '006', fileName: '006_relationship_age_gate.sql' },
  { version: '007', fileName: '007_relationship_nicknames.sql' },
];

function migrationUrl(fileName: string, directory?: URL): URL {
  return directory
    ? new URL(fileName, directory)
    : new URL(`../../database/migrations/${fileName}`, import.meta.url);
}

function checksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT NULL`);
}

async function applyMigration(
  client: PoolClient,
  migration: Migration,
  migrationDirectory?: URL,
): Promise<void> {
  const sql = await readFile(fileURLToPath(migrationUrl(migration.fileName, migrationDirectory)), 'utf8');
  const expectedChecksum = checksum(sql);
  const applied = await client.query<AppliedMigrationRow>(
    'SELECT version, checksum FROM schema_migrations WHERE version = $1',
    [migration.version],
  );
  const row = applied.rows[0];
  if (row) {
    if (row.checksum && row.checksum !== expectedChecksum) {
      throw new Error(`Migration checksum mismatch for migration ${migration.version}.`);
    }
    if (!row.checksum) {
      await client.query(
        'UPDATE schema_migrations SET checksum = $2 WHERE version = $1 AND checksum IS NULL',
        [migration.version, expectedChecksum],
      );
    }
    return;
  }

  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
      [migration.version, expectedChecksum],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function runMigrations(pool: Pool, options: MigrationOptions = {}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(hashtext('wechat-companion:migrations'))`);
    await ensureMigrationTable(client);
    for (const migration of migrations) {
      await applyMigration(client, migration, options.migrationDirectory);
    }
  } finally {
    try {
      await client.query(`SELECT pg_advisory_unlock(hashtext('wechat-companion:migrations'))`);
    } finally {
      client.release();
    }
  }
}


