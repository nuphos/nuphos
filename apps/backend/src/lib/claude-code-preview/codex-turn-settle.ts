import { CodexTurnFailedError } from './codex-turn-failure'
import { conversationExecutionState } from './session-execution-state'

import type { TeamSession } from './team-openab-runtime'

export function lastTextChunkTracker(onTextDelta: (text: string) => void) {
  let last = ''

  return {
    onTextDelta: (text: string) => {
      last = text
      onTextDelta(text)
    },
    last: () => last,
  }
}

async function assertCodexTurnSucceeded(session: TeamSession, lastTextChunk: string) {
  if (session.endpoint.provider !== 'codex') return
  const observed = await conversationExecutionState({
    teamId: session.teamId,
    sessionId: session.conversationId,
    userId: session.conversationOwnerUserId ?? session.userId,
    agentRuntime: 'codex',
    runtimeId: session.endpoint.runtimeId,
    claudeCodePreview: {
      runtimeUrl: session.endpoint.url,
      openabSessionId: session.openabSessionId,
    },
  })

  if (observed.providerState !== 'systemError') return
  throw new CodexTurnFailedError(lastTextChunk.endsWith('\n\n') ? lastTextChunk : '')
}

/** The prompt's stop reason, once a Codex `end_turn` is confirmed not to be a provider failure. */
export async function settledCodexStopReason(
  session: TeamSession,
  result: Record<string, unknown>,
  lastTextChunk: string,
): Promise<string> {
  const stopReason = typeof result.stopReason === 'string' ? result.stopReason : 'end_turn'

  if (stopReason === 'end_turn') await assertCodexTurnSucceeded(session, lastTextChunk)

  return stopReason
}
