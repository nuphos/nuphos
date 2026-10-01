import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'
import { logEvent } from '@/lib/observability'
import { addSlackReaction, fetchSlackThreadReplies, postSlackMessage } from '@/lib/slack/api'

import type { SlackChannelMapping, SlackUserMapping } from '@/lib/slack/agent-bot'
import type { SlackApiResponse } from '@/lib/slack/api'
import type { AuthVariables } from '@/middleware/auth'
import type { SlackRuntime } from '@/routes/slack/types'
import type { Context } from 'hono'

// Message subtypes that still carry a real user message. Everything else
// (channel_join, message_changed, thread_broadcast of a bot post, …) stays
// filtered out.
export const SUBTYPES_WITH_ATTACHMENTS = new Set(['file_share'])

export function serializeMapping(mapping: SlackChannelMapping) {
  const { _id, ...rest } = mapping

  return { id: _id?.toString(), ...rest }
}

export function serializeUserMapping(mapping: SlackUserMapping) {
  const { _id, ...rest } = mapping

  return { id: _id?.toString(), ...rest }
}

export function normalizeSlackId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Z0-9]+$/.test(value.trim())) {
    throw new AppError(400, 'invalid_request', `${field} must be a Slack ID`)
  }

  return value.trim()
}

export function stripBotMention(text: string, botUserId?: string | null): string {
  let cleaned = text

  if (botUserId) {
    cleaned = cleaned.replace(new RegExp(`<@${escapeRegExp(botUserId)}>`, 'g'), '')
  }

  return cleaned.replace(/^\s*(?:<@[A-Z0-9]+>\s*)+/, '').trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// The reaction added to the user's message the moment we start handling it.
export const RECEIPT_REACTION = 'eyes'

// Slack reaction names are bare emoji short names (no colons). Tolerate an agent
// passing ':tada:' or 'TADA'.
export function normalizeEmojiName(value: string): string {
  return value
    .trim()
    .replace(/^:+/, '')
    .replace(/(?<!:):+$/, '')
    .trim()
    .toLowerCase()
}

// Best-effort reaction add — a failed reaction must never break the turn.
// Treats an already-present reaction as success.
export async function addReactionSafe(
  token: string,
  channel: string,
  ts: string,
  name: string,
): Promise<void> {
  try {
    await addSlackReaction({ token, channel, ts, name })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    if (message.includes('already_reacted')) return
    logEvent('warn', 'slack.reaction.add_failed', {
      slack_channel_id: channel,
      slack_message_ts: ts,
      emoji: name,
      error: message,
    })
  }
}

export function normalizeNuphosUserId(value: unknown, field = 'nuphosUserId'): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value.trim())) {
    throw new AppError(400, 'invalid_request', `${field} must be a Nuphos user id`)
  }

  return value.trim()
}

export async function requireTeamMember(c: Context<{ Variables: AuthVariables }>, teamId: string) {
  const membership = await getTeamMembership(c.get('userId'), teamId)

  if (!membership) {
    throw new AppError(403, 'forbidden', 'You are not a member of this team')
  }

  return membership
}

export async function requireTeamAdmin(
  c: Context<{ Variables: AuthVariables }>,
  teamId: string,
): Promise<void> {
  const membership = await requireTeamMember(c, teamId)

  if (membership.role !== 'ADMINISTRATOR') {
    throw new AppError(403, 'forbidden', 'Only team administrators can manage Slack mappings')
  }
}

export function truncatePlain(value: string, max: number): string {
  const trimmed = value.trim()

  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

export async function postThreadMessage(
  runtime: SlackRuntime,
  channel: string,
  threadTs: string,
  text: string,
): Promise<SlackApiResponse> {
  return await postSlackMessage({
    token: runtime.botToken,
    channel,
    threadTs,
    text,
  })
}

// Said once per thread, not once per reply: two people comparing notes under a
// report must not each be answered with the same notice. The marker is matched
// in the thread's own replies, which is the only place the notice can exist.
const UNBOUND_THREAD_MARKER = 'not attached to a Nuphos conversation'

export async function explainUnboundNuphosThread(
  runtime: SlackRuntime,
  channel: string,
  threadTs: string,
): Promise<void> {
  try {
    const { messages } = await fetchSlackThreadReplies({
      token: runtime.botToken,
      channel,
      threadTs,
      maxMessages: 200,
    })
    const alreadySaid = messages.some(
      (message) => typeof message.text === 'string' && message.text.includes(UNBOUND_THREAD_MARKER),
    )

    if (alreadySaid) return
  } catch {
    // Cannot read the thread (missing scope on an old install, rate limit): say
    // it rather than stay silent. A repeated notice is a smaller failure than
    // the silence this whole branch exists to remove.
  }
  await postThreadMessage(
    runtime,
    channel,
    threadTs,
    `I posted this, but it is ${UNBOUND_THREAD_MARKER}, so replies here don't reach me. Mention me with your question and I'll pick it up from there.`,
  ).catch(() => {})
}
