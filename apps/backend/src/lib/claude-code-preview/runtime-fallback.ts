import { ObjectId } from 'mongodb'

import { agentConversations, getConversationBySessionId } from '@/lib/agent/db'
import { pushTimelineEvent } from '@/lib/agent/db/participants'
import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'
import { userTeamRuntimeFallbacks } from '@/models'

import { resolveConversationChatRuntime } from './conversation-chat-route'
import { moveConversationRuntime } from './conversation-runtime-move'
import { isRuntimeAuthRequired, runtimeUsageExhaustedMessage } from './openab-acp-errors'
import { listRuntimeInstances, listRuntimeQuotas } from './runtime-catalog'

import type { RuntimeInstance } from './runtime-instances'
import type { RuntimeQuota } from './runtime-quota'
import type { AgentConversation } from '@/lib/agent/db'
import type { RuntimeFallbackReason } from '@/lib/agent/db/timeline-events'

const LOW_PERCENT_LEFT = 10
/** A window this close to its reset is not worth leaving the agent for. */
const RESET_GRACE_MS = 30 * 60_000
/** An agent a turn failed on is not tried again for this long, so a fallback never loops. */
const FAILED_FOR_MS = 60 * 60_000
/**
 * The runtime itself cannot take the turn, as opposed to the conversation being
 * busy. A runtime still starting is left to finish rather than moved away from.
 */
const UNAVAILABLE = /(?:^|_)runtime_(?:offline|unreachable|unavailable|login_required)$/u
/** The move is refused for the conversation, not the destination: trying others is pointless. */
const CONVERSATION_REFUSALS = new Set([
  'conversation_busy',
  'conversation_read_only',
  'runtime_moving',
  'runtime_move_conflict',
  'runtime_coordination_unavailable',
  'runtime_environment_mismatch',
])

type Conversation = AgentConversation & { teamId: string; runtimeId: string }

const unreachable = (error: unknown) => error instanceof AppError && UNAVAILABLE.test(error.code)

/** The turn failed because of the agent: out of usage, signed out, or unreachable. */
export function runtimeFailed(error: unknown): boolean {
  return (
    Boolean(runtimeUsageExhaustedMessage(error)) ||
    isRuntimeAuthRequired(error) ||
    unreachable(error)
  )
}

/**
 * Where a turn sent by `actorId` may run. Only the owner runs on their own
 * computers; anyone else's turn resolves as them, so it needs a hosted agent.
 * A teammate's shared computer is never chosen without a person choosing it.
 */
function usableBy(instance: RuntimeInstance, conversation: Conversation, actorId: string) {
  if (instance.kind === 'local') return actorId === conversation.userId && !instance.local?.shared

  return actorId === conversation.userId || instance.kind === 'managed'
}

/** A Box asleep is woken by the turn; moving away would strand its files. */
async function onBox(conversation: Conversation): Promise<boolean> {
  const instances = await listRuntimeInstances(conversation.teamId, conversation.userId)

  return Boolean(instances.find((entry) => entry.id === conversation.runtimeId)?.local?.box)
}

/** Some usage window has under 10% left and does not reset within 30 minutes. */
export function lowOnUsage(quota: RuntimeQuota | undefined, now = Date.now()): boolean {
  if (!quota?.available) return false

  return quota.windows.some(
    (window) =>
      100 - window.usedPercent < LOW_PERCENT_LEFT &&
      !(window.resetsAt && Date.parse(window.resetsAt) - now < RESET_GRACE_MS),
  )
}

/** The agents a turn failed on within the last hour. */
function recentlyFailed(conversation: AgentConversation, now = Date.now()): string[] {
  const failed = conversation.runtimeFallback

  return failed && now - failed.at.getTime() < FAILED_FOR_MS ? failed.failed : []
}

async function fallbackList(conversation: Conversation): Promise<string[]> {
  const doc = await userTeamRuntimeFallbacks().findOne({
    teamId: new ObjectId(conversation.teamId),
    userId: conversation.userId,
  })

  return doc?.runtimeIds ?? []
}

function placed(conversation: AgentConversation | null): conversation is Conversation {
  return Boolean(conversation?.teamId && conversation.runtimeId)
}

/**
 * Moves the conversation to the first agent in its owner's fallback list that
 * is usable: not the current one, not low on usage, not failed within the hour,
 * and accepted by the move itself (enabled, online, ready). Returns the moved
 * conversation, or null when nothing was moved. When the turn cannot run where
 * it is, a stop is recorded with each agent's reason.
 */
