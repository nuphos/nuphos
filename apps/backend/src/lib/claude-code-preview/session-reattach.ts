import { getConversationPreviewAttachment } from '@/lib/agent/db'
import { isShuttingDown } from '@/lib/lifecycle'
import { logError, logEvent } from '@/lib/observability'

import { registry, sessionsByConversation } from './agent-chat-registry'
import { observeAutonomousUpdates } from './autonomous-session-observer'
import { markBackgroundWorkLost } from './background-work'
import { previewRuntimeCwd } from './team-openab-runtime'

import type { TeamPreviewClient, TeamSession } from './team-openab-runtime'

export const REATTACH_DELAYS_MS = [0, 1_000, 2_000, 5_000, 10_000, 30_000, 60_000]

type Sleep = (ms: number) => Promise<void>
const sleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The gateway routes a session's runtime-owned output (background-task
 * continuations, wakeups) to the last connection that resumed it. When that
 * shared transport goes away, nothing else resumes the session until the user
 * speaks, and the runtime parks the continuation as "output connection lost".
 */
export function observeSession(session: TeamSession): void {
  observeAutonomousUpdates(session)
  const transport = session.client
  const onLost = () => {
    void reattachAfterTransportLoss(session, transport)
  }
  const stopClosed = transport.onClosed(onLost)
  const stopRetired = transport.onRetired(onLost)
  const stopUpdates = session.stopObserving

  session.stopObserving = () => {
    stopClosed()
    stopRetired()
    stopUpdates?.()
  }
}

export async function resumeSessionOn(
  session: TeamSession,
  client: TeamPreviewClient,
): Promise<{ alive: boolean }> {
  const previous = session.client

  session.client = client
  observeSession(session)
  let result: { alive: boolean }

  try {
    result = await client.loadSession(
      session.openabSessionId,
      previewRuntimeCwd(session.conversationId),
      session.mcpServers,
      session.systemPrompt,
      session.runtime,
    )
  } catch (error) {
    if (session.client === client) {
      session.client = previous
      observeSession(session)
    }
    throw error
  }
  if (!result.alive) {
    session.innerSessionLost = true
    logEvent('warn', 'agent.openab_session.inner_session_lost', {
      team_id: session.teamId,
      session_id: session.conversationId,
      openab_session_id: session.openabSessionId,
    })
    await markBackgroundWorkLost(session, 'session_lost')
  }

  return result
}

/**
 * `stillOwned`, separating "someone else owns this now" from "the bookkeeping
 * read failed". The first ends reattachment; the second is worth retrying and
 * says nothing about the agent process either way.
 */
async function owned(
  session: TeamSession,
  transport: TeamPreviewClient,
  attempt: number,
): Promise<'yes' | 'no' | 'unknown'> {
  try {
    return (await stillOwned(session, transport)) ? 'yes' : 'no'
  } catch (error) {
    logError('agent.openab_session.reattach_ownership_unknown', error, {
      team_id: session.teamId,
      session_id: session.conversationId,
      attempt: attempt + 1,
    })

    return 'unknown'
  }
}

async function stillOwned(session: TeamSession, transport: TeamPreviewClient): Promise<boolean> {
  if (session.client !== transport) return false
  if (sessionsByConversation.get(`${session.teamId}:${session.conversationId}`) !== session)
    return false
  const attachment = await getConversationPreviewAttachment(session.conversationId, session.teamId)

  return Boolean(
    attachment &&
    attachment.runtimeUrl === session.endpoint.url &&
    attachment.openabSessionId === session.openabSessionId,
  )
}

export async function reattachAfterTransportLoss(
  session: TeamSession,
  transport: TeamPreviewClient,
  delays: number[] = REATTACH_DELAYS_MS,
  wait: Sleep = sleep,
): Promise<boolean> {
  // A draining replica hands its sessions on; winning one back would strand it.
  if (session.reattaching || isShuttingDown()) return false
  session.reattaching = transport
  // Set only by a failure against the runtime itself, never by a bookkeeping
  // read that happened to throw: a Mongo hiccup is no evidence about the
  // agent process.
  let unreachable = false

  try {
    for (const [attempt, delay] of delays.entries()) {
      if (delay > 0) await wait(delay)
      const ownership = await owned(session, transport, attempt)

      if (ownership === 'unknown') continue
      if (ownership === 'no') break
      try {
        const client = await registry.acquire(session.teamId, session.endpoint)

        if (session.client !== transport) break
        await resumeSessionOn(session, client)
        logEvent('info', 'agent.openab_session.reattached', {
          team_id: session.teamId,
          session_id: session.conversationId,
          attempt: attempt + 1,
        })

        return true
      } catch (error) {
        logError('agent.openab_session.reattach_failed', error, {
          team_id: session.teamId,
          session_id: session.conversationId,
          attempt: attempt + 1,
        })
        unreachable = true
      }
    }
    // Every retry is spent and the session is still off the air. Whether the
    // process that held it survived is unknown, so the conversation is told
    // that much and no more. Recorded here rather than on the first failure
    // so a blip the next attempt recovers from says nothing, and recorded on
    // a break as well as on exhaustion: an attempt that finds the session
    // superseded hands ownership on without ever resuming.
    if (unreachable) await markBackgroundWorkLost(session, 'unreachable')

    return false
  } finally {
    if (session.reattaching === transport) session.reattaching = undefined
  }
}
