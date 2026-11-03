import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { UserDeletionBarrier } from './UserDeletionBarrier.js';

interface DeletionRow {
  deleted_at: Date | string;
}

export function userDeletionKey(userId: string): string {
  return createHash('sha256').update(userId, 'utf8').digest('hex');
}

export class PostgresUserDeletionBarrier implements UserDeletionBarrier {
  constructor(private readonly pool: Pool) {}

  async latestDeletionAt(userId: string): Promise<Date | undefined> {
    const result = await this.pool.query<DeletionRow>(
      'SELECT deleted_at FROM user_deletions WHERE user_key = $1',
      [userDeletionKey(userId)],
    );
    const value = result.rows[0]?.deleted_at;
    return value ? new Date(value) : undefined;
  }

  async recordDeletion(userId: string, deletedAt: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_deletions (user_key, deleted_at)
       VALUES ($1, $2)
       ON CONFLICT (user_key) DO UPDATE SET deleted_at = EXCLUDED.deleted_at`,
      [userDeletionKey(userId), deletedAt],
    );
  }
}
