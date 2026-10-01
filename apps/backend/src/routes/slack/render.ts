import { logEvent } from '@/lib/observability'
import { fetchSlackThreadReplies } from '@/lib/slack/api'
import { fetchSlackUserName } from '@/lib/slack/user-profile'

import type { SlackAgentThread, SlackThreadMessageRecord } from '@/lib/slack/agent-bot'
import type { SlackMessageEvent } from '@/routes/slack/types'

// The rendered text is persisted in the conversation transcript and read by
// humans in the Nuphos UI, so people and channels appear by display name —
// raw <@U…>/<#C…> ids only render as names inside Slack itself. The mention
// syntax is kept only as a fallback when a name lookup failed; the agent gets
// the sender's id for @-mentions via the system prompt instead.
export function renderSlackUserMessage(
  event: SlackMessageEvent,
  text: string,
  opts: {
    dm?: boolean
    senderName?: string | null
    channelName?: string | null
    contextChannelId?: string
    contextChannelName?: string | null
    threadContext?: string
  } = {},
): string {
  const user = opts.senderName ?? (event.user ? `<@${event.user}>` : 'A Slack user')

  if (opts.dm) {
    // Surface what the user is looking at so "this channel" / "check this channel"
    // style questions resolve without a follow-up.
    const viewingChannel = opts.contextChannelName
      ? `#${opts.contextChannelName}`
      : opts.contextChannelId
        ? `<#${opts.contextChannelId}>`
        : null
    const viewing = viewingChannel ? ` (currently viewing ${viewingChannel} in Slack)` : ''

    return `${user} messaged Nuphos in a Slack DM${viewing}:\n\n${text}`
  }
  const channel = opts.channelName
    ? `#${opts.channelName}`
    : event.channel
      ? `<#${event.channel}>`
      : 'the connected Slack channel'

  if (opts.threadContext) {
    // Either the agent was just mentioned into an existing discussion, or it
    // stayed silent through replies that were not addressed to it. Both times
    // it needs the discussion it did not see before answering.
    return `${user} wrote in a thread in ${channel}.\n\n${opts.threadContext}\n\nTheir message:\n\n${text}`
  }

  return `${user} wrote in ${channel}:\n\n${text}`
}

// How much of an existing thread is replayed to the agent when it joins one:
// the root message plus the most recent replies, each clipped to a line-ish
// length. Enough to understand an incident thread without flooding the turn.
const THREAD_CONTEXT_MAX_MESSAGES = 25
const THREAD_CONTEXT_MESSAGE_CHARS = 400

// Renders the messages that preceded the mention into a compact briefing
// block, oldest first. Other bots' messages are kept — in incident threads the
// alert bot's posts ARE the context. Authors appear by display name (via
// userNames) with the raw mention syntax only as a lookup-failure fallback.
function renderSlackThreadContext(
  messages: Record<string, unknown>[],
  mentionTs: string,
  hasMore: boolean,
  userNames: Map<string, string | null>,
): string | null {
  const prior: string[] = []

  for (const message of messages) {
    const ts = typeof message.ts === 'string' ? message.ts : null

    if (!ts || ts === mentionTs) continue
    const text = typeof message.text === 'string' ? message.text.trim() : ''

    if (!text) continue
    const userId = typeof message.user === 'string' ? message.user : null
    const botProfile = message.bot_profile as { name?: unknown } | undefined
    const botName =
      typeof message.username === 'string' && message.username.trim()
        ? message.username.trim()
        : typeof botProfile?.name === 'string' && botProfile.name.trim()
          ? botProfile.name.trim()
          : null
    const author = userId ? (userNames.get(userId) ?? `<@${userId}>`) : (botName ?? '(bot)')
    const clipped =
      text.length > THREAD_CONTEXT_MESSAGE_CHARS
        ? `${text.slice(0, THREAD_CONTEXT_MESSAGE_CHARS - 1)}…`
        : text

    prior.push(`${author}: ${clipped.replace(/\n/g, ' ')}`)
  }
  if (prior.length === 0) return null
  // Keep the root (the report that started the thread) plus the most recent
  // replies; say what was dropped rather than truncating silently.
  let lines = prior
  let omitted = 0

  if (prior.length > THREAD_CONTEXT_MAX_MESSAGES) {
    omitted = prior.length - THREAD_CONTEXT_MAX_MESSAGES
    lines = [prior[0]!, ...prior.slice(-(THREAD_CONTEXT_MAX_MESSAGES - 1))]
  }
  const header = 'Earlier messages in this thread (oldest first):'
  const body = lines.map((line) => `- ${line}`).join('\n')
  const notes: string[] = []

  if (omitted > 0) notes.push(`(${String(omitted)} messages omitted)`)
  if (hasMore) notes.push('(thread is longer than the fetched window)')

  return [header, body, ...notes].join('\n')
}

