import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';

interface Options {
  baseUrl: string;
  botToken: string;
  botAgent?: string;
  channelVersion?: string;
  ilinkAppId?: string;
  ilinkClientVersion?: number;
}

type Fetcher = typeof fetch;

const commonResponseSchema = z.object({
  ret: z.number().default(0),
  errcode: z.number().optional(),
  errmsg: z.string().optional(),
}).passthrough();

const updatesSchema = commonResponseSchema.extend({
  msgs: z.array(z.unknown()).default([]),
  get_updates_buf: z.string().default(''),
  longpolling_timeout_ms: z.number().optional(),
});

const configResponseSchema = commonResponseSchema.extend({
  typing_ticket: z.string().optional(),
});

function encodeClientVersion(version: string): number {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map((part) => Number.parseInt(part, 10));
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
}

function randomWechatUin(): string {
  const uint32 = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), 'utf8').toString('base64');
}

export class OpenClawWeixinApiClient {
  private readonly channelVersion: string;
  private readonly botAgent: string;
  private readonly ilinkAppId: string;
  private readonly ilinkClientVersion: number;

  constructor(
    private readonly options: Options,
    private readonly fetcher: Fetcher = fetch,
  ) {
    this.channelVersion = options.channelVersion ?? '2.4.6';
    this.botAgent = options.botAgent ?? 'WechatCompanion/0.1.0';
    this.ilinkAppId = options.ilinkAppId ?? 'bot';
    this.ilinkClientVersion = options.ilinkClientVersion ?? encodeClientVersion(this.channelVersion);
  }

  private baseInfo(): { channel_version: string; bot_agent: string } {
    return {
      channel_version: this.channelVersion,
      bot_agent: this.botAgent,
    };
  }

  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await this.fetcher(
      `${this.options.baseUrl.replace(/\/$/u, '')}/ilink/bot/${path}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          AuthorizationType: 'ilink_bot_token',
          Authorization: `Bearer ${this.options.botToken}`,
          'X-WECHAT-UIN': randomWechatUin(),
          'iLink-App-Id': this.ilinkAppId,
          'iLink-App-ClientVersion': String(this.ilinkClientVersion),
        },
        body: JSON.stringify({ ...body, base_info: this.baseInfo() }),
        signal: AbortSignal.timeout(45_000),
      },
    );

    if (!response.ok) {
      throw new Error(`Weixin backend failed with HTTP ${response.status}`);
    }

    const payload = commonResponseSchema.parse(await response.json());
    if (payload.ret !== 0) {
      throw new Error(payload.errmsg ?? `Weixin backend returned ret=${payload.ret}`);
    }
    return payload;
  }

  async getUpdates(cursor: string): Promise<z.infer<typeof updatesSchema>> {
    const payload = await this.post('getupdates', { get_updates_buf: cursor });
    return updatesSchema.parse(payload);
  }

  async sendText(input: {
    toUserId: string; text: string; contextToken?: string; clientId?: string;
  }): Promise<void> {
    await this.post('sendmessage', {
      msg: {
        from_user_id: '',
        to_user_id: input.toUserId,
        client_id: input.clientId ?? `wechat-companion-${randomUUID()}`,
        message_type: 2,
        message_state: 2,
        item_list: [{ type: 1, text_item: { text: input.text } }],
        ...(input.contextToken ? { context_token: input.contextToken } : {}),
      },
    });
  }

  async getTypingTicket(toUserId: string, contextToken?: string): Promise<string | undefined> {
    const payload = await this.post('getconfig', {
      ilink_user_id: toUserId,
      ...(contextToken ? { context_token: contextToken } : {}),
    });
    return configResponseSchema.parse(payload).typing_ticket;
  }

  async sendTyping(input: { toUserId: string; typingTicket: string; active: boolean }): Promise<void> {
    await this.post('sendtyping', {
      ilink_user_id: input.toUserId,
      typing_ticket: input.typingTicket,
      status: input.active ? 1 : 2,
    });
  }
}


