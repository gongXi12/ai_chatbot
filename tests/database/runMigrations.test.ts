import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { runMigrations } from '../../src/database/runMigrations.js';

function checksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

describe('runMigrations', () => {
  it('fails fast when an applied migration checksum differs from the file on disk', async () => {
    const sql = await readFile(new URL('../../database/migrations/001_initial.sql', import.meta.url), 'utf8');
    const query = vi.fn(async (statement: string, values?: unknown[]) => {
      if (statement.includes('SELECT version, checksum')) {
        return values?.[0] === '001'
          ? { rows: [{ version: '001', checksum: checksum(sql + '-- changed') }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });
    const client = { query, release: vi.fn() };
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;

    await expect(runMigrations(pool)).rejects.toThrow('checksum mismatch for migration 001');
  });
});
