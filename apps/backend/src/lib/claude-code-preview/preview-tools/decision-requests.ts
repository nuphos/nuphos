// Follow-ups to request_user_decision: the agent lists, corrects or withdraws
// the questions it asked while they are still open in the user's Inbox.
import { channelIdOf } from '@/lib/agent/channel-wake'
import { agentConversations, agentMessages, getConversationBySessionId } from '@/lib/agent/db'
import { conversationParticipantIds } from '@/lib/agent/db/participants'
import {
  listOpenInputRequests,
  updateInputRequest,
  withdrawInputRequest,
} from '@/lib/agent/db/pending-decision'
import { botFace } from '@/lib/agent/mentions'
import { parseMessageMetadata } from '@/lib/agent/message-metadata'
import { queuedAnswers } from '@/lib/agent/pending-queue'
import { toolError, toolResult } from '@/lib/mcp/protocol'
import { notifyNudge } from '@/lib/push/notify'
import { plainText, truncate } from '@/lib/push/turn-outcome'

import type { PreviewToolContext } from '../preview-tool-context'
import type { AiSdkToolLike } from './ai-sdk-adapter'
import type { DecisionQuestion } from '@/lib/agent/tools-skilled/types'
import type { ToolHandler, ToolResult } from '@/lib/mcp/protocol'
import type { ZodType } from 'zod'

/** Questions are kept on the conversation for its owner, whoever's turn asked them. */
export function requestOwner(ctx: PreviewToolContext): string {
  return ctx.conversationOwnerUserId ?? ctx.userId
}

type RequestFollowUp = {
  label: string
  requestId: string
  question?: string
  body?: string
  options?: string[]
  multiSelect?: boolean
  questions?: DecisionQuestion[]
}

const NOT_OPEN =
  'No open question has this requestId: it was answered, dismissed or withdrawn. Any answer or dismissal reaches you as a message. Do not ask it again.'
const CLOSED =
  'The person already answered or dismissed this question; `notice` is what they said. Act on it now and do not ask it again. The same notice also arrives as a message after this turn.'

/**
 * A question answered while this turn runs: its answer waits behind the turn,
 * so the agent gets it here instead of a question that seems lost.
 */
async function closedNotice(ctx: PreviewToolContext, requestId: string) {
  const notice = (await queuedAnswers(requestOwner(ctx), ctx.sessionId)).get(
    requestId,
  )?.renderedText

  return notice === undefined
    ? undefined
    : toolResult({ requestId, status: 'closed', notice, note: CLOSED })
}

/** The agent lists, corrects or withdraws the questions it asked while the user has not answered them. */
const requestFollowUps = {
  update_user_decision: async (ctx: PreviewToolContext, input: RequestFollowUp) => {
    const { requestId, label: _label, ...patch } = input

    if (Object.keys(patch).length === 0)
      return toolError('Pass question, body, options, multiSelect or questions to change.')

    return (
      (await closedNotice(ctx, requestId)) ??
      ((await updateInputRequest(ctx.sessionId, requestOwner(ctx), requestId, patch))
        ? toolResult({ ok: true, requestId, status: 'updated' })
        : toolError(NOT_OPEN))
    )
  },
  withdraw_user_decision: async (ctx: PreviewToolContext, { requestId }: RequestFollowUp) =>
    (await closedNotice(ctx, requestId)) ??
    ((await withdrawInputRequest(ctx.sessionId, requestOwner(ctx), requestId))
      ? toolResult({ ok: true, requestId, status: 'withdrawn' })
      : toolError(NOT_OPEN)),
  list_user_decisions: async (ctx: PreviewToolContext) => {
    const owner = requestOwner(ctx)
    // An answer waiting behind a running turn already settles its question: it is listed with that answer.
    const answers = await queuedAnswers(owner, ctx.sessionId)
    const open = await listOpenInputRequests(ctx.sessionId, owner, new Set(answers.keys()))

    return toolResult({
      ...(answers.size
        ? {
            closed: [...answers].map(([requestId, { renderedText }]) => ({
              requestId,
              notice: renderedText,
            })),
            note: CLOSED,
          }
        : {}),
      requests: open.map(({ id, category, question, options, about, askedAt, snoozedUntil }) => ({
        requestId: id,
        category,
        question,
        ...(options ? { options } : {}),
        ...(about ? { about } : {}),
        askedAt,
        ...(snoozedUntil ? { snoozedUntil } : {}),
      })),
    })
  },
}

/**
 * MCP does not check arguments against the advertised schema, so the decision
 * tools do: a call with a wrong or unknown parameter is refused, naming it.
 */
