// Follow-ups to request_user_decision: the agent lists, corrects or withdraws
// the questions it asked while they are still open in the user's Inbox.
import { getConversationBySessionId } from '@/lib/agent/db'
import {
  listOpenInputRequests,
  resolveInputRequest,
  updateInputRequest,
} from '@/lib/agent/db/pending-decision'
import { queuedAnswers } from '@/lib/agent/pending-queue'
import { toolError, toolResult } from '@/lib/mcp/protocol'

import type { PreviewToolContext } from '../preview-tool-context'
import type { AiSdkToolLike } from './ai-sdk-adapter'
import type { DecisionQuestion } from '@/lib/agent/tools-skilled/types'
import type { ToolHandler } from '@/lib/mcp/protocol'
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
    (await resolveInputRequest(ctx.sessionId, requestOwner(ctx), requestId, 'dismissed'))
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

/** MCP does not check arguments against the advertised schema, so the follow-ups do. */
export function followUpHandler(
  name: keyof typeof requestFollowUps,
  tool: AiSdkToolLike,
  ctx: PreviewToolContext,
): ToolHandler {
  const schema = tool.inputSchema as ZodType<RequestFollowUp>

  return async (args) => {
    const parsed = schema.safeParse(args)

    return parsed.success
      ? requestFollowUps[name](ctx, parsed.data)
      : toolError(`Invalid input: ${parsed.error.message}`)
  }
}

export function isRequestFollowUp(name: string): name is keyof typeof requestFollowUps {
  return name in requestFollowUps
}

/**
 * The `about` refs of a question, each a resource linked to this conversation
 * or one of its own sub-agent threads, or why one is not.
 */
export async function aboutRefs(
  ctx: PreviewToolContext,
  about: unknown,
): Promise<string[] | string> {
  if (!Array.isArray(about) || about.length === 0) return []
  const refs = [...new Set(about.filter((ref): ref is string => typeof ref === 'string'))]
  const conversation = await getConversationBySessionId(ctx.sessionId)
  const linked = new Set(conversation?.linkedResources?.map((resource) => resource.id))

  for (const ref of refs) {
    if (linked.has(ref)) continue
    const thread = await getConversationBySessionId(ref)

    if (thread?.parentSessionId !== ctx.sessionId)
      return `\`about\` names ${JSON.stringify(ref)}, which is neither a resource linked to this conversation (see list_session_resources) nor one of its sub-agent threads.`
  }

  return refs
}
