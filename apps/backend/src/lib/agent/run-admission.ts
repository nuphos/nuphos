import { randomUUID } from 'node:crypto'

import { config } from '@/config'
import { assertConversationRuntimeAvailable } from '@/lib/claude-code-preview/runtime-portability-store'
import { AppError } from '@/lib/errors'
import { redisEnabled } from '@/lib/redis'

import { getActiveAgentRunForSession, reserveActiveAgentRunForSession } from './run-store'

import type { AgentRun } from '@/routes/agent/types'

export const agentRuns = new Map<string, AgentRun>()
const agentRunSessionReservations = new Map<string, string>()

function agentRunSessionReservationKey(userId: string, sessionId: string): string {
  return `${userId}:${sessionId}`
}

export function getLocalActiveAgentRun(
  userId: string,
  sessionId: string,
): { streamId: string; startedAt: string; actorUserId: string } | null {
  let latest: AgentRun | null = null

  // eslint-disable-next-line sonarjs/no-empty-collection -- shared map is populated by registerAgentRun in run-registry
  for (const run of agentRuns.values()) {
    if (run.userId === userId && run.sessionId === sessionId && !run.done) {
      if (!latest || run.createdAt > latest.createdAt) latest = run
    }
  }

  return latest
    ? {
        streamId: latest.streamId,
        startedAt: new Date(latest.createdAt).toISOString(),
        actorUserId: latest.trace?.userId ?? latest.userId,
      }
    : null
}

export async function activeRunForSession(userId: string, sessionId: string) {
  return (
    getLocalActiveAgentRun(userId, sessionId) ??
    (await getActiveAgentRunForSession(userId, sessionId))
  )
}

export async function hasActiveAgentRunForSession(
  userId: string,
  sessionId: string,
): Promise<boolean> {
  return (await activeRunForSession(userId, sessionId)) !== null
}

export async function claimAgentRunForSession(
  userId: string,
  sessionId: string,
  runtimeOperation = false,
): Promise<(() => void) | null> {
  // Redis is what keeps two backend replicas from moving or deleting the same
  // conversation at once. Development runs a single replica — and the local dev
  // stack has no Redis at all — so the in-process reservation below is already
  // the whole coordination there. This used to also require the provisioner's
  // kubectl flag, which decides how runtimes are reconciled and says nothing
  // about replica count: with the default local stack that left every move and
  // deletion refused with a 503 no developer could act on.
  if (runtimeOperation && !redisEnabled() && config.nodeEnv !== 'development') {
    throw new AppError(
      503,
      'runtime_coordination_unavailable',
      'Agent moves and deletion require shared run coordination. Please contact your administrator.',
    )
  }
  if (await hasActiveAgentRunForSession(userId, sessionId)) return null

  const key = agentRunSessionReservationKey(userId, sessionId)

  if (agentRunSessionReservations.has(key)) return null
  const token = randomUUID()

  agentRunSessionReservations.set(key, token)

  const releaseRemoteReservation = await reserveActiveAgentRunForSession(userId, sessionId, token)

  if (!releaseRemoteReservation) {
    if (agentRunSessionReservations.get(key) === token) {
      agentRunSessionReservations.delete(key)
    }

    return null
  }

  try {
    if (!runtimeOperation) await assertConversationRuntimeAvailable(sessionId)
  } catch (error) {
    agentRunSessionReservations.delete(key)
    releaseRemoteReservation()
    throw error
  }
  let released = false

  return () => {
    if (released) return
    released = true
    if (agentRunSessionReservations.get(key) === token) {
      agentRunSessionReservations.delete(key)
    }
    releaseRemoteReservation()
  }
}