// Rewrites <@U…> to the person's display name. The addressing judge's single
// strongest signal is "this message is asking someone else", which raw Slack
// mention syntax hides; the same rendering is what the agent sees if the turn
// does run.
export async function resolveSlackMentionNames(
  token: string,
  slackWorkspaceId: string,
  text: string,
): Promise<string> {
  const ids = [...new Set([...text.matchAll(/<@([A-Z0-9]+)>/g)].map((match) => match[1]!))]

  if (ids.length === 0) return text
  const names = await Promise.all(
    ids.map(async (id) => [id, await fetchSlackUserName(token, slackWorkspaceId, id)] as const),
  )
  let resolved = text

  for (const [id, name] of names) {
    if (!name) continue
    resolved = resolved.split(`<@${id}>`).join(`@${name}`)
  }

  return resolved
}

// The thread messages the agent stayed silent on since it last spoke. Handed
// to the turn that finally is addressed to it, so answering a follow-up never
// means answering out of a conversation it only half saw. Takes the history
// WITHOUT the message being answered — that one is delivered on its own.
export function renderMissedThreadMessages(
  records: SlackThreadMessageRecord[],
): string | undefined {
  const missed: SlackThreadMessageRecord[] = []

  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i]!

    if (record.fromBot) break
    missed.unshift(record)
  }
  if (missed.length === 0) return undefined

  return [
    'Messages posted in this thread since you last replied (you did not answer these):',
    ...missed.map((record) => `- ${record.authorName}: ${record.text.replace(/\n/g, ' ')}`),
  ].join('\n')
}

// A thread forked off a proactive post owns a conversation that has never run,
// so its first turn would otherwise answer "why is this over budget?" with no
// idea which report is being pointed at. The notification is replayed once —
// after that it is in the transcript like anything else the agent said.
//
// "Has it run yet" is read off the thread's own rolling window rather than the
// conversation: the seed record carries the root's ts, so any OTHER bot record
// means the agent has already spoken here. That keeps this a pure function of
// the row we already loaded — no second query, and nothing for the sibling
// Slack suites' shared module mocks to disagree about.
export function renderForkedThreadOrigin(thread: SlackAgentThread): string | undefined {
  if (!thread.notificationContext) return undefined
  const hasSpoken = (thread.recentMessages ?? []).some(
    (record) => record.fromBot && record.ts !== thread.slackThreadTs,
  )

  if (hasSpoken) return undefined

  return `You posted this to the channel, and this thread hangs off it:\n\n${thread.notificationContext}`
}

export function joinThreadContext(...blocks: (string | undefined)[]): string | undefined {
  const present = blocks.filter((block): block is string => !!block)

  return present.length > 0 ? present.join('\n\n') : undefined
}

// How many distinct thread authors get a users.info name lookup per briefing
// (cached; incident threads rarely have more speakers than this).
const THREAD_CONTEXT_NAME_LOOKUPS = 10

// Best-effort thread briefing for a mention that pulled the agent into an
// existing discussion. Any failure (missing scope on old installs, huge
// thread, transient error) degrades to answering from the mention alone.
export async function fetchThreadContextSafe(
  token: string,
  slackWorkspaceId: string,
  channel: string,
  threadTs: string,
  mentionTs: string,
): Promise<string | undefined> {
  try {
    const { messages, hasMore } = await fetchSlackThreadReplies({ token, channel, threadTs })
    const userIds: string[] = []

    for (const message of messages) {
      if (typeof message.user !== 'string' || !message.user) continue
      if (userIds.includes(message.user)) continue
      userIds.push(message.user)
      if (userIds.length >= THREAD_CONTEXT_NAME_LOOKUPS) break
    }
    // Independent lookups; run them concurrently so a cold cache doesn't add
    // one round-trip per distinct author before the turn can start.
    const userNames = new Map<string, string | null>()

    await Promise.all(
      userIds.map(async (userId) => {
        userNames.set(userId, await fetchSlackUserName(token, slackWorkspaceId, userId))
      }),
    )

    return renderSlackThreadContext(messages, mentionTs, hasMore, userNames) ?? undefined
  } catch (err) {
    logEvent('warn', 'slack.thread_context.fetch_failed', {
      slack_channel_id: channel,
      slack_thread_ts: threadTs,
      error: err instanceof Error ? err.message : String(err),
    })

    return undefined
  }
}
