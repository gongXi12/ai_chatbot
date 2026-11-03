import { describe, expect, it, vi } from 'vitest';
import type { ChatChannel, InboundMessage, InboundMessageHandler, OutboundMessage } from '../../src/channels/ChatChannel.js';
import { ChannelCompanionBridge } from '../../src/channels/ChannelCompanionBridge.js';
import { InMemoryOutboundDeliveryRepository } from '../../src/repositories/InMemoryOutboundDeliveryRepository.js';

class RetryingChannel implements ChatChannel {
  private handler?: InboundMessageHandler;
  readonly sent: OutboundMessage[] = [];
  readonly attempted: OutboundMessage[] = [];
  private sendAttempts = 0;

  constructor(private readonly message: InboundMessage) {}

  onMessage(handler: InboundMessageHandler): void { this.handler = handler; }
  async start(): Promise<void> {
    if (!this.handler) throw new Error('handler missing');
    await this.handler(this.message);
  }
  async stop(): Promise<void> {}
  async sendTyping(): Promise<void> {}
  async sendMessage(message: OutboundMessage): Promise<void> {
    this.sendAttempts += 1;
    this.attempted.push(message);
    if (this.sendAttempts === 2) throw new Error('second bubble failed');
    this.sent.push(message);
  }
}

describe('ChannelCompanionBridge', () => {
  it('does not resend an already delivered bubble when a later bubble is retried', async () => {
    const message: InboundMessage = {
      channel: 'openclaw-weixin', accountId: 'account-1', conversationId: 'wx-user-1',
      userId: 'wx-user-1', messageId: '101', type: 'text', text: '你好', receivedAt: new Date(),
    };
    const channel = new RetryingChannel(message);
    const companionService = {
      chatWithDelivery: vi.fn(async (_input, deliver) => {
        const result = {
          duplicate: false, bubbles: ['第一条', '第二条'], safetyLevel: 'safe' as const,
        };
        await deliver(result);
        return result;
      }),
    };
    const bridge = new ChannelCompanionBridge(
      channel,
      companionService as never,
      new InMemoryOutboundDeliveryRepository(),
    );

    await expect(bridge.start()).rejects.toThrow('second bubble failed');
    await channel.start();

    expect(channel.sent.map((item) => item.text)).toEqual(['第一条', '第二条']);
    expect(channel.attempted).toHaveLength(3);
    expect(channel.attempted[1]?.idempotencyKey).toBe(channel.attempted[2]?.idempotencyKey);
    expect(channel.attempted[0]?.idempotencyKey).not.toBe(channel.attempted[1]?.idempotencyKey);
  });

  it('does not retry delivered messages only because typing cancellation fails', async () => {
    const message: InboundMessage = {
      channel: 'openclaw-weixin', accountId: 'account-1', conversationId: 'wx-user-1',
      userId: 'wx-user-1', messageId: '102', type: 'text', text: '你好', receivedAt: new Date(),
    };
    let handler: InboundMessageHandler | undefined;
    const channel: ChatChannel = {
      onMessage(nextHandler) { handler = nextHandler; },
      async start() { await handler?.(message); },
      async stop() {},
      async sendMessage() {},
      async sendTyping(_conversationId, active) { if (!active) throw new Error('typing cancel failed'); },
    };
    const bridge = new ChannelCompanionBridge(
      channel,
      {
        chatWithDelivery: vi.fn(async (_input, deliver) => {
          const result = { duplicate: false, bubbles: ['收到'], safetyLevel: 'safe' as const };
          await deliver(result);
          return result;
        }),
      } as never,
      new InMemoryOutboundDeliveryRepository(),
    );

    await expect(bridge.start()).resolves.toBeUndefined();
  });
});



