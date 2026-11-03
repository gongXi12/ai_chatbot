import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';

describe('chat HTTP API', () => {
  const apps: Array<ReturnType<typeof buildApp>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('protects the HTTP chat endpoint when a chat token is configured', async () => {
    const app = buildApp({ chatToken: 'test-chat-token' });
    apps.push(app);
    const payload = {
      userId: 'demo-user',
      messageId: 'protected-message',
      text: '你好',
    };

    const unauthorized = await app.inject({ method: 'POST', url: '/v1/chat', payload });
    const authorized = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { 'x-chat-token': 'test-chat-token' },
      payload,
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(authorized.statusCode).toBe(200);
  });

  it('validates the request and returns chat bubbles', async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: {
        userId: 'demo-user',
        messageId: 'demo-message',
        text: '今天上班真的好烦',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().bubbles.length).toBeGreaterThan(0);
  });

  it('namespaces caller message IDs by user to avoid cross-user dedup collisions', async () => {
    const app = buildApp();
    apps.push(app);

    const first = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: { userId: 'user-a', messageId: 'shared-id', text: '你好' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: { userId: 'user-b', messageId: 'shared-id', text: '你好' },
    });

    expect(first.json().duplicate).toBe(false);
    expect(second.json().duplicate).toBe(false);
  });

  it('does not expose user state or deletion on unauthenticated chat routes', async () => {
    const app = buildApp();
    apps.push(app);

    const state = await app.inject({ method: 'GET', url: '/v1/users/demo-user/state' });
    const deletion = await app.inject({ method: 'DELETE', url: '/v1/users/demo-user/data' });

    expect(state.statusCode).toBe(404);
    expect(deletion.statusCode).toBe(404);
  });

  it('rejects an empty message', async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: { userId: 'demo-user', messageId: 'm2', text: '' },
    });

    expect(response.statusCode).toBe(400);
  });
});

