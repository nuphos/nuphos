// Follow-ups to request_user_decision: the agent corrects or withdraws a
// question it asked while it is still open in the user's Inbox.
import { resolveInputRequest, updateInputRequest } from '@/lib/agent/db/pending-decision'
import { toolError, toolResult } from '@/lib/mcp/protocol'

import type { PreviewToolContext } from '../preview-tool-context'
import type { AiSdkToolLike } from './ai-sdk-adapter'
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
}

const NOT_OPEN = 'No open question has this requestId; the user may have answered it already.'

/** The agent corrects or withdraws a question it asked while the user has not answered it. */
const requestFollowUps = {
  update_user_decision: async (ctx: PreviewToolContext, input: RequestFollowUp) => {
    const { requestId, label: _label, ...patch } = input

    if (Object.keys(patch).length === 0)
      return toolError('Pass question, body or options to change.')

    return (await updateInputRequest(ctx.sessionId, requestOwner(ctx), requestId, patch))
      ? toolResult({ ok: true, requestId, status: 'updated' })
      : toolError(NOT_OPEN)
  },
  withdraw_user_decision: async (ctx: PreviewToolContext, { requestId }: RequestFollowUp) =>
    (await resolveInputRequest(ctx.sessionId, requestOwner(ctx), requestId, 'dismissed'))
      ? toolResult({ ok: true, requestId, status: 'withdrawn' })
      : toolError(NOT_OPEN),
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
