import { describe, expect, it, vi } from 'vitest';
import type { InboundMessage } from '../../src/channels/ChatChannel.js';
import { OpenClawWeixinChannel } from '../../src/channels/OpenClawWeixinChannel.js';

function textUpdate() {
  return {
    ret: 0,
    msgs: [
      {
        message_id: 101,
        from_user_id: 'wx-user-1',
        create_time_ms: 1_786_629_600_000,
        message_type: 1,
        item_list: [{ type: 1, text_item: { text: '你好呀' } }],
        context_token: 'ctx-1',
      },
    ],
    get_updates_buf: 'next-cursor',
  };
}

describe('OpenClawWeixinChannel', () => {
  it('normalizes an inbound text item and sends generated bubbles with its context token', async () => {
    const api = {
      getUpdates: vi.fn().mockResolvedValueOnce(textUpdate()),
      sendText: vi.fn().mockResolvedValue(undefined),
      getTypingTicket: vi.fn().mockResolvedValue('typing-ticket'),
      sendTyping: vi.fn().mockResolvedValue(undefined),
    };
    const channel = new OpenClawWeixinChannel('account-1', api, { pollContinuously: false });
    const received: InboundMessage[] = [];
    channel.onMessage(async (message) => {
      received.push(message);
      await channel.sendMessage({
        conversationId: message.conversationId,
        userId: message.userId,
        text: '你好',
      });
    });

    await channel.start();

    expect(received[0]).toMatchObject({
      channel: 'openclaw-weixin',
      accountId: 'account-1',
      userId: 'wx-user-1',
      messageId: '101',
      type: 'text',
      text: '你好呀',
    });
    expect(api.sendText).toHaveBeenCalledWith({
      toUserId: 'wx-user-1',
      text: '你好',
      contextToken: 'ctx-1',
    });
  });

  it('uses getConfig typing tickets rather than parsing them from conversation ids', async () => {
    const api = {
      getUpdates: vi.fn().mockResolvedValueOnce({ ...textUpdate(), msgs: [] }),
      sendText: vi.fn(),
      getTypingTicket: vi.fn().mockResolvedValue('typing-ticket'),
      sendTyping: vi.fn().mockResolvedValue(undefined),
    };
    const channel = new OpenClawWeixinChannel('account-1', api, { pollContinuously: false });

    await channel.sendTyping('wx-user-1', true);

    expect(api.getTypingTicket).toHaveBeenCalledWith('wx-user-1', undefined);
    expect(api.sendTyping).toHaveBeenCalledWith({
      toUserId: 'wx-user-1',
      typingTicket: 'typing-ticket',
      active: true,
    });
  });

  it('ignores duplicate message ids returned by polling', async () => {
    const update = textUpdate();
    const api = {
      getUpdates: vi.fn().mockResolvedValueOnce({
        ...update,
        msgs: [update.msgs[0], update.msgs[0]],
      }),
      sendText: vi.fn(),
      getTypingTicket: vi.fn(),
      sendTyping: vi.fn(),
    };
    const channel = new OpenClawWeixinChannel('account-1', api, { pollContinuously: false });
    const handler = vi.fn(async () => undefined);
    channel.onMessage(handler);

    await channel.start();

    expect(handler).toHaveBeenCalledTimes(1);
  });
  it('does not acknowledge a message or advance the cursor when its handler fails', async () => {
    const update = textUpdate();
    const api = {
      getUpdates: vi.fn()
        .mockResolvedValueOnce(update)
        .mockResolvedValueOnce(update),
      sendText: vi.fn(),
      getTypingTicket: vi.fn(),
      sendTyping: vi.fn(),
    };
    const channel = new OpenClawWeixinChannel('account-1', api, { pollContinuously: false });
    let attempts = 0;
    channel.onMessage(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary handler failure');
    });

    await expect(channel.start()).rejects.toThrow('temporary handler failure');
    await channel.start();

    expect(attempts).toBe(2);
    expect(api.getUpdates).toHaveBeenNthCalledWith(1, '');
    expect(api.getUpdates).toHaveBeenNthCalledWith(2, '');
  });
  it('ignores replayable messages that do not include the original creation timestamp', async () => {
    const update = textUpdate();
    const message = { ...update.msgs[0] } as Record<string, unknown>;
    delete message.create_time_ms;
    const api = {
      getUpdates: vi.fn().mockResolvedValueOnce({ ...update, msgs: [message] }),
      sendText: vi.fn(),
      getTypingTicket: vi.fn(),
      sendTyping: vi.fn(),
    };
    const channel = new OpenClawWeixinChannel('account-1', api, { pollContinuously: false });
    const handler = vi.fn(async () => undefined);
    channel.onMessage(handler);

    await channel.start();

    expect(handler).not.toHaveBeenCalled();
  });
});

