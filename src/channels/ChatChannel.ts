export interface InboundMessage {
  channel: string;
  accountId: string;
  conversationId: string;
  userId: string;
  messageId: string;
  type: 'text' | 'image' | 'voice' | 'video' | 'file';
  text?: string;
  receivedAt: Date;
}

export interface OutboundMessage {
  conversationId: string;
  userId: string;
  text: string;
  idempotencyKey?: string;
}

export type InboundMessageHandler = (message: InboundMessage) => Promise<void>;

export interface ChatChannel {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(message: OutboundMessage): Promise<void>;
  sendTyping?(conversationId: string, active: boolean): Promise<void>;
  onMessage(handler: InboundMessageHandler): void;
}
