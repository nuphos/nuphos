import { randomUUID } from 'node:crypto'

import { agentConversations } from '@/lib/agent/db/shared'
import { parseLocalRuntimeId, sameRuntimeUrl } from '@/lib/agent/devices/local-runtime/address'
import { logError, logEvent } from '@/lib/observability'

import { controlRegistry } from './agent-chat-registry'
import { resolveLocalRuntimeEndpoint } from './local-runtime-catalog'
import { developmentRuntimeEndpoint, requireRuntimeInstance } from './runtime-catalog'
import { resolveTeamRuntimeEndpoints } from './runtime-registry'
import { RECLAIM_SESSION_HOME_PROGRAM } from './runtime-session-home-program'
import { conversationExecutionState } from './session-execution-state'

import type { AgentConversation } from '@/lib/agent/db/shared'
import type { Filter } from 'mongodb'

export { RECLAIM_SESSION_HOME_PROGRAM }

const RETRY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
// OpenAB ends an inner session idle this long (also its own default).
const SESSION_TTL_HOURS = 4

// Conversations whose home is no longer needed: archived ones, trigger runs nobody
// archives once the runtime has ended their inner session for idleness, and moved
// ones, whose home on the agent they left is never used again.
function reclaimableFilter(now: Date, since = new Date(0)): Filter<AgentConversation> {
  return {
    $or: [
      { archivedAt: { $gt: since } },
      {
        'metadata.trigger.id': { $exists: true },
        lastActiveAt: {
          $lte: new Date(now.getTime() - SESSION_TTL_HOURS * 60 * 60 * 1000),
          $gt: since,
        },
      },
      { 'runtimeMigration.movedAt': { $gt: since } },
    ],
  }
}

/** What made a conversation's home reclaimable, and when; `leftOn` only for a move. */
function reclaimReason(conversation: ReclaimCandidate) {
  const move = conversation.runtimeMigration

  if (conversation.archivedAt) return { field: 'archivedAt', at: conversation.archivedAt }
  if (move?.fromRuntimeId)
    return { field: 'runtimeMigration.movedAt', at: move.movedAt, leftOn: move.fromRuntimeId }

  // An idle trigger run, the only other match.
  return conversation.lastActiveAt ? { field: 'lastActiveAt', at: conversation.lastActiveAt } : null
}

type ReclaimCandidate = Pick<
  AgentConversation,
  | 'teamId'
  | 'sessionId'
  | 'userId'
  | 'agentRuntime'
  | 'runtimeId'
  | 'claudeCodePreview'
  | 'runtimeMigration'
  | 'archivedAt'
  | 'lastActiveAt'
> & { sessionHomeReclaimedAt?: Date } // Set once the home is gone since it became reclaimable.

const RECLAIM_PROJECTION = {
  teamId: 1,
  sessionId: 1,
  userId: 1,
  agentRuntime: 1,
  runtimeId: 1,
  claudeCodePreview: 1,
  runtimeMigration: 1,
  archivedAt: 1,
  lastActiveAt: 1,
}

/**
 * Removes a reclaimable conversation's CLI home once the runtime reports no live
 * session for it. Returns false to have a later sweep retry: still reclaimable
 * but in use, or the runtime is unreachable right now. Every computer, a Box or
 * someone's own, is reached over its control channel: an archived conversation's
 * folder goes as soon as nothing uses it (Yuanlin, #3939).
 */
export async function reclaimSessionHome(sessionId: string, now = new Date()): Promise<boolean> {
  // Re-read now: the sweep can run long, and a restored or resumed conversation keeps its home.
  const conversation = (await agentConversations().findOne(
    { sessionId, ...reclaimableFilter(now) },
    { projection: RECLAIM_PROJECTION },
  )) as ReclaimCandidate | null

  if (!conversation) return false
  const { teamId, runtimeId, agentRuntime: provider = 'claude-code' } = conversation
  const left = reclaimReason(conversation)?.leftOn

  if (!teamId || !runtimeId) return true
  if (left) return reclaimLeftHome(teamId, sessionId, left, runtimeId, provider)
  const endpoint = await controlEndpoint(teamId, runtimeId, provider)

  if (!endpoint) return false
  // Only the runtime knows whether its inner session (and any async task) is live.
  if ((await conversationExecutionState(conversation)).state !== 'dormant') return false

  return runReclaimJob(teamId, endpoint, sessionId)
}

/**
 * A moved conversation's home on the agent it left. Every agent on one computer,
 * and every agent in one runtime, shares its session homes, so a move between them
 * leaves nothing behind. One that cannot be resolved is left to that agent's own
 * idle sweep.
 */
