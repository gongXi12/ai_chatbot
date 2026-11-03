/* global AbortController, fetch, process, setTimeout, clearTimeout */

const DEFAULT_ENDPOINT = 'http://127.0.0.1:3000/v1/chat';
const DEFAULT_TOKEN_ENV = 'COMPANION_CHAT_API_TOKEN';
const DEFAULT_ACCOUNT_ID = 'default';
const DEFAULT_TIMEOUT_MS = 35_000;
const DEFAULT_FAILURE_MESSAGE = '我这边暂时有点卡住了，请稍后再试一下。';
const PENDING_MESSAGE_TTL_MS = 5 * 60_000;
const MAX_PENDING_MESSAGES = 100;

function asNonEmptyString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function resolveProvider(context) {
  const candidates = [context.messageProvider, context.channel, context.channelId];
  return candidates.find((value) => value === 'openclaw-weixin');
}

function resolveSenderId(context, metadata) {
  const channelTarget = context.channelId === 'openclaw-weixin' ? '' : context.channelId;
  return asNonEmptyString(
    context.senderId
      ?? metadata?.senderId
      ?? context.chatId
      ?? channelTarget,
  );
}

function errorResult(failureMessage) {
  return {
    handled: true,
    reply: { text: failureMessage },
    reason: 'companion-service-error',
  };
}

function createPendingMessageTracker(accountId) {
  const pending = [];

  function prune(now = Date.now()) {
    while (pending.length > 0 && now - pending[0].recordedAt > PENDING_MESSAGE_TTL_MS) {
      pending.shift();
    }
    if (pending.length > MAX_PENDING_MESSAGES) {
      pending.splice(0, pending.length - MAX_PENDING_MESSAGES);
    }
  }

  function record(event, context = {}) {
    if (context.channelId !== 'openclaw-weixin') return;
    if (context.accountId && context.accountId !== accountId) return;

    const messageId = asNonEmptyString(context.messageId ?? event?.messageId);
    const senderId = asNonEmptyString(context.senderId ?? event?.senderId ?? event?.from);
    if (!messageId || !senderId) return;

    const timestamp = Number.isFinite(event?.timestamp) ? event.timestamp : Date.now();
    pending.push({
      messageId,
      senderId,
      sessionKey: asNonEmptyString(context.sessionKey ?? event?.sessionKey),
      text: typeof event?.content === 'string' ? event.content : '',
      receivedAt: new Date(timestamp).toISOString(),
      recordedAt: Date.now(),
    });
    prune();
  }

  function consume(event, context = {}) {
    prune();
    const sessionKey = asNonEmptyString(context.sessionKey);
    const senderId = resolveSenderId(context);
    const text = typeof event?.cleanedBody === 'string' ? event.cleanedBody : '';

    const matchers = [
      (item) => Boolean(sessionKey) && item.sessionKey === sessionKey && item.text === text,
      (item) => Boolean(sessionKey) && item.sessionKey === sessionKey,
      (item) => Boolean(senderId) && item.senderId === senderId && item.text === text,
      (item) => Boolean(senderId) && item.senderId === senderId,
    ];
    const index = matchers
      .map((matches) => pending.findIndex(matches))
      .find((candidate) => candidate >= 0);
    return index === undefined ? undefined : pending.splice(index, 1)[0];
  }

  return { record, consume };
}

export function createBeforeAgentReplyHandler(options) {
  const endpoint = asNonEmptyString(options?.endpoint, DEFAULT_ENDPOINT);
  const token = asNonEmptyString(options?.token);
  const accountId = asNonEmptyString(options?.accountId, DEFAULT_ACCOUNT_ID);
  const timeoutMs = Number.isInteger(options?.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;
  const failureMessage = asNonEmptyString(options?.failureMessage, DEFAULT_FAILURE_MESSAGE);
  const fetcher = options?.fetcher ?? fetch;
  const logger = options?.logger;
  const consumePendingMessage = options?.consumePendingMessage;

  return async function beforeAgentReply(event, context = {}) {
    if (resolveProvider(context) !== 'openclaw-weixin' || context.trigger !== 'user') {
      return undefined;
    }

    const metadata = consumePendingMessage?.(event, context);
    const senderId = resolveSenderId(context, metadata);
    const messageId = asNonEmptyString(context.runId ?? metadata?.messageId);
    const text = typeof event?.cleanedBody === 'string' ? event.cleanedBody : '';
    const receivedAt = asNonEmptyString(metadata?.receivedAt, new Date().toISOString());

    if (!token || !senderId || !messageId) {
      logger?.error('companion-bridge: missing required bridge credentials or message identity');
      return errorResult(failureMessage);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetcher(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-chat-token': token,
        },
        body: JSON.stringify({
          userId: `openclaw-weixin:${accountId}:${senderId}`,
          messageId,
          text,
          receivedAt,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`CompanionService returned HTTP ${response.status}`);
      }

      const payload = await response.json();
      const bubbles = Array.isArray(payload?.bubbles)
        ? payload.bubbles.filter((bubble) => typeof bubble === 'string' && bubble.length > 0)
        : null;

      if (bubbles === null) {
        throw new Error('CompanionService returned an invalid response');
      }

      if (bubbles.length === 0) {
        logger?.info?.('companion-bridge: handled turn with no outbound bubbles');
        return { handled: true, reason: 'companion-service-empty' };
      }

      logger?.info?.(`companion-bridge: handled turn with ${bubbles.length} outbound bubble(s)`);
      return {
        handled: true,
        reply: { text: bubbles.join('\n\n') },
        reason: 'companion-service',
      };
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      logger?.error(`companion-bridge: request failed (${errorName})`);
      return errorResult(failureMessage);
    } finally {
      clearTimeout(timer);
    }
  };
}

export function createCompanionBridgeHandlers(options) {
  const accountId = asNonEmptyString(options?.accountId, DEFAULT_ACCOUNT_ID);
  const tracker = createPendingMessageTracker(accountId);
  return {
    messageReceived: tracker.record,
    beforeAgentReply: createBeforeAgentReplyHandler({
      ...options,
      accountId,
      consumePendingMessage: tracker.consume,
    }),
  };
}

const plugin = {
  id: 'companion-bridge',
  name: 'Companion Service Bridge',
  description: 'Routes official Weixin user turns to the local CompanionService API.',
  register(api) {
    const config = api.pluginConfig ?? {};
    const tokenEnv = asNonEmptyString(config.tokenEnv, DEFAULT_TOKEN_ENV);
    const timeoutMs = Number.isInteger(config.timeoutMs) && config.timeoutMs > 0
      ? config.timeoutMs
      : DEFAULT_TIMEOUT_MS;
    const token = asNonEmptyString(process.env[tokenEnv]);
    api.logger.info(`companion-bridge: token environment is ${token ? 'present' : 'missing'}`);
    const handlers = createCompanionBridgeHandlers({
      endpoint: asNonEmptyString(config.endpoint, DEFAULT_ENDPOINT),
      token,
      accountId: asNonEmptyString(config.accountId, DEFAULT_ACCOUNT_ID),
      timeoutMs,
      failureMessage: asNonEmptyString(config.failureMessage, DEFAULT_FAILURE_MESSAGE),
      logger: api.logger,
    });

    api.on('message_received', handlers.messageReceived);
    api.on('before_agent_reply', handlers.beforeAgentReply, { timeoutMs: timeoutMs + 1_000 });
  },
};

export default plugin;