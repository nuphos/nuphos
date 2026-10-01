# Slack App 重构方案：接入 Thinking Steps（ZEA-9917）

> 状态：**已实施（2026-07-03）** — 核心解耦（后端订阅 AgentRun 事件流自动翻译）已落地：
> `lib/slack/stream-sink.ts`（帧 → Slack chunk 翻译）+ `lib/slack/stream.ts`（流生命周期：
> 惰性开流、心跳保活、task 注册表与收尾补全）+ `runAgentForTrigger` 的 `frameSink` 挂点。
> 与本方案的差异：未引入 `@slack/web-api`（沿用手写 `slackApi()`）；事件体系走 agent_view
> （`message.im` / `app_home_opened`）而非 assistant_view；`slack_reply` 已删除（文本即回复、
> 工具调用即卡片），`slack_react` / `slack_search` 保留；新增 plan 审批卡片（查看 / 批准按钮，
> 批准后以合成用户消息自动发起执行 turn）。以下为当时的设计原文。
>
> **Phase 2 映射补全（2026-07-03 二期）** — `reasoning-start/delta/end` → "Thinking" 卡片
> （推理文本以滚动尾部写入卡片 `details`，与正文共用 700ms 合并 flush，一次 append 同时携带
> 文本增量与卡片更新）；`tool-input-available` 附带入参摘要（query/command/url → `details`）；
> `tool-output-available` 附带结果摘要（`output`：结果数 / exit code / 错误文本）与来源链接
> （`sources`：web_search / web_fetch / slack_search 的命中 URL 芯片）；`skill` 工具卡片隐藏
> （与桌面端 Agent 面板一致，视为 setup 噪声）。task 注册表升级为全字段
> （title/details/output/sources）记忆并在每次更新时重发 —— Slack 对 task_update 是整体替换
> 而非合并，缺字段即清空。
> 关联：[ZEA-9917](https://linear.app/zeabur/issue/ZEA-9917)
> 参考：[Make your AI agent think out loud in Slack](https://slack.dev/slack-thinking-steps-ai-agents/)

## 背景与决策

现有 Slack 集成是**经典 Bot App**，出站只用 `chat.postMessage` 发纯文本，agent 的思考过程对用户完全不可见。Slack 官方的 thinking steps 要求 **Agents & AI Apps** 类型 + 流式 API（`chat.startStream` / `appendStream` / `stopStream`）。

因处于初期，采用**推倒重来**。已锁定决策：

1. **引入 `@slack/web-api` SDK**（≥ v7.14.0，提供 streaming helper），出站全部迁移过去；入站验签保留现有 Hono 实现。
2. **DM assistant 容器为主**（app home、suggested prompts、`assistant.threads.setStatus`），**同时保留频道 `@mention`**。

## 核心架构转变

|                       | 现状                          | 重构后                                             |
| --------------------- | ----------------------------- | -------------------------------------------------- |
| Slack 应用类型        | 经典 Bot App                  | Agents & AI Apps（assistant）                      |
| 出站 API              | `chat.postMessage` 纯文本追加 | `chat.startStream` / `appendStream` / `stopStream` |
| 谁决定往 Slack 发什么 | 模型主动调 `slack_reply` 工具 | **后端订阅 `AgentRun` 事件流自动翻译**             |
| 内容形态              | 纯文本，多条切分              | Markdown / Task Card / Plan / URL Sources          |
| 思考过程              | 不可见                        | 实时 thinking steps（Plan / Timeline）             |

**关键解耦**：现状下模型必须记得调 `slack_reply`，还要靠 `publishForcedFinalSlackReply`（`routes/slack.ts:329`）这种 hack 兜底。重构后，后端订阅 `AgentRun.frames`（`routes/agent.ts:1184`，`frames: string[]` + `subscribers` + `poke()`，正是 Web 端中途加入所消费的流），**模型只管干活，思考步骤可视化是后端自动产物**。

## 目标分层架构

```
Transport 层  routes/slack.ts（瘦身为纯入站）
  · 验签 / 幂等(claimSlackEvent) / 事件分发
  · 新增 assistant 事件：assistant_thread_started / assistant_thread_context_changed
        │ 触发
Session 映射层  lib/slack/agent-bot.ts（保留 + 扩展 assistant thread 绑定）
        │ runAgentForTrigger(onRun → sink)
Agent 执行层  routes/agent.ts（几乎不动，仅加 onRun 回调）
  · 产出 AgentRun（frames 事件流）——已有，复用
        │ 订阅 run.subscribers
★ SlackStreamSink  lib/slack/stream-sink.ts
  · 订阅 run.frames → 解析 SSE → 驱动一条 Slack 流
  · 生命周期：startStream → appendStream* → stopStream，含节流与重试
★ ChunkMapper  lib/slack/chunk-mapper.ts
  · SSE 事件 → Slack chunk 的纯映射
```

## 事件映射（thinking steps 核心）

`AgentRun.frames` 是 SSE 帧，格式 `data: ${JSON.stringify({type, ...})}\n\n`，来自 AI SDK 的 UI message stream 加内部帧（`phase` / done / turn-complete / turn-paused）。映射表：

| AgentRun SSE 帧 type                        | Slack chunk                    | 说明               |
| ------------------------------------------- | ------------------------------ | ------------------ |
| `start` / 首个 `start-step`                 | `chat.startStream` 开流        | 一个 turn 一条流   |
| `start-step`                                | 新建 Plan/Timeline 段          | 标记新一轮推理     |
| `reasoning-start` / `reasoning-delta`       | Markdown / context block       | 模型思考（可折叠） |
| `tool-input-start` / `tool-input-available` | Task Card（进行中）            | 工具开始执行       |
| `tool-output-available`                     | Task Card（完成）+ URL Sources | 工具结果，附引用   |
| `tool-output-error`                         | Task Card（失败）              |                    |
| `text-start` / `text-delta`                 | 最终答复 Markdown 累积         | 用户看到的回答     |
| `finish` / done / turn-paused               | `chat.stopStream` 收流         |                    |

> 注：上表 type 名以 AI SDK UI message stream 为准，实施时需对照真实 frame（在 `appendAgentRunFrame`，`routes/agent.ts:1409` 落点）校准，尤其 `start-step` vs 持久化层用的 `step-start`、以及 tool 帧的具体字段。

## 文件改动清单

### 新建

- `lib/slack/web-client.ts` — 封装 `@slack/web-api` 的 `WebClient`，提供 `startStream/appendStream/stopStream`，替换手写 `slackApi()` fetch。**构造时按 `team_id` 解析 bot token（见「Marketplace / 多租户 OAuth」），不得直接读全局 `config.slack.botToken`。**
- `lib/slack/stream-sink.ts` — `SlackStreamSink`：订阅 `run`、维护流生命周期、节流 `appendStream`（Slack 有速率限制，需 buffer/合并）、错误兜底（流失败时降级为单条消息）。
- `lib/slack/chunk-mapper.ts` — 纯函数：SSE 帧 → chunk（Markdown / Task Card / Plan / URL Sources）。
- `lib/slack/types.ts` — chunk 与事件类型定义。

### 改写

- `routes/slack.ts`（971 行 → 大幅瘦身）：只留 transport（验签、幂等、事件路由），新增 assistant 事件处理；删除全部出站文本拼装。
- `routes/agent.ts` `runAgentForTrigger`（`agent.ts:4953`）：`TriggerRunParams` 新增 `onRun?: (run: AgentRun) => void`，在 `registerAgentRun(run)` 后回调，让 sink 拿到 `run` 订阅。**这是唯一需要碰 agent 核心的地方，改动极小。**
- `lib/slack/agent-bot.ts`：扩展 assistant DM thread ↔ session 绑定（现有 channel/user 映射保留）。
- `config.ts`（`slack:` 块，`config.ts:258`）：保留 `signingSecret/botToken/botUserId/agentUserId`，按需新增 assistant 所需配置。

### 删除（纯文本时代产物）

- `routes/slack.ts`：`splitSlackText` / `postThreadMessage` / `createSlackReplyToolContext` / `publishForcedFinalSlackReply` / ACK 文案数组。
- `lib/agent/tools-skilled.ts`：`slack_reply` 工具及 `SlackReplyTool*` 类型（出站不再经模型）。

## 分阶段实施

- **Phase 0 — 新 App + 配置（人工前置）**
  - Slack 后台新建 Agents & AI App；scopes：`assistant:write`、`chat:write`、`im:history`、`app_mentions:read` 等；订阅事件：`assistant_thread_started`、`assistant_thread_context_changed`、`message.im`、`app_mention`。
  - 安装到 workspace，配好新 token/signing secret 到 env 与 `config.slack`。
- **Phase 1 — 出站流式骨架**
  - 加依赖 `@slack/web-api`（当前未安装）；实现 `web-client.ts` + `SlackStreamSink`，先只把 `text-delta` 流式发出，验证 start/append/stop 通路。
  - `runAgentForTrigger` 接 `onRun`，slack 路由把 sink 挂上。
  - **架构约束（为上架预留）**：出站 token 必须通过 `getSlackBotToken(teamId)` 这类**按 team 解析的接口**获取，`web-client.ts` 只认这个接口。Phase 1 阶段该接口背后可以暂时仍返回全局 `config.slack.botToken`（单工作区自用不受影响），但**全代码不得再直接读 `config.slack.botToken`**。将来接 OAuth 多租户时，只换这个接口的实现，发送层无需改动。详见下节。
- **Phase 2 — thinking steps 映射**
  - 实现 `ChunkMapper`，接 `start-step` / `tool-*` / `reasoning-*` → Task Card / Plan / Sources。
- **Phase 3 — assistant 体验**
  - DM 容器下 `assistant_thread_started`、suggested prompts、`assistant.threads.setStatus`（"正在思考…"）。
- **Phase 4 — 清理**
  - 删除 `slack_reply` 与所有纯文本兜底；回归 channel `@mention` + DM 两条入口。

## Marketplace 上架 / 多租户 OAuth

目标：本次重构的 App 后续要能上架 Slack Marketplace（AI agent 是官方重点品类）。应用类型已满足，但**当前单工作区、单 token 架构不满足上架要求**，需提前在 Phase 1 留好接口，避免后期重写发送层。

### 现状缺口

- `config.slack.botToken`（`config.ts:260`）是 env 写死的单一 `xoxb-` token，只服务自有 workspace。
- 频道/用户映射靠手动 `PUT /mappings`（`slack.ts:880`），没有安装流程。
- Marketplace 强制要求标准 OAuth 公开分发，**禁止写死 token**。

### Phase 1 必须落地的架构约束

- 新增 **`getSlackBotToken(teamId): Promise<string>`**（建议放 `lib/slack/agent-bot.ts` 或新 `lib/slack/tokens.ts`）作为唯一取 token 入口。
- `web-client.ts`、`SlackStreamSink` 一律经此接口取 token；**全代码禁止直接读 `config.slack.botToken`**。
- Phase 1 实现可暂时 `return config.slack.botToken`（自用不变）；多租户化时只换实现。

### 上架前补齐（后续阶段，不阻塞自用）

1. **OAuth 安装流程**：`oauth/v2/authorize` → 回调换 token，按 workspace 各自授权。
2. **多租户 token 存储**：按 `team_id` 持久化每个 workspace 的 bot token，`getSlackBotToken` 从此处查。
3. **去掉手动映射**：安装即开通，内部 mapping 接口不对外暴露。
4. **合规**：最小化 scope、Slack App Review + 安全审查、隐私政策、支持联系方式、数据使用披露。
5. 签名校验已具备（`verifySlackSignature`，`slack.ts:125`）✓。

## 风险与注意

- **速率限制**：`appendStream` 不能逐 token 发，需在 sink 内 buffer + 定时 flush（如 ~250–500ms 或按 chunk 边界）。
- **字符上限**：Task Card / Markdown 块有长度限制，长 reasoning/tool 输出需截断或折叠。
- **流生命周期与 abort**：`AgentRun` 可能 abort/error/paused（`appendAgentRunError` / `turn-paused`），sink 必须保证任何终止路径都 `stopStream`，避免悬挂的流。
- **幂等**：现有 `claimSlackEvent` / `markSlackEvent` 防重保留，避免同一事件开两条流。
- **多入口**：DM（assistant thread）与频道（`app_mention` thread）走同一 sink，仅 thread 定位与 status 语义不同。
