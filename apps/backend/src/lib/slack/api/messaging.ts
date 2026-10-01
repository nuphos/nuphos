import { AppError } from '@/lib/errors'
import { slackApi, slackApiGet } from '@/lib/slack/api/client'

import type { SlackApiResponse } from '@/lib/slack/api/client'

// Reads the messages of a channel thread, oldest first (conversations.replies;
// needs channels:history / groups:history for the channel type — both already
// granted for the message.* event subscriptions). Used to brief the agent on
// the earlier discussion when it is mentioned into an existing thread.
//
// Slack pages replies oldest-first, so reaching the NEWEST replies of a long
// thread means paging to the end — the briefing wants the root plus the
// latest discussion, not just the first page. Paging is bounded, and later
// pages are best-effort: non-Marketplace commercially-distributed installs
// can be capped at 15 messages/request and 1 request/minute (May 2025 tiers),
// in which case a follow-up page may rate-limit — we keep what was already
// collected and report hasMore instead of losing the whole briefing.
const THREAD_REPLIES_MAX_PAGES = 8

export async function fetchSlackThreadReplies(args: {
  token: string
  channel: string
  threadTs: string
  // Total messages to collect across pages.
  maxMessages?: number
}): Promise<{ messages: Record<string, unknown>[]; hasMore: boolean }> {
  const maxMessages = Math.min(args.maxMessages ?? 200, 1000)
  const messages: Record<string, unknown>[] = []
  let cursor: string | undefined
  let hasMore = false

  for (let page = 0; page < THREAD_REPLIES_MAX_PAGES; page++) {
    let json: SlackApiResponse

    try {
      json = await slackApiGet(args.token, 'conversations.replies', {
        channel: args.channel,
        ts: args.threadTs,
        limit: Math.min(maxMessages - messages.length, 200),
        ...(cursor ? { cursor } : {}),
      })
    } catch (err) {
      // First page failing is a real error; a later page failing (e.g. the
      // restricted tier's 1/min cap) degrades to the pages already in hand.
      if (page === 0) throw err
      hasMore = true
      break
    }
    if (Array.isArray(json.messages)) messages.push(...json.messages)
    cursor = json.response_metadata?.next_cursor || undefined
    hasMore = Boolean(json.has_more) && Boolean(cursor)
    if (!hasMore || messages.length >= maxMessages) break
  }

  return { messages: messages.slice(0, maxMessages), hasMore }
}

// Reads the most recent top-level messages of a channel (conversations.history),
// newest first as Slack returns them. Needs channels:history / groups:history,
// both already in the install scopes.
export async function fetchSlackChannelHistory(args: {
  token: string
  channel: string
  // Slack ts lower bound (exclusive); older messages are not returned.
  oldest?: string
  limit?: number
}): Promise<{ messages: Record<string, unknown>[] }> {
  const json = await slackApiGet(args.token, 'conversations.history', {
    channel: args.channel,
    limit: Math.min(args.limit ?? 15, 100),
    ...(args.oldest ? { oldest: args.oldest } : {}),
  })

  return { messages: Array.isArray(json.messages) ? json.messages : [] }
}

export async function postSlackMessage(args: {
  token: string
  channel: string
  text: string
  threadTs?: string
  blocks?: unknown[]
}): Promise<SlackApiResponse> {
  return await slackApi(args.token, 'chat.postMessage', {
    channel: args.channel,
    ...(args.threadTs ? { thread_ts: args.threadTs } : {}),
    text: args.text,
    ...(args.blocks ? { blocks: args.blocks } : {}),
    unfurl_links: false,
    unfurl_media: false,
  })
}

// Ephemeral note visible to one user only. Unlike a response_url ephemeral —
// which Slack always renders at the channel root, even for interactions that
// happened inside a thread — chat.postEphemeral accepts thread_ts, so the note
// can land inside the thread the user is actually looking at.
export async function postSlackEphemeral(args: {
  token: string
  channel: string
  user: string
  text: string
  threadTs?: string
}): Promise<SlackApiResponse> {
  return await slackApi(args.token, 'chat.postEphemeral', {
    channel: args.channel,
    user: args.user,
    ...(args.threadTs ? { thread_ts: args.threadTs } : {}),
    text: args.text,
  })
}

// Posts a message body to an interaction `response_url` — the signed, short-
// lived callback (valid ~30 minutes, up to 5 posts) Slack attaches to a
// block_actions payload for updating or replacing the message the interaction
// came from. Use this instead of the direct interaction HTTP response whenever
// the work behind the update can exceed Slack's 3-second ack deadline: ack the
// interaction immediately, then post the real update here. The URL itself
// carries the auth, so no bot token is sent.
export async function postSlackResponseUrl(
  responseUrl: string,
  body: Record<string, unknown>,
): Promise<void> {
  let response: Response

  try {
    response = await fetch(responseUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new AppError(
      502,
      'slack_api_error',
      err instanceof Error
        ? `Slack response_url post failed: ${err.message}`
        : 'Slack response_url post failed',
    )
  }
  const detail = (await response.text().catch(() => '')).trim()

  if (!response.ok) {
    throw new AppError(
      502,
      'slack_api_error',
      `Slack response_url post failed: ${String(response.status)} ${detail}`.trim(),
    )
  }
  // A rejected response_url post still answers HTTP 200 — the outcome is in the
  // body, either the literal string `ok` or an error token (`invalid_blocks`,
  // `action_prohibited`, an expired url), sometimes wrapped as {"ok":false}.
  // Without this check a failed interaction reply is completely silent: the
  // caller logs nothing and the user sees their click do nothing at all.
  if (!isSlackResponseUrlAck(detail)) {
    throw new AppError(
      502,
      'slack_api_error',
      `Slack response_url rejected the payload: ${detail || '(empty body)'}`,
    )
  }
}

export function isSlackResponseUrlAck(body: string): boolean {
  if (!body || body === 'ok') return true
  if (!body.startsWith('{')) return false
  try {
    return (JSON.parse(body) as { ok?: unknown }).ok !== false
  } catch {
    return false
  }
}
