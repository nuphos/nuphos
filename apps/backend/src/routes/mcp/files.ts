import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { getReadableConversation } from '@/lib/agent/db'
import { AppError } from '@/lib/errors'
import { listSessionDownloadsSince } from '@/lib/file-transfer/service'
import { toolError, toolResult } from '@/lib/mcp/protocol'

import type { ToolResult } from '@/lib/mcp/protocol'
import type { McpCallContext } from '@/routes/mcp/types'

const filesInput = z.object({
  session_id: z.string().trim().min(1),
  limit: z.number().int().min(1).max(100).default(50),
})

export async function nuphosFiles(
  args: Record<string, unknown>,
  ctx: McpCallContext,
): Promise<ToolResult> {
  const parsed = filesInput.safeParse(args)

  if (!parsed.success) return toolError(parsed.error.message)
  const { session_id: sessionId, limit } = parsed.data
  const conversation = await getReadableConversation(sessionId, ctx.userId)

  if (!conversation?.teamId) return toolError(`Session not found: ${sessionId}`)
  try {
    const groups = await listSessionDownloadsSince({
      teamId: new ObjectId(conversation.teamId),
      sessionId,
      since: new Date(0),
      limit,
    })

    return toolResult({
      session_id: sessionId,
      groups,
      note: 'Fetch each ready file’s downloadUrl directly. URLs and files expire; call again to refresh URLs. Only files published through file-transfer are listed.',
    })
  } catch (error) {
    if (error instanceof AppError) return toolError(error.message)
    throw error
  }
}
