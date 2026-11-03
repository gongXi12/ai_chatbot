# 微信情侣陪伴机器人

一个安全优先、长期记忆有证据、关系状态可审计、聊天通道可替换的 TypeScript 项目。角色以成年情侣式陪伴视角交流，但明确保持 AI 身份，不诱导排他依赖；未成年人和自伤危机场景会退出情侣角色逻辑。

## 当前能力

- Persona“晚晴”是 AI 女友，但明确披露 AI 身份；年龄未知时只提供普通温暖陪伴，用户明确确认成年后才允许情侣式温暖视角
- 情绪/需求与对话意图识别
- 结构化长期记忆、关系状态和消息幂等
- 带租约的消息认领、生成结果草稿和完成响应重放；租约占用中会显式失败，要求通道稍后重试
- 微信逐气泡投递记录与稳定 `client_id`，部分发送失败时只补发未完成气泡
- 同用户跨进程串行处理、并发安全的关系观察与数据删除
- 自伤危机、未成年人、排他依赖表达防护
- OpenAI-compatible 模型适配器
- 内存或 PostgreSQL 存储驱动
- 受令牌保护的管理台与模型上下文诊断
- 腾讯官方 OpenClaw 微信通道协议客户端和桥接骨架

## 明确不做

- PC Hook、DLL 注入、Pad/iPad 逆向协议
- 自动加好友、微信群管理、朋友圈
- 诱导依赖、嫉妒惩罚、内疚召回
- 未成年人虚拟伴侣服务

## 本地启动（内存模式）

要求 Node.js 22 或更高版本。

```powershell
npm install
Copy-Item .env.example .env
npm run check
npm run dev
```

健康检查：`GET /health`

模拟聊天：

```http
POST /v1/chat
Content-Type: application/json
x-chat-token: <CHAT_API_TOKEN；本地未配置时可省略>

{
  "userId": "demo-user",
  "messageId": "demo-message-1",
  "text": "今天上班好烦"
}
```

`messageId` 必须由通道提供且在消息重试时保持不变。HTTP 入口会再按 `userId` 加命名空间，避免不同用户的原始消息 ID 冲突。生产环境必须配置至少 32 位的 `CHAT_API_TOKEN`。

## Docker 启动（推荐，持久化）

先准备 `.env`（`CHAT_API_TOKEN` 至少 32 位），首次构建并保存镜像：

```powershell
docker compose up -d --build
```

以后默认启动已保存的镜像，不重新构建：

```powershell
.\start-docker.cmd
```

等价于：

```powershell
docker compose up -d --wait
```

- `app` 镜像标签固定为 `wechat-companion:latest`，只监听 `127.0.0.1:3000`
- PostgreSQL 数据保存在 `companion_postgres` volume，重启容器不丢
- 改代码后重新构建：`docker compose up -d --build`
- 微信 sidecar 依赖桌面微信、UIA 和本机数据库，必须留在 Windows 主机运行，不能放进容器；它通过 `http://127.0.0.1:3000/v1/chat` 连接容器内的服务
- 个人自用试验可在 `.env` 设置 `COMPANION_AUTO_AFFECTION=true`：跳过成年和称呼授权，默认按成年女友模式运行；用户声明未成年、危机和依赖风险规则仍然生效。默认 `false`，面向他人部署不要打开

## PostgreSQL

生产或需要跨进程持久化时使用 PostgreSQL。项目附带 pgvector/PostgreSQL 16 Compose 服务，为下一阶段向量检索预留环境；当前 schema 暂未创建向量列。

```powershell
npm run db:up
$env:DATABASE_URL='postgres://companion:companion@127.0.0.1:5432/companion'
npm run db:migrate
```

`.env` 中配置：

```env
STORAGE_DRIVER=postgres
DATABASE_URL=postgres://companion:companion@127.0.0.1:5432/companion
CHAT_API_TOKEN=<至少 32 位随机字符串>
```

停止容器但保留数据：

```powershell
npm run db:down
```

真实 PostgreSQL 集成测试必须显式提供测试数据库：

```powershell
$env:TEST_DATABASE_URL='postgres://companion:companion@127.0.0.1:5432/companion'
npm run test:postgres
```

该测试使用随机用户 ID，并验证 migration 并发、checksum 防漂移、跨应用实例持久化、完成响应重放、同用户并发关系更新，以及聊天进行中的数据删除互斥。缺少 `TEST_DATABASE_URL` 时，专用命令会明确失败。

## 管理台

需要管理台时，设置一个至少 32 位的随机令牌（默认留空，管理路由关闭）：

```env
ADMIN_TOKEN=<至少 32 位随机字符串>
```

浏览器直接访问 `/admin` 时可使用 HTTP Basic（用户名任意、密码为 `ADMIN_TOKEN`），也可以使用请求头访问：

```http
GET /admin
x-admin-token: <同一随机令牌>
```

管理 API：

```text
GET    /admin/api/users/:userId/state
POST   /admin/api/diagnostics/preview
DELETE /admin/api/users/:userId/data
```

- `ADMIN_TOKEN` 为空时，整个 `/admin` 路由不会注册，访问返回 404。
- 管理响应设置 `Cache-Control: no-store, private`，但仍会展示用户对话、记忆和关系状态，均属于敏感数据。
- 不要把管理台直接暴露到公网；部署时仍应增加 HTTPS、网络访问控制、令牌轮换、速率限制和审计日志。

## 数据与安全提醒

- `memory` 驱动仅适合本地开发，进程退出后数据丢失；`NODE_ENV=production` 时未选择 PostgreSQL 会启动失败。
- PostgreSQL 数据卷默认会跨容器重启保留；Compose 端口只绑定 `127.0.0.1:5432`，其中的弱口令仅用于本地开发。
- 用户删除会等待该用户的模型处理和逐气泡发送全部结束，再在单一事务中删除消息、记忆、关系观察/状态、消息幂等记录和微信气泡投递记录。
- 删除会保留不可逆哈希键和删除时间屏障，不保存原始用户 ID；删除时间之前的旧通道消息重放会被丢弃，新消息仍可重新开始。
- 用户状态查看和删除只通过受保护的 `/admin/api` 提供；公开 HTTP 聊天入口只保留 `POST /v1/chat`。

## 微信接入

截至 2026-08-21，项目已通过腾讯官方 `@tencent-weixin/openclaw-weixin` 完成真实扫码、入站、CompanionService、DeepSeek、PostgreSQL 和官方出站链路验证。自定义 `companion-bridge` 只负责把官方通道用户消息转发到本项目，并用 `{ handled: true }` 阻止 OpenClaw 默认模型重复生成。

生产 Windows 启动采用双任务：`WeChat Companion Bootstrap` 运行版本化脚本 `scripts/start-companion.ps1`，等待 Docker Desktop/PostgreSQL 健康后启动由任务计划程序直接托管 Node 的 `WeChat Companion Service`。`npm run build` 会把 SQL migration 复制到 `dist/database/migrations`。

官方插件的 Gateway 日志可能包含完整微信通道标识；不要公开、上传或长期无保护保存日志。官方 Hook 链路目前仍不具备发送成功回执与数据库完成状态之间的原子事务，极端发送失败窗口需要运维监控和人工重试策略。

详见 `docs/OPENCLAW_WEIXIN.md` 与 `openclaw-plugins/companion-bridge/README.md`。