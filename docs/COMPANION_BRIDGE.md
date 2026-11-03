# OpenClaw 微信 CompanionService 桥接

## 目标

微信收发必须由腾讯官方 `@tencent-weixin/openclaw-weixin` 独占。项目自己的 `CompanionService` 只负责聊天、安全策略、关系状态和长期记忆，不直接轮询或发送微信消息。

```text
腾讯官方微信插件
  -> OpenClaw message_received / before_agent_reply
  -> companion-bridge
  -> POST http://127.0.0.1:3000/v1/chat
  -> CompanionService + PostgreSQL + DeepSeek
  -> synthetic reply
  -> 腾讯官方微信插件发送
```

## 为什么使用两个 Hook

真实 OpenClaw 运行时中：

- `message_received` 能拿到官方通道生成的稳定 `messageId`、消息时间、账号和会话信息。
- `before_agent_reply` 可以返回 synthetic reply，阻止 OpenClaw 默认 Agent 再调用模型。
- `before_agent_reply.channelId` 是原生会话目标，不一定等于 `openclaw-weixin`，通道识别应优先检查 `messageProvider` 或 `channel`。
- 当前版本的 `before_agent_reply` 不保证提供 `runId`，因此插件会把 `message_received` 元数据按会话暂存，并在回复 Hook 中消费。

这避免了项目和腾讯插件争抢 `getUpdates`，也避免两套发送器重复发送。

## 插件目录

```text
openclaw-plugins/companion-bridge/
  index.mjs
  openclaw.plugin.json
  package.json
  README.md
```

安装本地链接：

```powershell
openclaw plugins install '.\openclaw-plugins\companion-bridge' --link
```

OpenClaw 配置必须启用插件、允许 conversation hook，并配置本地 `/v1/chat` 地址、环境变量名和正式微信账号 ID。不要把共享 Token 写进 OpenClaw 配置。项目使用 `CHAT_API_TOKEN`，Gateway 进程使用同值的 `COMPANION_CHAT_API_TOKEN`。

## 生产服务

```env
NODE_ENV=production
STORAGE_DRIVER=postgres
DATABASE_URL=postgres://companion:companion@127.0.0.1:5432/companion
CHAT_API_TOKEN=<至少 32 位随机值>
MODEL_PROVIDER=openai-compatible
OPENAI_COMPATIBLE_BASE_URL=https://api.deepseek.com
OPENAI_COMPATIBLE_API_KEY=<secret>
OPENAI_COMPATIBLE_MODEL=deepseek-v4-flash
```

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
openclaw gateway status --deep --require-rpc
openclaw channels status --json
openclaw plugins inspect companion-bridge --runtime --json
```

## 端到端验收标准

1. 官方微信插件记录入站。
2. 日志出现 `companion-bridge: handled turn`。
3. 同一时间窗口没有 OpenClaw 自身的 `model-fetch`。
4. PostgreSQL 的 `message_processing` 为 `completed`。
5. PostgreSQL 保存用户消息、助手气泡和关系状态。
6. 官方微信插件记录 `outbound: text sent OK`。

2026-08-20 的真实联调已验证上述链路：消息在 22:19:26 入站，CompanionService 生成 2 个气泡，22:19:31 由官方微信插件发送成功。