import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { agentConversations } from '@/lib/agent/db'
import { readableConversationScope } from '@/lib/agent/db/access'
import { escapeRegExp } from '@/lib/agent/db/shared'
import { getTeamMembership } from '@/lib/identity'
import { toolError, toolResult } from '@/lib/mcp/protocol'

import type { ToolResult } from '@/lib/mcp/protocol'
import type { McpCallContext } from '@/routes/mcp/types'

const lookupInput = z.object({
  team_id: z.string().trim().min(1),
  repository: z
    .string()
    .trim()
    .regex(/^[\w.-]+\/[\w.-]+$/)
    .max(200),
  number: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  cursor: z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .optional(),
  limit: z.number().int().min(1).max(100).default(30),
})

export async function nuphosFindPrSessions(
  args: Record<string, unknown>,
  ctx: McpCallContext,
): Promise<ToolResult> {
  const parsed = lookupInput.safeParse(args)

  if (!parsed.success) return toolError(parsed.error.message)
  const { team_id: teamId, repository, number, cursor, limit } = parsed.data

  if (!(await getTeamMembership(ctx.userId, teamId)))
    return toolError(`You are not a member of team ${teamId}.`)
  const conversations = await agentConversations()
    .find(
      readableConversationScope(
        {
          linkedResources: {
            $elemMatch: {
              provider: 'github',
              repository: new RegExp(`^${escapeRegExp(repository)}$`, 'i'),
              number,
              kind: { $ne: 'issue' },
            },
          },
          ...(cursor ? { _id: { $lt: new ObjectId(cursor) } } : {}),
        },
        ctx.userId,
        teamId,
      ),
    )
    .sort({ _id: -1 })
    .limit(limit + 1)
    .toArray()
  const page = conversations.slice(0, limit)

  return toolResult({
    bound_to: { provider: 'github', repository, number },
    sessions: page.map((conversation) => ({
      session_id: conversation.sessionId,
      title: conversation.title,
      ...(conversation.runtimeLabel ? { agent: conversation.runtimeLabel } : {}),
    })),
    next_cursor: conversations.length > limit ? (page.at(-1)?._id.toHexString() ?? null) : null,
    note: 'These sessions are bound to the pull request. A binding is not proof of authorship.',
  })
}