async function fallBack(
  conversation: Conversation,
  list: string[],
  reason: RuntimeFallbackReason,
  options: { actorId: string; claimed: boolean },
): Promise<AgentConversation | null> {
  const { teamId, userId, runtimeId } = conversation
  const instances = await listRuntimeInstances(teamId, userId)
  const listed = list.flatMap((id) =>
    instances.filter(
      (instance) => instance.id === id && usableBy(instance, conversation, options.actorId),
    ),
  )
  const quotas = await listRuntimeQuotas(teamId, listed)
  const failed = recentlyFailed(conversation)
  const skipped: { label: string; reason: string }[] = []

  for (const id of list) {
    const instance = listed.find((candidate) => candidate.id === id)

    // Removed, or not one this turn's sender may run on: passed over without naming it.
    if (id === runtimeId || !instance) continue
    if (failed.includes(id)) skipped.push({ label: instance.label, reason: 'failed recently' })
    else if (lowOnUsage(quotas.find((quota) => quota.runtimeId === id)))
      skipped.push({ label: instance.label, reason: 'low on usage' })
    else {
      try {
        await moveConversationRuntime(conversation, id, 'history', userId, {
          reason,
          claimed: options.claimed,
        })

        return await getConversationBySessionId(conversation.sessionId)
      } catch (error) {
        if (!(error instanceof AppError)) throw error
        if (CONVERSATION_REFUSALS.has(error.code)) return null
        skipped.push({ label: instance.label, reason: error.message })
      }
    }
  }
  if (reason !== 'quota')
    await agentConversations().updateOne(
      { sessionId: conversation.sessionId },
      {
        $push: pushTimelineEvent({
          kind: 'runtime_fallback_stopped',
          at: new Date(),
          actorId: userId,
          skipped,
        }),
      },
    )

  return null
}

/**
 * Before a turn: moves a conversation whose agent is unreachable or low on
 * usage down its owner's fallback list. `actorId` sends the turn; `claimed`
 * says the caller holds the session's run claim. Never throws; a failed
 * fallback leaves it where it is.
 */
export async function fallBackBeforeTurn<T extends AgentConversation | null>(
  conversation: T,
  actorId: string,
  claimed = false,
): Promise<T | AgentConversation> {
  if (!placed(conversation)) return conversation
  try {
    const list = await fallbackList(conversation)

    if (!list.length) return conversation
    const reason = await beforeTurnReason(conversation)

    return (
      (reason && (await fallBack(conversation, list, reason, { actorId, claimed }))) || conversation
    )
  } catch (error) {
    logError('agent.runtime_fallback.error', error, { session_id: conversation.sessionId })

    return conversation
  }
}

async function beforeTurnReason(conversation: Conversation): Promise<RuntimeFallbackReason | null> {
  const current = (await listRuntimeInstances(conversation.teamId, conversation.userId)).filter(
    (instance) => instance.id === conversation.runtimeId,
  )

  try {
    await resolveConversationChatRuntime(conversation.teamId, conversation, {
      userId: conversation.userId,
    })
  } catch (error) {
    // Any other refusal is the turn's to report when it resolves its runtime.
    return runtimeFailed(error) && !current[0]?.local?.box ? 'offline' : null
  }
  const [quota] = await listRuntimeQuotas(conversation.teamId, current)

  return lowOnUsage(quota) ? 'quota' : null
}

/**
 * After a turn failed because of its agent: records the failure and moves the
 * conversation down the list, so the next attempt runs elsewhere. Called while
 * the failed run still holds the session's claim. Never throws.
 */
export async function fallBackAfterFailure(
  sessionId: string,
  error: unknown,
  actorId: string,
): Promise<void> {
  if (!runtimeFailed(error)) return
  try {
    const conversation = await getConversationBySessionId(sessionId)

    if (!placed(conversation)) return
    const list = await fallbackList(conversation)

    if (!list.length || (unreachable(error) && (await onBox(conversation)))) return
    const runtimeFallback = {
      failed: [...new Set([...recentlyFailed(conversation), conversation.runtimeId])],
      at: new Date(),
    }

    await agentConversations().updateOne({ sessionId }, { $set: { runtimeFallback } })
    await fallBack({ ...conversation, runtimeFallback }, list, 'failure', {
      actorId,
      claimed: true,
    })
  } catch (fallbackError) {
    logError('agent.runtime_fallback.error', fallbackError, { session_id: sessionId })
  }
}
