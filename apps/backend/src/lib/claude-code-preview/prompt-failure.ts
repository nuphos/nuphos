import { forgetConversationPreviewSession } from '@/lib/agent/db'
import { logError } from '@/lib/observability'

import { acpErrorCode, OpenAbRpcError } from './openab-acp-errors'
import { refusal } from './runtime-refusal'

import type { RuntimeDefaults } from './openab-acp-session'
import type { TeamSession } from './team-openab-runtime'

/** claude-agent-acp's plain "Session not found", which the ACP SDK relays under -32603. */
const SESSION_NOT_FOUND = /(?:^|\n)> Session not found$/u

/**
 * The agent answered that it does not hold the session: ACP's "resource not found", or
 * claude-agent-acp's "Session not found". The gateway's own -32002 ("Not initialized") is about
 * the transport, so a -32002 must carry the agent's wording too.
 */
export function agentLostSession(error: unknown): boolean {
  if (!(error instanceof OpenAbRpcError)) return false
  if (acpErrorCode(error) === -32002) return error.message.includes('Resource not found')

  return SESSION_NOT_FOUND.test(error.message)
}

/**
 * What a failed prompt throws. The runtime's own busy rejection means another turn won the race
 * since admission was checked. A runtime before 0.1.62 keeps prompting a session its agent lost,
 * so every later message would fail the same way: forget it, and the next one opens a new session.
 */
export async function promptFailure(
  error: unknown,
  session: Pick<TeamSession, 'conversationId' | 'teamId' | 'openabSessionId'>,
  defaults?: RuntimeDefaults,
): Promise<unknown> {
  if (error instanceof OpenAbRpcError && error.code === -32001) return refusal(error.message)
  // A failed write must not replace the agent's error; the next message forgets it again.
  if (agentLostSession(error))
    await forgetConversationPreviewSession(
      session.conversationId,
      session.teamId,
      session.openabSessionId,
      defaults,
    ).catch((writeError: unknown) => {
      logError('agent.openab_session.forget_failed', writeError, {
        team_id: session.teamId,
        session_id: session.conversationId,
        openab_session_id: session.openabSessionId,
      })
    })

  return error
}
