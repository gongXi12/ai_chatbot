# OpenClaw 微信接入

## 当前环境与阻塞

截至 2026-08-13，本机：

```text
OpenClaw 2026.3.28
Node.js 24.14.0
```

腾讯 `openclaw-weixin` 2.4.6 的宿主要求为：

```text
OpenClaw >= 2026.5.12
```

当前 openclaw update status --json 会在升级前被全局配置校验阻断：plugins.entries.clawd-on-desk.hooks.allowConversationAccess 已不是当前宿主识别的字段。为避免擅自改变用户的全局插件配置，本阶段没有执行 openclaw doctor --fix 或全局升级。因此当前仍不能进行可靠的插件安装和扫码联调。项目没有使用 Hook、Pad/iPad 逆向、Gewechat 或桌面 RPA 替代官方接入。

## 已实现

`ChatChannel` 隔离通道层，`OpenClawWeixinApiClient` 和 `OpenClawWeixinChannel` 已按腾讯官方当前 iLink envelope 建立骨架，包括：

- `ilink/bot/getupdates`
- `ilink/bot/sendmessage`
- `ilink/bot/getconfig`
- `ilink/bot/sendtyping`
- `msg/item_list/text_item` 消息结构
- 基于输入消息与气泡序号的稳定 `client_id` 和 PostgreSQL `outbound_deliveries` 投递确认
- 入站文本必须携带原始 `create_time_ms`；缺失时间戳的消息不会进入业务处理，避免删除后旧消息被当作新消息
- `iLink-App-Id: bot`、客户端版本头、随机 base64 `X-WECHAT-UIN`
- `ilink_user_id` typing 目标、typing ticket、cancel status `2`

这些协议细节已有单元测试，但还没有真实账号扫码证据。

## 安全升级流程

升级会修改全局 OpenClaw 安装，不应盲目执行。下一步应先记录安装来源和配置备份，再使用当前安装支持的官方更新命令，升级后立即确认版本满足最低要求。

先备份 ~/.openclaw/openclaw.json，人工确认或修复上述 clawd-on-desk 兼容字段后，再执行：

```powershell
openclaw --version
openclaw update --help
openclaw update
openclaw --version
```

若 `openclaw update` 不适用于当前安装来源，再根据官方文档采用对应包管理器升级；不要混用多个安装方式。

宿主版本满足要求后：

```powershell
npx -y @tencent-weixin/openclaw-weixin-cli install
openclaw channels login --channel openclaw-weixin
openclaw gateway restart
```

然后完成以下联调清单：

1. 扫码登录并确认 token 不写入仓库。
2. 微信发送文本，验证 update 被 Channel 接收。
3. 验证 typing start/cancel。
4. 验证 1～3 个短气泡按顺序返回。
5. 重放相同微信消息，验证 PostgreSQL 幂等。
6. 触发模型失败或第二个气泡发送失败后重试，验证不会重复增长关系状态或重发已确认气泡。
7. 在发送进行中删除用户，验证删除等待发送结束；删除后的旧消息重放被时间屏障丢弃。
8. 验证自伤危机、未成年人和依赖风险场景。
9. 关闭并重启应用，验证记忆和关系状态仍在。

## 能力边界

- 只做 direct chat。
- 不实现好友列表、自动加好友、群管理和朋友圈。
- 不混用 Hook、Pad 协议或桌面 RPA 作为补丁。
- 真实登录取得的 token 只放环境变量或密钥系统，禁止提交仓库。




