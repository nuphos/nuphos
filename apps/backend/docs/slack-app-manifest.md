# Slack App Manifest（Agents & AI Apps，assistant_view：Chat + History）

Nuphos Slack app 的权威配置。后端代码（`src/routes/slack.ts`）按 **assistant_view**
（Assistant messaging experience）实现：App 界面为 **Home / Chat / History / About** 页签，
新对话在 Chat 页签发起、历史会话在 **History 页签**列出（线程标题由
`assistant.threads.setTitle` 维护，回合结束后同步为 LLM 生成的会话标题）。事件走
`assistant_thread_started` / `assistant_thread_context_changed` / `message.im` /
`app_home_opened`。

**App Home（Home tab）**：`app_home_opened`（tab=home）触发 `views.publish`
（`src/lib/slack/home-tab.ts`），按查看者逐用户渲染：欢迎语与使用方法、当前连接的
Nuphos team 与 Slack workspace、查看者绑定的 Nuphos 用户（复用消息链路的邮箱
自动映射，首次打开 Home 页通常即完成绑定）、查看者可用的云凭证（AWS / GCP /
腾讯云 / 阿里云 / 火山引擎 / Linode / Hetzner 按 per-binding member allowlist
过滤；Cloudflare / Zeabur 的 binding 模型没有 allowlist 机制，team-wide 全员可见，
与 REST 行为一致）、已链接的频道列表 + 频道选择器（`nuphos_link_channel`，仅对团队
ADMINISTRATOR 渲染，服务端同样校验 —— 与 `PUT /slack/mappings` 的
`requireTeamAdmin` 对齐；Home 页来源的交互无 response_url，结果通过重新
`views.publish` 呈现，失败/拒绝提示走 DM）和刷新按钮（`nuphos_home_refresh`）。

**App threads（频道线程）**：`@mention` 可出现在线程根部（新建 agent thread）或
既有讨论串内部（把 agent 拉进该 thread —— 首次加入时通过 `conversations.replies`
回读此前讨论作为该回合上下文）。绑定后线程内的普通回复无需再 `@`（`message.channels`
→ `handleThreadMessage`）；带 `@mention` 的回复统一由 `app_mention` 处理（两个事件
`event_id` 不同、无法靠幂等去重，因此 message 侧显式让位防止双跑）。频道线程无标题
API；线程标题仅存在于 DM（assistant）容器。

## Manifest

粘贴到 <https://api.slack.com/apps> → Nuphos → **App Manifest** 编辑器（编辑器会做
schema 校验）。

```json
{
    "display_information": {
        "name": "Nuphos",
        "description": "Your AI DevOps Engineer.",
        "background_color": "#342f4d"
    },
    "features": {
        "app_home": {
            "home_tab_enabled": true,
            "messages_tab_enabled": true,
            "messages_tab_read_only_enabled": false
        },
        "bot_user": {
            "display_name": "Nuphos",
            "always_online": true
        },
        "assistant_view": {
            "assistant_description": "Nuphos is your AI DevOps engineer. Ask about cluster health, alerts, deployments, and troubleshooting — it replies in real time with its thinking steps and can search relevant workspace discussions.",
            "suggested_prompts": []
        },
        "slash_commands": [
            {
                "command": "/nuphos",
                "url": "https://api.nuphos.ai/slack/commands",
                "description": "Nuphos commands (pickup: continue a conversation here)",
                "usage_hint": "pickup",
                "should_escape": false
            }
        ]
    },
    "oauth_config": {
        "redirect_urls": [
            "https://api.nuphos.ai/slack-app/setup"
        ],
        "scopes": {
            "bot": [
                "app_mentions:read",
                "assistant:write",
                "channels:history",
                "channels:read",
                "chat:write",
                "commands",
                "files:write",
                "groups:history",
                "groups:read",
                "im:history",
                "im:write",
                "reactions:write",
                "search:read.files",
                "search:read.public",
                "search:read.users",
                "users:read",
                "users:read.email"
            ]
        },
        "pkce_enabled": false
    },
    "settings": {
        "event_subscriptions": {
            "request_url": "https://api.nuphos.ai/slack/events",
            "bot_events": [
                "app_home_opened",
                "app_mention",
                "assistant_thread_context_changed",
                "assistant_thread_started",
                "message.channels",
                "message.groups",
                "message.im"
            ]
        },
        "interactivity": {
            "is_enabled": true,
            "request_url": "https://api.nuphos.ai/slack/interactions"
        },
        "org_deploy_enabled": false,
        "socket_mode_enabled": false,
        "token_rotation_enabled": false,
        "is_mcp_enabled": false
    }
}
```

> 注：`suggested_prompts: []` 为静态兜底 —— 实际的建议提示由后端在每个新线程的
> `assistant_thread_started` 上按上下文动态下发（`assistant.threads.setSuggestedPrompts`，
> 用户正在看某个频道时首个提示会替换为"总结该频道"）。同一开关也可以在 App 设置左侧
> **Agents & AI Apps** 页手动打开并选择 Assistant（assistant_view）体验。

## 相对旧配置（agent_view）的关键变更

| 项                               | 旧值                                      | 新值                                                                            | 原因                                                                                                            |
| -------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `app_home.home_tab_enabled`      | `true`                                    | `false`                                                                         | 移除经典 App Home：从未发布过 Home 视图，入口一直是空页                                                         |
| `features.agent_view`            | 对象（`agent_description`）               | 改为 `features.assistant_view`（`assistant_description` + `suggested_prompts`） | 换到 Assistant 体验以获得 **Chat / History 页签**（agent_view 只有 Messages tab 时间线，没有独立 History 页面） |
| `event_subscriptions.bot_events` | `app_home_opened` / `app_context_changed` | `assistant_thread_started` / `assistant_thread_context_changed`                 | assistant_view 事件体系；上下文改由事件推送并落库（`slack_assistant_thread_context`）                           |