async function reclaimLeftHome(
  teamId: string,
  sessionId: string,
  left: string,
  current: string,
  provider: NonNullable<AgentConversation['agentRuntime']>,
): Promise<boolean> {
  const [from, to] = [parseLocalRuntimeId(left), parseLocalRuntimeId(current)]

  if (from) {
    if (to?.userId === from.userId && to.deviceId === from.deviceId) return true
    const endpoint = await controlEndpoint(teamId, left, provider)

    return endpoint ? runReclaimJob(teamId, endpoint, sessionId) : false
  }
  const leftProvider = (await requireRuntimeInstance(teamId, left).catch(() => null))?.provider
  const endpoint = leftProvider && (await controlEndpoint(teamId, left, leftProvider))

  if (!endpoint) return true
  if (!to) {
    const now = await controlEndpoint(teamId, current, provider)

    if (!now || sameRuntimeUrl(endpoint.url, now.url)) return true
  }

  return runReclaimJob(teamId, endpoint, sessionId)
}

async function controlEndpoint(
  teamId: string,
  runtimeId: string,
  provider: NonNullable<AgentConversation['agentRuntime']>,
) {
  const local = parseLocalRuntimeId(runtimeId)

  // The computer's owner can always use it; one removed or offline is retried later.
  if (local)
    return resolveLocalRuntimeEndpoint(teamId, runtimeId, local.userId, 'control').catch(
      () => undefined,
    )

  return runtimeId === `development-${provider}`
    ? developmentRuntimeEndpoint(provider, 'control')
    : (await resolveTeamRuntimeEndpoints(teamId, provider, 'control')).find(
        (item) => item.runtimeId === runtimeId,
      )
}

async function runReclaimJob(
  teamId: string,
  endpoint: NonNullable<Awaited<ReturnType<typeof controlEndpoint>>>,
  sessionId: string,
): Promise<boolean> {
  const client = await controlRegistry.acquire(teamId, endpoint)
  const jobs = controlRegistry.runtimeJobs(teamId, endpoint)
  // A computer's own fixed job takes only the session id; `panel`, which runs the
  // text it is sent, is for the runtime image and older computers that have it.
  const request = jobs.includes('session-homes')
    ? { job: 'session-homes', stdin: JSON.stringify({ sessionId }) }
    : jobs.includes('panel')
      ? {
          job: 'panel',
          stdin: JSON.stringify({
            runner: RECLAIM_SESSION_HOME_PROGRAM,
            script: '',
            params: { sessionId },
          }),
        }
      : null

  if (!request) return false
  const result = await client.runJob(
    { jobId: randomUUID(), env: {}, timeoutMs: 60_000, maxStdoutBytes: 1024, ...request },
    65_000,
  )

  if (result.timedOut || result.exitCode !== 0 || typeof result.stdout !== 'string')
    throw new Error(`Reclaiming the session home failed: ${JSON.stringify(result)}`)

  return reclaimed(result.stdout, sessionId)
}

/** Reads the program's report: false keeps the home for a later sweep. */
function reclaimed(stdout: string, sessionId: string): boolean {
  const outcome = JSON.parse(stdout) as { result?: string; unreadable?: string }

  // Kept because a process could not be inspected; a host where this repeats
  // never reclaims anything.
  if (outcome.unreadable)
    logEvent('warn', 'agent.session_home_reclaim.unreadable_process', {
      session_id: sessionId,
      process: outcome.unreadable,
    })

  return outcome.result !== 'in_use'
}

/**
 * Hourly: reclaimable conversations whose home is not reclaimed since they
 * became reclaimable. One that is still running is retried on the next sweep.
 */
export async function reclaimSessionHomes(now = new Date()): Promise<number> {
  const candidates = (await agentConversations()
    .find(reclaimableFilter(now, new Date(now.getTime() - RETRY_WINDOW_MS)), {
      projection: {
        sessionId: 1,
        archivedAt: 1,
        lastActiveAt: 1,
        runtimeMigration: 1,
        sessionHomeReclaimedAt: 1,
      },
    })
    .toArray()) as ReclaimCandidate[]
  let reclaimed = 0

  for (const conversation of candidates) {
    // An unarchived trigger run counts from its last turn, a moved conversation from
    // its move; a later turn or move reclaims again.
    const reason = reclaimReason(conversation)

    if (!reason) continue
    if (conversation.sessionHomeReclaimedAt && conversation.sessionHomeReclaimedAt >= reason.at)
      continue
    try {
      if (!(await reclaimSessionHome(conversation.sessionId, now))) continue
      await agentConversations().updateOne(
        { sessionId: conversation.sessionId, [reason.field]: reason.at },
        { $set: { sessionHomeReclaimedAt: now } },
      )
      reclaimed += 1
    } catch (err) {
      logError('agent.session_home_reclaim.failed', err, { session_id: conversation.sessionId })
    }
  }
  if (reclaimed > 0) logEvent('info', 'agent.session_home_reclaim.swept', { reclaimed })

  return reclaimed
}
