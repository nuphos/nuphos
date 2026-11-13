// Follow-ups to request_user_decision: the agent lists, corrects or withdraws
// the questions it asked while they are still open in the user's Inbox.
import { channelIdOf } from '@/lib/agent/channel-wake'
import { agentConversations, agentMessages, getConversationBySessionId } from '@/lib/agent/db'
import { conversationParticipantIds } from '@/lib/agent/db/participants'
import {
  listOpenInputRequests,
  resolveInputRequest,
  updateInputRequest,
} from '@/lib/agent/db/pending-decision'
import { parseMessageMetadata } from '@/lib/agent/message-metadata'
import { queuedAnswers } from '@/lib/agent/pending-queue'
import { toolError, toolResult } from '@/lib/mcp/protocol'

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

const NOT_OPEN = 'No open question has this requestId; the user may have answered it already.'

/** The agent lists, corrects or withdraws the questions it asked while the user has not answered them. */
const requestFollowUps = {
  update_user_decision: async (ctx: PreviewToolContext, input: RequestFollowUp) => {
    const { requestId, label: _label, ...patch } = input

    if (Object.keys(patch).length === 0)
      return toolError('Pass question, body, options, multiSelect or questions to change.')

    return (await updateInputRequest(ctx.sessionId, requestOwner(ctx), requestId, patch))
      ? toolResult({ ok: true, requestId, status: 'updated' })
      : toolError(NOT_OPEN)
  },
  withdraw_user_decision: async (ctx: PreviewToolContext, { requestId }: RequestFollowUp) =>
    (await resolveInputRequest(ctx.sessionId, requestOwner(ctx), requestId))
      ? toolResult({ ok: true, requestId, status: 'withdrawn' })
      : toolError(NOT_OPEN),
  list_user_decisions: async (ctx: PreviewToolContext) => {
    const owner = requestOwner(ctx)
    // An answer waiting behind a running turn already settles its question.
    const answering = new Set((await queuedAnswers(owner, ctx.sessionId)).keys())
    const open = await listOpenInputRequests(ctx.sessionId, owner, answering)

    return toolResult({
      requests: open.map(({ id, category, question, options, about, askedAt }) => ({
        requestId: id,
        category,
        question,
        ...(options ? { options } : {}),
        ...(about ? { about } : {}),
        askedAt,
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

  return parsed.success ? handle(parsed.data) : toolError(`Invalid input: ${parsed.error.message}`)
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
export async function askedInChannel(
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
