import { z } from 'zod';
import type {
  ChatChannel,
  InboundMessage,
  InboundMessageHandler,
  OutboundMessage,
} from './ChatChannel.js';

interface WeixinApi {
  getUpdates(cursor: string): Promise<{
    msgs: unknown[];
    get_updates_buf: string;
    longpolling_timeout_ms?: number;
  }>;
  sendText(input: {
    toUserId: string; text: string; contextToken?: string; clientId?: string;
  }): Promise<void>;
  getTypingTicket(toUserId: string, contextToken?: string): Promise<string | undefined>;
  sendTyping(input: { toUserId: string; typingTicket: string; active: boolean }): Promise<void>;
}

interface Options {
  pollContinuously?: boolean;
  onError?: (error: unknown) => void;
}

const textMessageSchema = z.object({
  message_id: z.union([z.string(), z.number()]).transform(String),
  from_user_id: z.string().min(1),
  create_time_ms: z.number(),
  message_type: z.number(),
  item_list: z.array(
    z.object({
      type: z.number(),
      text_item: z.object({ text: z.string() }).optional(),
    }),
  ),
  context_token: z.string().optional(),
});

function firstTextItem(items: z.infer<typeof textMessageSchema>['item_list']): string | undefined {
  return items.find((item) => item.type === 1 && item.text_item?.text)?.text_item?.text;
}

export class OpenClawWeixinChannel implements ChatChannel {
  private readonly handlers: InboundMessageHandler[] = [];
  private readonly processedMessageIds = new Set<string>();
  private readonly contextTokens = new Map<string, string>();
  private readonly typingTickets = new Map<string, string>();
  private running = false;
  private cursor = '';

  constructor(
    private readonly accountId: string,
    private readonly api: WeixinApi,
    private readonly options: Options = {},
  ) {}

  onMessage(handler: InboundMessageHandler): void {
    this.handlers.push(handler);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      do {
        try {
          await this.pollOnce();
        } catch (error) {
          this.options.onError?.(error);
          if (!this.options.pollContinuously) throw error;
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
      } while (this.running && this.options.pollContinuously !== false);
    } finally {
      this.running = false;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    const contextToken = this.contextTokens.get(message.conversationId);
    await this.api.sendText({
      toUserId: message.userId,
      text: message.text,
      ...(contextToken ? { contextToken } : {}),
      ...(message.idempotencyKey ? { clientId: message.idempotencyKey } : {}),
    });
  }

  async sendTyping(conversationId: string, active: boolean): Promise<void> {
    const contextToken = this.contextTokens.get(conversationId);
    let typingTicket = this.typingTickets.get(conversationId);
    if (!typingTicket) {
      typingTicket = await this.api.getTypingTicket(conversationId, contextToken);
      if (typingTicket) this.typingTickets.set(conversationId, typingTicket);
    }
    if (!typingTicket) return;

    await this.api.sendTyping({
      toUserId: conversationId,
      typingTicket,
      active,
    });
  }

  private async pollOnce(): Promise<void> {
    const update = await this.api.getUpdates(this.cursor);
    for (const rawMessage of update.msgs) {
      const parsed = textMessageSchema.safeParse(rawMessage);
      if (!parsed.success || parsed.data.message_type !== 1) continue;
      if (this.processedMessageIds.has(parsed.data.message_id)) continue;

      const text = firstTextItem(parsed.data.item_list);
      if (!text) continue;

      const conversationId = parsed.data.from_user_id;
      if (parsed.data.context_token) {
        this.contextTokens.set(conversationId, parsed.data.context_token);
      }

      const message: InboundMessage = {
        channel: 'openclaw-weixin',
        accountId: this.accountId,
        conversationId,
        userId: parsed.data.from_user_id,
        messageId: parsed.data.message_id,
        type: 'text',
        text,
        receivedAt: new Date(parsed.data.create_time_ms),
      };

      for (const handler of this.handlers) {
        await handler(message);
      }
      this.processedMessageIds.add(parsed.data.message_id);
    }

    this.cursor = update.get_updates_buf;
  }
}



