import { createHash } from 'node:crypto';
import type { ChatChannel } from './ChatChannel.js';
import type { CompanionService } from '../services/companionService.js';
import { InMemoryOutboundDeliveryRepository } from '../repositories/InMemoryOutboundDeliveryRepository.js';
import type { OutboundDeliveryRepository } from '../repositories/OutboundDeliveryRepository.js';

function deliveryIdentity(messageId: string, bubbleIndex: number): { id: string; clientId: string } {
  const id = `${messageId}:bubble:${bubbleIndex}`;
  const digest = createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 32);
  return { id, clientId: `wechat-companion-${digest}` };
}

export class ChannelCompanionBridge {
  constructor(
    private readonly channel: ChatChannel,
    private readonly companionService: CompanionService,
    private readonly deliveries: OutboundDeliveryRepository = new InMemoryOutboundDeliveryRepository(),
  ) {}

  async start(): Promise<void> {
    this.channel.onMessage(async (message) => {
      if (message.type !== 'text' || !message.text) return;

      try {
        await this.channel.sendTyping?.(message.conversationId, true);
      } catch {
        // Typing indicators are best-effort and must not block message delivery.
      }

      try {
        const serviceUserId = `${message.channel}:${message.accountId}:${message.userId}`;
        const serviceMessageId = `${message.channel}:${message.accountId}:${message.messageId}`;
        await this.companionService.chatWithDelivery({
          userId: serviceUserId,
          messageId: serviceMessageId,
          text: message.text,
          receivedAt: message.receivedAt,
        }, async (result) => {
          for (const [bubbleIndex, bubble] of result.bubbles.entries()) {
            const delivery = deliveryIdentity(serviceMessageId, bubbleIndex);
            if (await this.deliveries.isDelivered(delivery.id)) continue;

            await this.channel.sendMessage({
              conversationId: message.conversationId,
              userId: message.userId,
              text: bubble,
              idempotencyKey: delivery.clientId,
            });
            await this.deliveries.markDelivered({
              id: delivery.id,
              userId: serviceUserId,
              channel: message.channel,
              accountId: message.accountId,
              inboundMessageId: message.messageId,
              bubbleIndex,
              clientId: delivery.clientId,
              deliveredAt: new Date(),
            });
          }
        });
      } finally {
        try {
          await this.channel.sendTyping?.(message.conversationId, false);
        } catch {
          // Typing cancellation is best-effort and must not trigger message replay.
        }
      }
    });

    await this.channel.start();
  }

  async stop(): Promise<void> {
    await this.channel.stop();
  }
}

