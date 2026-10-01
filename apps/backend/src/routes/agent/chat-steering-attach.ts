import { handleExistingRun, resumeFromRedisOrThrow } from './chat-resume'
import { agentRunKey, agentRuns } from './run-registry'
import { restoreArchivedForTurn } from './turn-unarchive'

import type { ResumeParams } from './types'
import type { AgentConversation } from '@/lib/agent/db'

/**
 * Admission already queued the steering message durably, so the turn is
 * accepted whether or not this request manages to reattach to the stream.
 */
export async function attachSteeringTurn(
  params: ResumeParams,
  streamId: string,
  conversation: AgentConversation | null,
): Promise<Response> {
  await restoreArchivedForTurn(conversation, 'user')
  const steeringParams = { ...params, streamId }
  const liveRun = agentRuns.get(agentRunKey(params.runOwnerUserId, streamId))
  const attached = liveRun ? handleExistingRun(liveRun, steeringParams) : null

  return attached ?? (await resumeFromRedisOrThrow(steeringParams))
}
