import { readBoundedBody } from '@/lib/agent/inbound-files'
import { AppError } from '@/lib/errors'
import { slackApi, slackApiGet } from '@/lib/slack/api/client'

import type { SlackApiResponse } from '@/lib/slack/api/client'

// ─── Reactions ──────────────────────────────────────────────────────────────
// reactions.add / reactions.remove let the bot react to a message with an emoji
// (e.g. 👀 when it starts looking, ✅/🎉 when a request is resolved). They take
// the emoji SHORT NAME without colons (e.g. 'eyes', 'tada') and key on the
// message via `timestamp`. Requires the reactions:write bot scope.
// Downloads an attachment the user posted. `url_private` is not public: it
// needs the bot token as a bearer credential AND the files:read scope. A
// workspace installed before that scope was requested gets 401/403 here, which
// the caller degrades into "I couldn't read your attachment" rather than a
// failed turn.
export async function downloadSlackFile(args: {
  token: string
  urlPrivate: string
  maxBytes: number
}): Promise<{ bytes: Uint8Array; contentType: string | null } | null> {
  const response = await fetch(args.urlPrivate, {
    headers: { authorization: `Bearer ${args.token}` },
    // A slow or endless response would otherwise pin the worker handling this
    // webhook for as long as the sender likes.
    signal: AbortSignal.timeout(60_000),
  })
  // A missing scope redirects to an HTML sign-in page with HTTP 200 rather
  // than an error status, so the content type is the real check.
  const contentType = response.headers.get('content-type')

  if (!response.ok || contentType?.includes('text/html')) return null
  const bytes = await readBoundedBody(response, args.maxBytes)

  if (!bytes) return null

  return { bytes, contentType: contentType?.split(';')[0]?.trim() ?? null }
}

export async function addSlackReaction(args: {
  token: string
  channel: string
  ts: string
  name: string
}): Promise<SlackApiResponse> {
  return await slackApi(args.token, 'reactions.add', {
    channel: args.channel,
    timestamp: args.ts,
    name: args.name,
  })
}

export async function removeSlackReaction(args: {
  token: string
  channel: string
  ts: string
  name: string
}): Promise<SlackApiResponse> {
  return await slackApi(args.token, 'reactions.remove', {
    channel: args.channel,
    timestamp: args.ts,
    name: args.name,
  })
}

// ─── App Home ────────────────────────────────────────────────────────────────
// views.publish replaces the given user's Home tab view wholesale — it is
// per-user, so each viewer gets their own state. No extra scope beyond the
// granted bot scopes is required for publishing views.
export async function publishSlackHomeView(args: {
  token: string
  slackUserId: string
  view: Record<string, unknown>
}): Promise<SlackApiResponse> {
  return await slackApi(args.token, 'views.publish', {
    user_id: args.slackUserId,
    view: args.view,
  })
}

// Canonical archive URL for a message. Null on failure: every caller has a
// constructible fallback URL, so a permalink outage must not fail the
// operation that posted the message.
export async function getSlackMessagePermalink(
  token: string,
  channel: string,
  messageTs: string,
): Promise<string | null> {
  try {
    const json = await slackApiGet(token, 'chat.getPermalink', {
      channel,
      message_ts: messageTs,
    })

    return typeof json.permalink === 'string' && json.permalink ? json.permalink : null
  } catch {
    return null
  }
}

export async function openSlackDm(token: string, slackUserId: string): Promise<string> {
  const json = await slackApi(token, 'conversations.open', { users: slackUserId })
  const channel = json.channel

  if (typeof channel === 'string' && channel) return channel
  if (channel && typeof channel === 'object' && channel.id) return channel.id
  throw new AppError(502, 'slack_api_error', 'conversations.open did not return a channel id')
}
