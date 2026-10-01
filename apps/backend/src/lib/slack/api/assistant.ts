import { slackApi } from '@/lib/slack/api/client'

import type { SlackApiResponse } from '@/lib/slack/api/client'

// ─── Assistant threads (Agents & AI Apps, assistant_view) ───────────────────
// These power the assistant messaging surface (the app's Chat/History tabs):
// suggested prompt chips, the native "is thinking…" loading indicator, and the
// thread title shown in the History tab. They key on channel_id + thread_ts
// (NOT `channel` like the chat.* methods). setStatus accepts chat:write or
// assistant:write; the other two need assistant:write.
// See https://docs.slack.dev/reference/methods/assistant.threads.setSuggestedPrompts
export type SlackSuggestedPrompt = { title: string; message: string }

export async function setSlackAssistantSuggestedPrompts(args: {
  token: string
  channelId: string
  // In assistant_view prompts are offered per thread; omit thread_ts only for
  // surfaces that pin prompts tab-wide.
  threadTs?: string
  prompts: SlackSuggestedPrompt[]
  title?: string
}): Promise<SlackApiResponse> {
  return await slackApi(args.token, 'assistant.threads.setSuggestedPrompts', {
    channel_id: args.channelId,
    ...(args.threadTs ? { thread_ts: args.threadTs } : {}),
    // Slack rejects more than 4 prompts; cap defensively.
    prompts: args.prompts.slice(0, 4),
    ...(args.title ? { title: args.title } : {}),
  })
}

// Sets (status text) or clears (empty string) the "<bot> is thinking…" indicator
// shown in the assistant pane while work is in flight. Slack rotates the
// optional loading_messages under the indicator while it is active, and drops
// the whole status automatically once the app posts a reply (or after ~2
// minutes of silence).
export async function setSlackAssistantStatus(args: {
  token: string
  channelId: string
  threadTs: string
  status: string
  // Rotating flavor lines shown while the status is active; the API caps the
  // array at 10 entries.
  loadingMessages?: string[]
}): Promise<SlackApiResponse> {
  return await slackApi(args.token, 'assistant.threads.setStatus', {
    channel_id: args.channelId,
    thread_ts: args.threadTs,
    status: args.status,
    ...(args.loadingMessages?.length
      ? { loading_messages: args.loadingMessages.slice(0, 10) }
      : {}),
  })
}

export async function setSlackAssistantTitle(args: {
  token: string
  channelId: string
  threadTs: string
  title: string
}): Promise<SlackApiResponse> {
  return await slackApi(args.token, 'assistant.threads.setTitle', {
    channel_id: args.channelId,
    thread_ts: args.threadTs,
    title: args.title,
  })
}

// ─── Assistant workspace search ──────────────────────────────────────────────
// assistant.search.context is Slack's retrieval API for agents: given a user
// query it returns relevant workspace content the bot may read. Requires the
// search:read.files / search:read.public / search:read.users bot scopes —
// workspaces installed before those were added must re-install (callers treat
// missing_scope as "search unavailable", not an error).
//
// Bot-token calls (which is what we make) ALSO require an `action_token` lifted
// from the triggering Slack event (message.*/app_mention); without it Slack
// rejects the request with invalid_action_token. User-token calls don't need
// one. See https://docs.slack.dev/apis/web-api/real-time-search-api#action-token
export async function searchSlackAssistantContext(args: {
  token: string
  query: string
  // Per-turn token from the inbound Slack event; REQUIRED for bot-token search.
  actionToken?: string
  // Scopes results to the channel the user is currently viewing.
  contextChannelId?: string
  contentTypes?: ('messages' | 'files' | 'channels' | 'users')[]
  limit?: number
}): Promise<SlackApiResponse> {
  return await slackApi(args.token, 'assistant.search.context', {
    query: args.query,
    ...(args.actionToken ? { action_token: args.actionToken } : {}),
    ...(args.contextChannelId ? { context_channel_id: args.contextChannelId } : {}),
    ...(args.contentTypes ? { content_types: args.contentTypes } : {}),
    // Slack caps limit at 20.
    ...(args.limit ? { limit: Math.min(args.limit, 20) } : {}),
  })
}
