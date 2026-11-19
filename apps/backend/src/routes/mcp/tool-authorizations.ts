// A tool call waiting for approval ("Approve once / Deny" in the app), listed
// and decided over MCP through the same runtime request the app's card resolves.
// The runtime keys each one to the person whose turn it is, so a caller only
// ever sees and decides their own, as Slack's approval buttons allow.

import { recordAgentEvent } from '@/lib/agent/db'
import {
  listPendingPreviewWaits,
  resolvePreviewDecision,
} from '@/lib/claude-code-preview/decision-waiter'
import { toolError, toolResult } from '@/lib/mcp/protocol'
import { logError } from '@/lib/observability'

import type { LiveTurn } from '@/lib/agent/live-turn'
import type { ToolResult } from '@/lib/mcp/protocol'
import type { McpCallContext } from '@/routes/mcp/types'

const INPUT_LIMIT = 2_000

/** Large inputs (a file being written) are clipped; the tool and its gist are what a decider needs. */
function clipped(input: unknown): unknown {
  const json = JSON.stringify(input)

  return json && json.length > INPUT_LIMIT ? `${json.slice(0, INPUT_LIMIT)}…` : input
}

/** The caller's pending approvals in the session, with each tool's name and input from the live turn. */
export async function toolAuthorizations(sessionId: string, userId: string, live: LiveTurn | null) {
  let waits: Awaited<ReturnType<typeof listPendingPreviewWaits>>

  try {
    waits = await listPendingPreviewWaits(userId, sessionId)
  } catch (err) {
    // The runtime is unreachable or moved: nothing can be approved there now.
    logError('mcp.check.tool_authorizations_failed', err, { session_id: sessionId })

    return []
  }

  return waits
    .filter((wait) => wait.kind === 'agent-permission')
    .map((wait) => {
      const tool = live?.parts.find((part) => part.type === 'tool' && part.id === wait.ref)

      return {
        request_id: wait.waitId,
        category: 'tool_authorization',
        ...(tool?.type === 'tool'
          ? { tool: tool.name, ...(tool.input === undefined ? {} : { input: clipped(tool.input) }) }
          : {}),
        asked_at: new Date(wait.createdAt).toISOString(),
      }
    })
}

const DECISIONS: Record<string, 'approved' | 'rejected'> = {
  approve: 'approved',
  deny: 'rejected',
}

/**
 * Approves or denies the caller's pending tool call `requestId` with prompt
 * "approve" or "deny". Null when it is none of theirs: an open question, perhaps.
 */
export async function answerToolAuthorization(
  sessionId: string,
  requestId: string,
  prompt: string,
  ctx: McpCallContext,
): Promise<ToolResult | null> {
  const waits = await listPendingPreviewWaits(ctx.userId, sessionId).catch(() => [])
  const wait = waits.find((w) => w.waitId === requestId && w.kind === 'agent-permission')

  if (!wait) return null
  const decision = DECISIONS[prompt.trim().toLowerCase()]

  if (!decision)
    return toolError('A tool authorization is answered with prompt "approve" or "deny".')
  const resolved = await resolvePreviewDecision({
    userId: ctx.userId,
    sessionId,
    waitId: wait.waitId,
    payload: { decision },
  })

  if (!resolved) return toolError('This tool request was already decided or has expired.')
  recordAgentEvent({
    conversationId: sessionId,
    userId: ctx.userId,
    event: 'decision.answered',
    data: {
      requestId,
      decision,
      via: 'mcp',
      ...(ctx.client?.name ? { client: ctx.client.name } : {}),
    },
  })

  return toolResult({
    status: 'running',
    session_id: sessionId,
    progress: {
      message: `The tool call was ${decision === 'approved' ? 'approved' : 'denied'} and the Nuphos Agent carries on. Poll nuphos_check.`,
    },
  })
}
