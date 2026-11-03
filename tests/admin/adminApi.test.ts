import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';

describe('admin console', () => {
  const apps: Array<ReturnType<typeof buildApp>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('requires an admin token for the HTML console and API', async () => {
    const app = buildApp({ adminToken: 'test-admin-token' });
    apps.push(app);

    const page = await app.inject({ method: 'GET', url: '/admin' });
    const api = await app.inject({ method: 'GET', url: '/admin/api/users/u1/state' });

    expect(page.statusCode).toBe(401);
    expect(api.statusCode).toBe(401);
    expect(page.headers['www-authenticate']).toContain('Basic');
  });

  it('keeps admin routes disabled when no admin token is configured', async () => {
    const app = buildApp({ adminToken: '' });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/admin' });

    expect(response.statusCode).toBe(404);
  });

  it('allows standard browser Basic authentication with the admin token as password', async () => {
    const app = buildApp({ adminToken: 'test-admin-token' });
    apps.push(app);
    const authorization = `Basic ${Buffer.from('admin:test-admin-token').toString('base64')}`;

    const response = await app.inject({
      method: 'GET',
      url: '/admin',
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
  });

  it('falls back to browser Basic authentication when the admin page sends an empty token header', async () => {
    const app = buildApp({ adminToken: 'test-admin-token' });
    apps.push(app);
    const authorization = `Basic ${Buffer.from('admin:test-admin-token').toString('base64')}`;

    const response = await app.inject({
      method: 'GET',
      url: '/admin/api/users/u1/state',
      headers: { authorization, 'x-admin-token': '' },
    });

    expect(response.statusCode).toBe(200);
  });

  it('serves a minimal admin console with valid authentication', async () => {
    const app = buildApp({ adminToken: 'test-admin-token' });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/admin',
      headers: { 'x-admin-token': 'test-admin-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('伴侣机器人管理台');
    expect(response.body).toContain('模型上下文诊断');
    expect(response.headers['cache-control']).toBe('no-store, private');
    expect(response.headers.pragma).toBe('no-cache');
    expect(response.headers.vary).toContain('x-admin-token');
  });

  it('previews model context without mutating user relationship state', async () => {
    const app = buildApp({ adminToken: 'test-admin-token' });
    apps.push(app);

    await app.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: { userId: 'u1', messageId: 'm1', text: '我明天下午要去面试' },
    });
    const before = await app.inject({
      method: 'GET',
      url: '/admin/api/users/u1/state',
      headers: { 'x-admin-token': 'test-admin-token' },
    });
    const preview = await app.inject({
      method: 'POST',
      url: '/admin/api/diagnostics/preview',
      headers: { 'x-admin-token': 'test-admin-token' },
      payload: { userId: 'u1', text: '面试有点紧张' },
    });
    const after = await app.inject({
      method: 'GET',
      url: '/admin/api/users/u1/state',
      headers: { 'x-admin-token': 'test-admin-token' },
    });

    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      intent: expect.any(String),
      safety: expect.any(Object),
      relationship: expect.any(Object),
      memories: expect.any(Array),
      recentMessages: expect.any(Array),
    });
    expect(after.json().relationship).toEqual(before.json().relationship);
  });

  it('can delete user data through the protected admin API', async () => {
    const app = buildApp({ adminToken: 'test-admin-token' });
    apps.push(app);

    await app.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: { userId: 'u1', messageId: 'm1', text: '我喜欢喝咖啡' },
    });
    const deletion = await app.inject({
      method: 'DELETE',
      url: '/admin/api/users/u1/data',
      headers: { 'x-admin-token': 'test-admin-token' },
    });
    const state = await app.inject({
      method: 'GET',
      url: '/admin/api/users/u1/state',
      headers: { 'x-admin-token': 'test-admin-token' },
    });

    expect(deletion.statusCode).toBe(204);
    expect(state.json().memories).toEqual([]);
    expect(state.json().recentMessages).toEqual([]);
  });
});


