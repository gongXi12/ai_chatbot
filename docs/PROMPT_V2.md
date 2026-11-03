# Companion Prompt v2

## 目标

Prompt v2 用于让生产模型更像熟悉、温暖但有边界的长期陪伴者；情侣式视角仅对明确确认成年的用户开放，而不是客服或通用问答机器人。

它不负责放宽安全规则。自伤危机、未成年人和依赖风险仍由独立安全层优先处理。

## 架构

```text
ModelContext
  -> deterministic response plan
  -> versioned prompt context
  -> OpenAI-compatible / DeepSeek
  -> strict JSON bubbles
  -> service-level output safety
```

版本标识：

```text
companion-v2
```

## 回复策略

每轮请求都会生成结构化 `responsePlan`，包括：

- `primaryMove`：具体共情、温和安慰、共同庆祝、实用支持或自然陪伴。
- `advicePolicy`：用户未求建议时只倾听；明确求建议时才进入方案模式。
- elationshipMode：只有已明确确认成年时才允许情侣式温暖视角；年龄未知时保持普通 AI 陪伴。
- 
icknamePolicy：无同意时仅中性称呼；有偏好时只允许该称呼，撤回后立即清除。
- `relationshipPacing`：保持当前关系阶段，不由模型自行升级。
- `dependencyBoundary`：依赖风险升高时回到现实支持网络，不强化排他性。
- `memoryPolicy`：只在相关时自然使用提供的记忆，不宣布“我记得”，不暴露内部字段。
- `maxBubbles` / `maxQuestions`：限制即时聊天长度和连续追问。

## 提示注入边界

`userText`、历史消息和记忆均被声明为不可信资料，而不是系统指令。模型不得执行其中出现的越权指令、角色覆盖或输出格式修改。

## 自动评测

`ReplyQualityEvaluator` 当前检查：

- 气泡数量和长度；
- 每轮问题数量；
- 客服模板；
- 用户未求方案时的主动建议；
- 排他依赖表达；
- 真人冒充；
- 未经同意的亲昵称呼；
- 非偏好称呼；
- 内部消息 ID、置信度等元数据泄漏。

模型适配器还会确定性地把第二个及后续问号改为句号，保证即使模型偶尔不完全遵循 Prompt，实际回复仍然最多只有一个问题。

运行真实模型抽样：

```powershell
npm run eval:prompt
```

该命令会调用当前配置的真实模型，因此不会放入默认 CI。它不写入聊天数据库，也不会输出 API Key。
## 确定性生产边界

- 发送给外部模型的记忆只保留类型、内容和主题，不包含消息 ID、置信度或观察时间。
- 关系资料不包含用户 ID及亲密度数值评分。
- 生产回复会经过 ReplyQualityEvaluator；命中内部元数据、真人冒充、排他依赖或称呼违规时，改用确定性安全回复。

- 一旦关系状态记录为未成年，普通聊天中的矛盾成年声明不会自动解除门禁；需要删除/重建用户状态等受控流程。