export async function checkedCall<T>(
  tool: AiSdkToolLike,
  args: unknown,
  handle: (input: T) => Promise<ToolResult>,
): Promise<ToolResult> {
  const parsed = (tool.inputSchema as ZodType<T>).safeParse(args)

  if (parsed.success) return handle(parsed.data)
  // Each problem as one line the agent can act on, not the raw issue JSON.
  const problems = parsed.error.issues.map(({ path, message }) =>
    path.length ? `${path.join('.')}: ${message}` : message,
  )

  return toolError(`Invalid input: ${problems.join('; ')}`)
}

export function followUpHandler(
  name: keyof typeof requestFollowUps,
  tool: AiSdkToolLike,
  ctx: PreviewToolContext,
): ToolHandler {
  return (args) =>
    checkedCall<RequestFollowUp>(tool, args, (input) => requestFollowUps[name](ctx, input))
}

export function isRequestFollowUp(name: string): name is keyof typeof requestFollowUps {
  return name in requestFollowUps
}

/**
 * The `about` refs of a question, each a resource linked to this conversation
 * or another conversation it may message (send_message_to_thread), or why one
 * is not. Those conversations are told the answer too.
 */
export async function aboutRefs(
  ctx: PreviewToolContext,
  about: unknown,
): Promise<string[] | string> {
  if (!Array.isArray(about) || about.length === 0) return []
  const refs = [...new Set(about.filter((ref): ref is string => typeof ref === 'string'))]
  const conversation = await getConversationBySessionId(ctx.sessionId)
  const linked = new Set(conversation?.linkedResources?.map((resource) => resource.id))
  const { authorizeThreadDelivery } = await import('@/lib/agent/thread-bridge')
  const actor = { ...ctx, userId: requestOwner(ctx) }

  for (const ref of refs) {
    if (linked.has(ref)) continue
    const deliverable = await authorizeThreadDelivery({ ...actor, targetSessionId: ref }).then(
      () => true,
      () => false,
    )

    if (!deliverable)
      return `\`about\` names ${JSON.stringify(ref)}, which is neither a resource linked to this conversation (see list_session_resources) nor another conversation you own in this team.`
  }

  return refs
}

/**
 * The channel a question is asked in: the one whose post woke the turn that
 * asks it, read from that turn's wake notice. Any other turn (a sub-agent's
 * report, a Trigger, an answer) asks in the Bot's chat with its owner, where
 * they talk to it, when it has exactly one open. Otherwise none is guessed,
 * nor for the questions a card answers by itself.
 */
async function askedInChannel(
  ctx: PreviewToolContext,
  category: unknown,
): Promise<{ channelId?: string }> {
  if (category === 'credential' || category === 'integration') return {}
  const owner = requestOwner(ctx)
  const latest = await agentMessages().findOne(
    { sessionId: ctx.sessionId, userId: owner, role: 'user' },
    { sort: { index: -1 }, projection: { metadata: 1 } },
  )
  const metadata = parseMessageMetadata(latest?.metadata)
  const channelId =
    (metadata && channelIdOf({ source: metadata.source, metadata })) ??
    (await botChat(ctx.sessionId, owner))

  return channelId ? { channelId } : {}
}

/**
 * Where the question is asked, telling its owner there: the turn does not stop
 * for a question, so its end says nothing of it.
 */
export async function askInChannel(
  ctx: PreviewToolContext,
  category: unknown,
  question: string,
): Promise<{ channelId?: string }> {
  const asked = await askedInChannel(ctx, category)

  if (asked.channelId) {
    // The card is already out: an unread title falls back to the generic name.
    const bot = await getConversationBySessionId(ctx.sessionId).catch(() => null)

    if (
      category === 'preference' &&
      (bot?.botOnboarding === 'pending' || bot?.botOnboarding === 'active')
    )
      return asked
    notifyNudge([requestOwner(ctx)], {
      sessionId: asked.channelId,
      teamId: ctx.teamId,
      title: bot?.title || 'Nuphos agent',
      subtitle: 'Has a question for you',
      body: truncate(plainText(question)),
      ...botFace(bot),
    })
  }

  return asked
}

/** The owner's one open 1:1 chat with this Bot: a channel whose only members are the two. */
async function botChat(botId: string, owner: string): Promise<string | undefined> {
  const chats = (
    await agentConversations()
      .find(
        {
          userId: owner,
          kind: 'channel',
          agentSessionIds: [botId],
          archivedAt: { $exists: false },
        },
        { projection: { sessionId: 1, userId: 1, participantIds: 1 } },
      )
      .toArray()
  ).filter((chat) => conversationParticipantIds(chat).length === 1)

  return chats.length === 1 ? chats[0]!.sessionId : undefined
}
