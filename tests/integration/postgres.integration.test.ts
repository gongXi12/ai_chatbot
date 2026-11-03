import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/database/runMigrations.js';
import { createRuntime } from '../../src/runtime/createRuntime.js';
import { userDeletionKey } from '../../src/repositories/PostgresUserDeletionBarrier.js';

const databaseUrl = process.env.TEST_DATABASE_URL ?? '';
if (!databaseUrl && process.env.npm_lifecycle_event === 'test:postgres') {
  throw new Error('TEST_DATABASE_URL is required for npm run test:postgres.');
}
const integration = databaseUrl ? describe : describe.skip;
let pool: Pool;
const testUsers = new Set<string>();

const deterministicModel = {
  async generate() {
    return ['收到'];
  },
};

async function cleanUser(userId: string): Promise<void> {
  await pool.query('DELETE FROM user_deletions WHERE user_key = $1', [userDeletionKey(userId)]);
  await pool.query('DELETE FROM outbound_deliveries WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM memories WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM relationship_states WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM conversation_messages WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM message_processing WHERE user_id = $1', [userId]);
}

async function rowCount(table: string, userId: string): Promise<number> {
  const allowed = new Set([
    'outbound_deliveries',
    'message_processing',
    'conversation_messages',
    'memories',
    'relationship_states',
    'relationship_observations',
  ]);
  if (!allowed.has(table)) throw new Error(`Unexpected table: ${table}`);
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ${table} WHERE user_id = $1`,
    [userId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

integration('real PostgreSQL runtime', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await Promise.all([runMigrations(pool), runMigrations(pool)]);
  });

  afterAll(async () => {
    for (const userId of testUsers) await cleanUser(userId);
    await pool?.end();
  });

  it('persists, replays and deletes state across independently owned runtime pools', async () => {
    const userId = `integration-${randomUUID()}`;
    const messageId = `message-${randomUUID()}`;
    testUsers.add(userId);
    const runtimes: Array<Awaited<ReturnType<typeof createRuntime>>> = [];

    try {
      const first = await createRuntime({
        storageDriver: 'postgres', databaseUrl, adminToken: 'integration-token', model: deterministicModel,
      });
      runtimes.push(first);
      const chat = await first.app.inject({
        method: 'POST', url: '/v1/chat', payload: { userId, messageId, text: '我喜欢喝咖啡' },
      });
      expect(chat.statusCode).toBe(200);
      const original = chat.json();
      await first.app.close();
      runtimes.pop();

      const second = await createRuntime({
        storageDriver: 'postgres', databaseUrl, adminToken: 'integration-token', model: deterministicModel,
      });
      runtimes.push(second);
      const headers = { 'x-admin-token': 'integration-token' };
      const state = await second.app.inject({
        method: 'GET', url: `/admin/api/users/${encodeURIComponent(userId)}/state`, headers,
      });
      expect(state.statusCode).toBe(200);
      expect(state.json().memories).toHaveLength(1);
      expect(state.json().recentMessages.length).toBeGreaterThanOrEqual(2);
      expect(await rowCount('relationship_states', userId)).toBe(1);

      const duplicate = await second.app.inject({
        method: 'POST', url: '/v1/chat', payload: { userId, messageId, text: '我喜欢喝咖啡' },
      });
      expect(duplicate.json()).toEqual({ ...original, duplicate: true });

      const deletion = await second.app.inject({
        method: 'DELETE', url: `/admin/api/users/${encodeURIComponent(userId)}/data`, headers,
      });
      expect(deletion.statusCode).toBe(204);
      for (const table of [
        'outbound_deliveries', 'message_processing', 'conversation_messages', 'memories',
        'relationship_states', 'relationship_observations',
      ]) {
        expect(await rowCount(table, userId)).toBe(0);
      }
      await second.app.close();
      runtimes.pop();

      const third = await createRuntime({
        storageDriver: 'postgres', databaseUrl, adminToken: 'integration-token', model: deterministicModel,
      });
      runtimes.push(third);
      const oldReplay = await third.app.inject({
        method: 'POST', url: '/v1/chat',
        payload: {
          userId, messageId, text: '我喜欢喝咖啡', receivedAt: new Date(0).toISOString(),
        },
      });
      expect(oldReplay.json()).toMatchObject({ duplicate: true, discarded: true, bubbles: [] });
      for (const table of [
        'outbound_deliveries', 'message_processing', 'conversation_messages', 'memories',
        'relationship_states', 'relationship_observations',
      ]) {
        expect(await rowCount(table, userId)).toBe(0);
      }

      const newMessage = await third.app.inject({
        method: 'POST', url: '/v1/chat',
        payload: { userId, messageId: `new-${randomUUID()}`, text: '重新开始' },
      });
      expect(newMessage.json()).toMatchObject({ duplicate: false });
    } finally {
      await Promise.all(runtimes.map(async (runtime) => runtime.app.close()));
    }
  });

  it('serializes different messages for one user without losing relationship updates', async () => {
    const userId = `concurrent-${randomUUID()}`;
    testUsers.add(userId);
    const runtime = await createRuntime({
      storageDriver: 'postgres', databaseUrl, adminToken: 'integration-token', model: deterministicModel,
    });
    try {
      const responses = await Promise.all([
        runtime.app.inject({
          method: 'POST', url: '/v1/chat',
          payload: { userId, messageId: `m-${randomUUID()}`, text: '今天有点累' },
        }),
        runtime.app.inject({
          method: 'POST', url: '/v1/chat',
          payload: { userId, messageId: `m-${randomUUID()}`, text: '今天也有点烦' },
        }),
      ]);
      expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
      const state = await pool.query<{ familiarity: number | string }>(
        'SELECT familiarity FROM relationship_states WHERE user_id = $1',
        [userId],
      );
      expect(Number(state.rows[0]?.familiarity)).toBeCloseTo(0.07);
      expect(await rowCount('relationship_observations', userId)).toBe(2);
    } finally {
      await runtime.app.close();
    }
  });

  it('waits for an in-flight chat before deleting all user data', async () => {
    const userId = `delete-race-${randomUUID()}`;
    testUsers.add(userId);
    let releaseModel!: () => void;
    let markStarted!: () => void;
    const modelStarted = new Promise<void>((resolve) => { markStarted = resolve; });
    const modelRelease = new Promise<void>((resolve) => { releaseModel = resolve; });
    const delayedModel = {
      async generate() {
        markStarted();
        await modelRelease;
        return ['收到'];
      },
    };
    const chatRuntime = await createRuntime({
      storageDriver: 'postgres', databaseUrl, adminToken: 'integration-token', model: delayedModel,
    });
    const adminRuntime = await createRuntime({
      storageDriver: 'postgres', databaseUrl, adminToken: 'integration-token', model: deterministicModel,
    });

    try {
      const chatPromise = chatRuntime.app.inject({
        method: 'POST', url: '/v1/chat',
        payload: { userId, messageId: `m-${randomUUID()}`, text: '我喜欢喝咖啡' },
      });
      await modelStarted;
      let deletionSettled = false;
      const deletionPromise = adminRuntime.app.inject({
        method: 'DELETE',
        url: `/admin/api/users/${encodeURIComponent(userId)}/data`,
        headers: { 'x-admin-token': 'integration-token' },
      }).then((response) => {
        deletionSettled = true;
        return response;
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(deletionSettled).toBe(false);

      releaseModel();
      expect((await chatPromise).statusCode).toBe(200);
      expect((await deletionPromise).statusCode).toBe(204);
      for (const table of [
        'outbound_deliveries', 'message_processing', 'conversation_messages', 'memories',
        'relationship_states', 'relationship_observations',
      ]) {
        expect(await rowCount(table, userId)).toBe(0);
      }
    } finally {
      releaseModel?.();
      await chatRuntime.app.close();
      await adminRuntime.app.close();
    }
  });
});



