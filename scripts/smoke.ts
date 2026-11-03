import { createRuntime } from '../src/runtime/createRuntime.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL
    ?? 'postgres://companion:companion@127.0.0.1:5432/companion';
  const runtime = await createRuntime({
    storageDriver: 'postgres',
    databaseUrl,
    adminToken: 'smoke-admin-token',
  });
  const app = runtime.app;
  const userId = `smoke-${crypto.randomUUID()}`;
  const messageId = `message-${crypto.randomUUID()}`;

  try {
    const health = await app.inject({ method: 'GET', url: '/health' });
    const payload = { userId, messageId, text: '我喜欢喝咖啡' };
    const chat = await app.inject({ method: 'POST', url: '/v1/chat', payload });
    const duplicate = await app.inject({ method: 'POST', url: '/v1/chat', payload });
    const unauthorized = await app.inject({ method: 'GET', url: '/admin' });
    const headers = { 'x-admin-token': 'smoke-admin-token' };
    const admin = await app.inject({ method: 'GET', url: '/admin', headers });
    const preview = await app.inject({
      method: 'POST',
      url: '/admin/api/diagnostics/preview',
      headers,
      payload: { userId, text: '咖啡喝多了有点睡不着' },
    });
    const state = await app.inject({ method: 'GET', url: `/admin/api/users/${userId}/state`, headers });
    const deletion = await app.inject({ method: 'DELETE', url: `/admin/api/users/${userId}/data`, headers });
    const deleted = await app.inject({ method: 'GET', url: `/admin/api/users/${userId}/state`, headers });
    const empty = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: { userId, messageId: `empty-${crypto.randomUUID()}`, text: '' },
    });
    const crisis = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: { userId, messageId: `crisis-${crypto.randomUUID()}`, text: '我现在就想自杀，手边有刀' },
    });

    const result = {
      health: health.json().status,
      chatStatus: chat.statusCode,
      bubbles: chat.json().bubbles.length,
      duplicate: duplicate.json().duplicate,
      adminUnauthorized: unauthorized.statusCode,
      adminAuthorized: admin.statusCode,
      diagnosticSections: preview.json().promptSections.length,
      stateMemories: state.json().memories.length,
      deleteStatus: deletion.statusCode,
      deletedMemories: deleted.json().memories.length,
      emptyStatus: empty.statusCode,
      crisisLevel: crisis.json().safetyLevel,
    };

    assert(result.health === 'ok', 'health check failed');
    assert(result.chatStatus === 200 && result.bubbles > 0, 'chat smoke failed');
    assert(result.duplicate === true, 'message deduplication failed');
    assert(result.adminUnauthorized === 401 && result.adminAuthorized === 200, 'admin auth failed');
    assert(result.diagnosticSections > 0, 'diagnostic preview failed');
    assert(result.stateMemories === 1, 'memory persistence failed');
    assert(result.deleteStatus === 204 && result.deletedMemories === 0, 'user deletion failed');
    assert(result.emptyStatus === 400, 'input validation failed');
    assert(result.crisisLevel === 'crisis', 'crisis safety path failed');

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await app.close();
  }
}

await main();