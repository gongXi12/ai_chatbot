import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createRuntime } from '../../src/runtime/createRuntime.js';
import { runMigrations } from '../../src/database/runMigrations.js';
import { createTestPool } from '../helpers/createTestPool.js';
import { PostgresUserOperationLock } from '../../src/services/UserOperationLock.js';

const deterministicModel = {
  async generate() {
    return ['收到'];
  },
};

describe('createRuntime', () => {
  it('uses PostgreSQL repositories and persists state across app instances', async () => {
    const pool = createTestPool();
    await runMigrations(pool);
    const first = await createRuntime({
      storageDriver: 'postgres',
      pool,
      adminToken: 'token',
      model: deterministicModel,
    });
    await first.app.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: { userId: 'u1', messageId: 'm1', text: '我喜欢喝咖啡' },
    });
    await first.app.close();

    const second = await createRuntime({
      storageDriver: 'postgres',
      pool,
      adminToken: 'token',
      model: deterministicModel,
    });
    const state = await second.app.inject({
      method: 'GET',
      url: '/admin/api/users/u1/state',
      headers: { 'x-admin-token': 'token' },
    });

    expect(state.json().memories).toHaveLength(1);
    expect(state.json().recentMessages.length).toBeGreaterThan(0);
    await second.app.close();
    await pool.end();
  });

  it('closes a newly created pool when migrations fail', async () => {
    const end = vi.fn(async () => undefined);
    const query = vi.fn(async () => {
      throw new Error('migration failed');
    });
    const pool = {
      query,
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
      end,
    } as unknown as Pool;

    await expect(createRuntime({
      storageDriver: 'postgres',
      poolFactory: () => pool,
      adminToken: 'token',
      model: deterministicModel,
    })).rejects.toThrow('migration failed');
    expect(end).toHaveBeenCalledOnce();
  });

  it('closes a pool that it owns when the app closes', async () => {
    const pool = createTestPool();
    const end = vi.spyOn(pool, 'end');
    const runtime = await createRuntime({
      storageDriver: 'postgres',
      pool,
      ownsPool: true,
      adminToken: 'token',
      model: deterministicModel,
    });

    await runtime.app.close();

    expect(end).toHaveBeenCalledOnce();
  });
  it('releases a PostgreSQL user-lock slot when connection acquisition fails', async () => {
    const connect = vi.fn()
      .mockRejectedValueOnce(new Error('temporary connect failure'))
      .mockResolvedValueOnce({
        query: vi.fn(async () => ({ rows: [], rowCount: 1 })),
        release: vi.fn(),
      });
    const lock = new PostgresUserOperationLock({ connect } as unknown as Pool, 1);

    await expect(lock.withUserLock('u1', async () => 'first')).rejects.toThrow('temporary connect failure');
    const second = await Promise.race([
      lock.withUserLock('u2', async () => 'second'),
      new Promise<string>((resolve) => setTimeout(() => resolve('timed-out'), 50)),
    ]);

    expect(second).toBe('second');
  });
});

