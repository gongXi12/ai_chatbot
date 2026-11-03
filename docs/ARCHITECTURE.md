# 架构

## 分层

```text
Routes -> Controllers -> Services -> Repositories
                      -> Model Adapter
                      -> Channel Adapter
```

## 消息路径

```text
InboundMessage
  -> 输入验证与幂等占位
  -> 安全预检
  -> 状态分析
  -> 记忆检索
  -> 上下文构建
  -> 对话行为规划
  -> 模型生成
  -> 输出安全与风格检查
  -> 气泡拆分
  -> 记忆/关系更新
  -> 完成幂等记录
  -> 逐气泡发送与投递确认
```

模型生成或后续处理失败时会释放 `processing` 幂等占位，使通道能够重试；如果另一 worker 的租约仍有效，则显式返回失败而不是空成功响应。微信通道只有在 handler 全部成功后才记录消息 ID 并推进游标。关系状态不会在重复消息上再次累加。微信桥接层为每个输入消息和气泡序号生成稳定 `client_id`，成功发送后写入 `outbound_deliveries`；重试只补发未确认气泡，typing 失败不触发业务消息重放。

## 关键边界

- 渠道只负责收发，不包含伴侣业务逻辑。
- 模型只负责生成，不是状态数据库。
- 关系状态是结构化数据，不能只写进 Prompt。
- 长期记忆必须带来源消息 ID、时间、置信度和状态；更正旧记忆时，新记忆写入和旧记忆 supersede 必须在同一事务。
- 安全判断独立于 Persona 和记忆，个性化不能放宽危险请求审查。
- 管理诊断只读取上下文，不更新关系状态或记忆。

## 存储

Repository 接口支持两个实现：

- `memory`：进程内 Map，仅用于开发和快速测试。
- `postgres`：持久化 `message_processing`、`conversation_messages`、`memories`、`relationship_states`、`outbound_deliveries`。

Runtime 自己创建 PostgreSQL Pool 时会通过 schema_migrations、SHA-256 checksum 和 advisory lock 顺序执行 migration；已应用脚本发生变化时启动会失败。在 Fastify 关闭时结束自有 Pool；测试或宿主注入 Pool 时，宿主负责 migration 和生命周期。

真实 PostgreSQL 通过 `docker-compose.yml` 启动 pgvector/PostgreSQL 16。当前检索仍为结构化内存评分，后续可新增 embedding/vector 列而不更换数据库镜像。

## 管理边界

- `ADMIN_TOKEN` 为空时不注册管理路由。
- 配置令牌后，所有 `/admin` 页面和 API 都要求 `x-admin-token`。
- 管理台不应公网裸露；生产环境还需要反向代理身份认证、TLS、网络 ACL、审计和速率限制。
- 公开聊天 API 只接收消息，可通过 CHAT_API_TOKEN 保护；生产环境强制至少 32 位。用户状态和删除仅通过受保护的管理 API 提供。

## 数据删除

用户删除会清理：

1. 对话消息
2. 消息处理/幂等记录
3. 结构化记忆
4. 关系状态
5. 微信逐气泡投递记录

同时保留一条不含原始用户 ID 的删除时间屏障。聊天生成、逐气泡发送确认和删除共享每用户操作锁；PostgreSQL 使用 advisory lock 跨 runtime 串行化。删除在单一事务中完成，并写入只含 SHA-256 用户键的 `user_deletions` 时间屏障。删除返回 204 后不会继续发送，且删除时间之前的旧通道消息重放会被丢弃。

## 风险评估

- Architectural Fit: 5
- Testability: 5
- Complexity: 3
- Data Risk: 4（持久化敏感对话与关系信息）
- Operational Risk: 3
- 主要控制：输入验证、独立安全层、管理路由默认关闭、受保护诊断、显式数据删除、SQL 与真实 PostgreSQL 集成测试。