> 后续变更：Home tab 已**重新启用**（`home_tab_enabled: true` + 重新订阅
> `app_home_opened`），这次后端真正发布 Home 视图（见文首"App Home"一节）。
> `views.publish` 不需要额外 scope，事件订阅变更保存 manifest 即生效 —— **Home tab
> 本身无需重装 workspace**；但同批引入的文件附件功能新增了 `files:write` scope，
> **需要重装**（见"文件附件"一节，重装与否只影响附件，不影响 Home tab）。注意先部署
> 包含 `handleAppHomeOpened` 的后端，再应用 manifest —— 顺序反了 Home 页会短暂空白
> （事件被标记 ignored 前的旧版本则直接丢弃）。

其余（interactivity、OAuth redirect、bot scopes）不变，与 `src/lib/slack/oauth.ts` 的
`SLACK_BOT_SCOPES` 保持一致。**assistant_view 切换本身无新增 scope、无需重装
workspace**（后续新增的 `files:write` 除外，见"文件附件"一节）。

## 切换步骤（agent_view → assistant_view）

1. **先部署后端**（包含 assistant_view 事件处理的版本）。过渡期内旧 manifest 的
   `app_home_opened` / `app_context_changed` 事件会被安全地标记 ignored，DM 消息处理不受影响。
2. 在 App 设置里应用上面的 manifest（或在 **Agents & AI Apps** 页切换到 Assistant
   （assistant_view）体验）。切换对该 App 的**所有用户一次性生效**，建议先用一个独立的
   dev App 在测试 workspace 验证，再改生产 App。
3. 事件订阅 Request URL 变更/保存后 Slack 会重新验证 URL（后端已处理 `url_verification`）。

## 文件附件（files:write）

Agent 在回合中通过 file-transfer skill 推送的产出文件（`download` transfer group），
回合结束后会作为 **Slack 原生附件**发进当前线程（`files.getUploadURLExternal` →
上传字节 → `files.completeUploadExternal`，见 `src/lib/slack/files.ts`）。需要
`files:write` bot scope —— **新增 scope，已安装的 workspace 必须重新走一次 OAuth
安装**（同下节流程，从 Nuphos 桌面端 Settings → Slack 入口重装）。未重装时上传以
`missing_scope` 失败，自动降级为一条"请到 Nuphos 桌面端下载"的线程消息，不影响其余
功能。单文件超过 100 MB 时不附件，同样走降级消息。

## 新增 scope 需要重新安装

本次新增了 `search:read.files` / `search:read.public` / `search:read.users`
（供 `assistant.search.context`，即 agent 的 `slack_search` 工具使用），以及 `users:read`
（供 `users.info` 用户邮箱自动映射；`users:read.email` 只在其之上解锁 `profile.email` 字段）。**已安装的
workspace 必须重新走一次 OAuth 安装**，且必须从 **Nuphos 桌面端 Settings → Slack**
的安装入口走（`/slack-installations/start-oauth` → `/slack-app/setup` 回调，新 token
才会加密入库）——不要用 Slack 后台的 "Reinstall to Workspace" 按钮。未重装前
`slack_search` 会向 agent 报告"搜索不可用"并正常降级；缺 `users:read` 时 `users.info`
会以 `missing_scope` 失败，`fetchSlackUserEmail` 捕获后返回 `null`，用户邮箱自动映射静默跳过而非报错。其余功能不受影响。

另外 `assistant.search.context` 曾处于 limited access 阶段：如果重装后 `slack_search`
仍报 `not_allowed`，需联系 Slack（feedback@slack.com）为 App 申请开通。

## 会话接力（/nuphos pickup + 桌面端「接力到 Slack」）

桌面端发起的会话可以「接力」到 Slack 继续：绑定后 `slack_agent_threads` 记录
`origin: 'user_pickup'`，DM thread 内的回复经 `handleAssistantMessage` 复用既有绑定
驱动同一会话，桌面端回合照常镜像进该 thread（Slack-bound 分支）。两个入口共用
`src/lib/slack/session-pickup.ts`：

- **Slack 端**：`/nuphos pickup`（`POST /slack/commands`，需 `commands` scope 与上面的
  `slash_commands` 配置）列出最近会话的 ephemeral 选择器；按钮交互
  （`nuphos_pickup_session`，走既有 `/slack/interactions`）完成绑定并回贴 DM thread 链接。
- **桌面端**：`POST /agent/conversations/:sessionId/slack-pickup`（owner-only）。

`commands` 为**新增 scope，已安装的 workspace 必须重新走一次 OAuth 安装**（同
"新增 scope 需要重新安装"一节的桌面端入口流程）。未重装前 slash command 在
workspace 内不可见，其余功能不受影响。

## 后端环境变量对照

| Manifest 项               | 后端配置                                                         |
| ------------------------- | ---------------------------------------------------------------- |
| 事件 Request URL          | `POST /slack/events`（验签用 `SLACK_SIGNING_SECRET`）            |
| Interactivity Request URL | `POST /slack/interactions`                                       |
| Slash command URL         | `POST /slack/commands`（验签同上）                               |
| OAuth redirect            | `SLACK_OAUTH_SETUP_REDIRECT`（`GET /slack-app/setup`）           |
| Bot scopes                | `src/lib/slack/oauth.ts` 的 `SLACK_BOT_SCOPES`（两处需保持一致） |
