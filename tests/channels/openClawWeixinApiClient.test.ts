import { describe, expect, it } from 'vitest';
import { OpenClawWeixinApiClient } from '../../src/channels/OpenClawWeixinApiClient.js';

describe('OpenClawWeixinApiClient', () => {
  it('sends text using the current Tencent iLink message envelope and endpoint', async () => {
    let requestedUrl = '';
    let requestedInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      requestedUrl = String(input);
      requestedInit = init;
      return new Response(JSON.stringify({ ret: 0 }), { status: 200 });
    };
    const client = new OpenClawWeixinApiClient(
      { baseUrl: 'https://ilinkai.weixin.qq.com', botToken: 'bot-token' },
      fetcher,
    );

    await client.sendText({
      toUserId: 'peer-id', text: '你好', contextToken: 'ctx-1', clientId: 'stable-client-id',
    });

    const headers = requestedInit?.headers as Record<string, string>;
    const body = JSON.parse(requestedInit?.body as string);
    expect(requestedUrl).toBe('https://ilinkai.weixin.qq.com/ilink/bot/sendmessage');
    expect(headers.Authorization).toBe('Bearer bot-token');
    expect(headers.AuthorizationType).toBe('ilink_bot_token');
    expect(headers['iLink-App-Id']).toBe('bot');
    expect(headers['X-WECHAT-UIN']).toMatch(/^[A-Za-z0-9+/]+=*$/u);
    expect(body).toMatchObject({
      msg: {
        to_user_id: 'peer-id',
        client_id: 'stable-client-id',
        message_type: 2,
        message_state: 2,
        context_token: 'ctx-1',
        item_list: [{ type: 1, text_item: { text: '你好' } }],
      },
      base_info: { bot_agent: 'WechatCompanion/0.1.0' },
    });
  });

  it('sends typing with the documented user id, ticket and cancel status', async () => {
    let requestedInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (_input, init) => {
      requestedInit = init;
      return new Response(JSON.stringify({ ret: 0 }), { status: 200 });
    };
    const client = new OpenClawWeixinApiClient(
      { baseUrl: 'https://ilinkai.weixin.qq.com', botToken: 'bot-token' },
      fetcher,
    );

    await client.sendTyping({ toUserId: 'peer-id', typingTicket: 'ticket', active: false });

    expect(JSON.parse(requestedInit?.body as string)).toMatchObject({
      ilink_user_id: 'peer-id',
      typing_ticket: 'ticket',
      status: 2,
    });
  });

  it('throws when the backend returns a non-zero ret code', async () => {
    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify({ ret: -14, errmsg: 'session timeout' }), { status: 200 });
    const client = new OpenClawWeixinApiClient(
      { baseUrl: 'https://ilinkai.weixin.qq.com', botToken: 'bot-token' },
      fetcher,
    );

    await expect(client.getUpdates('')).rejects.toThrow('session timeout');
  });
});

