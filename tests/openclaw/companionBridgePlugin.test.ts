import { describe, expect, it, vi } from 'vitest';

interface HookContext {
  channelId?: string;
  channel?: string;
  messageProvider?: string;
  senderId?: string;
  runId?: string;
  sessionKey?: string;
  trigger?: string;
}

interface HookResult {
  handled: boolean;
  reply?: { text?: string };
  reason?: string;
}

interface HookModule {
  createCompanionBridgeHandlers(options: {
    endpoint: string;
    token: string;
    accountId: string;
    timeoutMs?: number;
    failureMessage?: string;
    fetcher?: typeof fetch;
    logger?: { error(message: string): void };
  }): {
    messageReceived: (
      event: {
        from: string;
        content: string;
        timestamp?: number;
        messageId?: string;
        sessionKey?: string;
      },
      context: { channelId?: string; accountId?: string; sessionKey?: string },
    ) => void;
    beforeAgentReply: (
      event: { cleanedBody: string },
      context: HookContext,
    ) => Promise<HookResult | void>;
  };
  createBeforeAgentReplyHandler(options: {
    endpoint: string;
    token: string;
    accountId: string;
    timeoutMs?: number;
    failureMessage?: string;
    fetcher?: typeof fetch;
    logger?: { error(message: string): void };
  }): (event: { cleanedBody: string }, context: HookContext) => Promise<HookResult | void>;
}

const pluginModuleUrl = new URL('../../openclaw-plugins/companion-bridge/index.mjs', import.meta.url);

async function loadHookModule(): Promise<HookModule> {
  return import(pluginModuleUrl.href) as Promise<HookModule>;
}

describe('OpenClaw Companion bridge plugin', () => {
  it('claims Weixin user turns and returns CompanionService bubbles as one reply', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        'content-type': 'application/json',
        'x-chat-token': 'bridge-secret',
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        userId: 'openclaw-weixin:account-1:wx-user-1',
        messageId: 'run-1',
        text: '今天好累',
      });
      return new Response(JSON.stringify({
        duplicate: false,
        bubbles: ['先抱抱你', '今天发生什么了？'],
        safetyLevel: 'safe',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const { createBeforeAgentReplyHandler } = await loadHookModule();
    const handler = createBeforeAgentReplyHandler({
      endpoint: 'http://127.0.0.1:3000/v1/chat',
      token: 'bridge-secret',
      accountId: 'account-1',
      fetcher,
    });

    const result = await handler(
      { cleanedBody: '今天好累' },
      {
        channelId: 'openclaw-weixin',
        senderId: 'wx-user-1',
        runId: 'run-1',
        trigger: 'user',
      },
    );

    expect(result).toEqual({
      handled: true,
      reply: { text: '先抱抱你\n\n今天发生什么了？' },
      reason: 'companion-service',
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('does not claim non-Weixin or non-user turns', async () => {
    const fetcher = vi.fn();
    const { createBeforeAgentReplyHandler } = await loadHookModule();
    const handler = createBeforeAgentReplyHandler({
      endpoint: 'http://127.0.0.1:3000/v1/chat',
      token: 'bridge-secret',
      accountId: 'account-1',
      fetcher,
    });

    await expect(handler(
      { cleanedBody: 'hello' },
      { channelId: 'telegram', senderId: 'u1', runId: 'r1', trigger: 'user' },
    )).resolves.toBeUndefined();
    await expect(handler(
      { cleanedBody: 'heartbeat' },
      { channelId: 'openclaw-weixin', senderId: 'u1', runId: 'r2', trigger: 'heartbeat' },
    )).resolves.toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails closed when CompanionService is unavailable', async () => {
    const logger = { error: vi.fn() };
    const fetcher = vi.fn(async () => new Response('unavailable', { status: 503 }));
    const { createBeforeAgentReplyHandler } = await loadHookModule();
    const handler = createBeforeAgentReplyHandler({
      endpoint: 'http://127.0.0.1:3000/v1/chat',
      token: 'bridge-secret',
      accountId: 'account-1',
      failureMessage: '我这边暂时有点卡住了，请稍后再试一下。',
      fetcher,
      logger,
    });

    const result = await handler(
      { cleanedBody: '在吗' },
      {
        channelId: 'openclaw-weixin',
        senderId: 'wx-user-1',
        runId: 'run-2',
        trigger: 'user',
      },
    );

    expect(result).toEqual({
      handled: true,
      reply: { text: '我这边暂时有点卡住了，请稍后再试一下。' },
      reason: 'companion-service-error',
    });
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('silences discarded or duplicate turns with no bubbles', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      duplicate: true,
      discarded: true,
      bubbles: [],
      safetyLevel: 'safe',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const { createBeforeAgentReplyHandler } = await loadHookModule();
    const handler = createBeforeAgentReplyHandler({
      endpoint: 'http://127.0.0.1:3000/v1/chat',
      token: 'bridge-secret',
      accountId: 'account-1',
      fetcher,
    });

    await expect(handler(
      { cleanedBody: '重复消息' },
      {
        channelId: 'openclaw-weixin',
        senderId: 'wx-user-1',
        runId: 'run-3',
        trigger: 'user',
      },
    )).resolves.toEqual({ handled: true, reason: 'companion-service-empty' });
  });
  it('recognizes the provider when channelId is the native conversation target', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      duplicate: false,
      bubbles: ['已接管'],
      safetyLevel: 'safe',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const { createBeforeAgentReplyHandler } = await loadHookModule();
    const handler = createBeforeAgentReplyHandler({
      endpoint: 'http://127.0.0.1:3000/v1/chat',
      token: 'bridge-secret',
      accountId: 'account-1',
      fetcher,
    });

    await expect(handler(
      { cleanedBody: '真实上下文' },
      {
        messageProvider: 'openclaw-weixin',
        channel: 'openclaw-weixin',
        channelId: 'wx-user-1',
        senderId: 'wx-user-1',
        runId: 'run-real-1',
        trigger: 'user',
      },
    )).resolves.toMatchObject({ handled: true, reason: 'companion-service' });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('uses message_received metadata when before_agent_reply has no runId', async () => {
    const receivedAt = Date.parse('2026-08-20T13:34:13.836Z');
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        userId: 'openclaw-weixin:account-1:wx-user-1',
        messageId: 'weixin-message-sid-1',
        text: '桥接联调001',
        receivedAt: '2026-08-20T13:34:13.836Z',
      });
      return new Response(JSON.stringify({
        duplicate: false,
        bubbles: ['桥接成功'],
        safetyLevel: 'safe',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const { createCompanionBridgeHandlers } = await loadHookModule();
    const handlers = createCompanionBridgeHandlers({
      endpoint: 'http://127.0.0.1:3000/v1/chat',
      token: 'bridge-secret',
      accountId: 'account-1',
      fetcher,
    });

    handlers.messageReceived(
      {
        from: 'wx-user-1',
        content: '桥接联调001',
        timestamp: receivedAt,
        messageId: 'weixin-message-sid-1',
        sessionKey: 'session-1',
      },
      {
        channelId: 'openclaw-weixin',
        accountId: 'account-1',
        sessionKey: 'session-1',
      },
    );

    await expect(handlers.beforeAgentReply(
      { cleanedBody: '桥接联调001' },
      {
        messageProvider: 'openclaw-weixin',
        channel: 'openclaw-weixin',
        channelId: 'wx-user-1',
        sessionKey: 'session-1',
        trigger: 'user',
      },
    )).resolves.toEqual({
      handled: true,
      reply: { text: '桥接成功' },
      reason: 'companion-service',
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
