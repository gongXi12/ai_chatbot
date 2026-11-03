# Companion Service Bridge

OpenClaw plugin that correlates `message_received` with `before_agent_reply` for user turns arriving from the official `openclaw-weixin` channel and forwards them to this project's `POST /v1/chat` endpoint.

## Safety and routing properties

- Tencent's official Weixin plugin remains the only component polling and sending Weixin messages.
- `message_received` captures the best inbound identity exposed by the installed official plugin; `before_agent_reply` consumes it and returns a synthetic reply, so OpenClaw's default model does not generate the turn.
- CompanionService failures are handled fail-closed with a fixed user-facing message.
- This bridge does not log tokens or message text and only logs redacted-safe status messages. The upstream official Weixin plugin may still write full channel identifiers to its local Gateway log; protect and rotate those logs accordingly.
- Empty/duplicate CompanionService results are silenced.
- Provider detection uses `messageProvider`/`channel`; real `channelId` values may be native conversation targets.

## Configuration

Configure the OpenClaw plugin entry with:

```json
{
  "endpoint": "http://127.0.0.1:3000/v1/chat",
  "tokenEnv": "COMPANION_CHAT_API_TOKEN",
  "accountId": "3292e50ccbd0-im-bot",
  "timeoutMs": 35000,
  "failureMessage": "我这边暂时有点卡住了，请稍后再试一下。"
}
```

Set `COMPANION_CHAT_API_TOKEN` in the Gateway process environment to the same value as the project's `CHAT_API_TOKEN`. Do not put the token in this plugin's configuration.

Because this is a non-bundled conversation hook, enable `plugins.entries.companion-bridge.hooks.allowConversationAccess` in OpenClaw configuration.