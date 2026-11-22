import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'

import { updateConversationSettings } from '@/lib/agent/db/settings-history'
import { agentConversations } from '@/lib/agent/db/shared'
import { deliverWaitingAnswers } from '@/lib/agent/deliver-waiting-answers'
import { claimAgentRunForSession } from '@/lib/agent/run-admission'
import { AppError } from '@/lib/errors'

import { closePreviewConversationSession } from './agent-chat-registry'
import { lastFailedPrompt, resendFailedPrompt } from './failed-turn-retry'
import { resolveLocalRuntimeEndpoint } from './local-runtime-catalog'
import { developmentRuntimeEndpoint, requireRuntimeInstance } from './runtime-catalog'
import { runtimeModelCatalog } from './runtime-models'
import { runtimeProvider } from './runtime-provider'
import { resolveTeamRuntimeEndpoints } from './runtime-registry'
import { reclaimSessionHome } from './runtime-session-home'
import { offeredSessionConfig } from './session-config-catalog'
import { storedPick } from './session-config-options'

import type { FailedPrompt } from './failed-turn-retry'
import type { SettingsChangeBy } from '@/lib/agent/db/settings-history'
import type { AgentConversation } from '@/lib/agent/db/shared'
import type { RuntimeFallbackReason } from '@/lib/agent/db/timeline-events'

export async function moveConversationRuntime(
  conversation: AgentConversation,
  targetId: string,
  userId: string,
  /** A fallback names its reason; `claimed` when the caller already holds the session's run claim.
   *  `by` names who asked and from where; absent, the owner moved it, or a fallback did. */
  options: { reason?: RuntimeFallbackReason; claimed?: boolean; by?: SettingsChangeBy } = {},
) {
  const teamId = conversation.teamId
  const ownerId = conversation.userId

  if (!teamId || conversation.userId !== userId)
    throw new AppError(403, 'conversation_read_only', 'Only the conversation owner can move it.')
  const provider = runtimeProvider(conversation.agentRuntime)
  const sourceUrl = conversation.claudeCodePreview?.runtimeUrl
  const target = await requireRuntimeInstance(teamId, targetId, userId)

  if (target.status !== 'active')
    throw new AppError(409, 'runtime_unavailable', 'Choose an agent that is enabled.')
  // Only the conversation history moves: it reaches a freshly created inner
  // session as the plain-text preamble previewHistoryPreamble builds from the
  // stored transcript, so Claude Code ↔ Codex is just another move. Files stay
  // behind, since every conversation on a runtime shares its /workspace.
  if (conversation.runtimeId === target.id)
    return { runtimeId: target.id, runtimeLabel: target.label, agentRuntime: target.provider }
  const endpoints = await resolveTeamRuntimeEndpoints(teamId, target.provider)
  const development = developmentRuntimeEndpoint(target.provider)

  if (development) endpoints.push(development)
  if (target.kind === 'local')
    endpoints.push(await resolveLocalRuntimeEndpoint(teamId, target.id, userId, 'transport'))
  const endpoint = endpoints.find((entry) => entry.runtimeId === target.id)

  if (!endpoint)
    throw new AppError(409, 'runtime_starting', 'The destination agent is not ready yet.')
  const token = randomUUID()
  const locked = await agentConversations().updateOne(
    {
      sessionId: conversation.sessionId,
      teamId,
      userId: ownerId,
      runtimeId: conversation.runtimeId ?? { $exists: false },
      $or: [
        { runtimeOperation: { $exists: false } },
        { 'runtimeOperation.expiresAt': { $lte: new Date() } },
      ],
    },
    { $set: { runtimeOperation: { token, expiresAt: new Date(Date.now() + 10 * 60_000) } } },
  )

  if (!locked.matchedCount)
    throw new AppError(
      409,
      'runtime_moving',
      'This conversation changed or is already being moved. Refresh and try again.',
    )
  let release: (() => void) | null = null
  let retry: FailedPrompt | null | undefined

  try {
    release = options.claimed ? () => {} : await claimSession(conversation, !options.reason)
    if (!release)
      throw new AppError(
        409,
        'conversation_busy',
        'The current response has not stopped yet. Try the move again.',
      )
    const latestTarget = await requireRuntimeInstance(teamId, target.id, userId)

    if (latestTarget.status !== 'active')
      throw new AppError(
        409,
        'runtime_unavailable',
        'The destination was disabled during the move. Choose another agent and retry.',
      )
    const latest = await agentConversations().findOne({
      sessionId: conversation.sessionId,
      teamId,
      userId: ownerId,
      'runtimeOperation.token': token,
    })

    // A person's move, likely off a runtime that just failed a turn: it runs again there.
    retry = options.reason ? null : await lastFailedPrompt(conversation.sessionId, ownerId)
    const saved = latest?.claudeCodePreview
      ? storedPick(latest.claudeCodePreview)
      : latest?.initialSessionConfig
    // The choices the destination still offers, and its own effort and fast
    // where none is, so the moved Task never runs on a level nobody sees.
    // Another provider's ids mean nothing there: its choices start over.
    const sameProvider = target.provider === provider
    const pick = await offeredSessionConfig(
      (model) => runtimeModelCatalog(teamId, target.id, model, userId),
      (sameProvider && saved) || {},
    ).then(
      ({ kept }) => kept,
      () => (sameProvider ? (saved ?? {}) : undefined),
    )
    const by: SettingsChangeBy = {
      ...(options.by ??
        (options.reason
          ? { actorId: 'system', via: 'runtime_fallback', reason: options.reason }
          : { actorId: userId, via: 'runtime_move' })),
      ...(retry ? { retrying: true as const } : {}),
    }
    const result = await updateConversationSettings(
      {
        sessionId: conversation.sessionId,
        teamId,
        userId: ownerId,
        'runtimeOperation.token': token,
        'runtimeOperation.expiresAt': { $gt: new Date() },
      },
      {
        $set: {
          ...(pick ? { initialSessionConfig: pick } : {}),
          runtimeId: target.id,
          runtimeLabel: target.label,
          agentRuntime: target.provider,
          runtimeMigration: {
            fromRuntimeId: conversation.runtimeId,
            toRuntimeId: target.id,
            movedAt: new Date(),
            movedBy: userId,
          },
        },
        ...(sourceUrl ? { $addToSet: { previousRuntimeUrls: sourceUrl } } : {}),
        // A move leaves the conversation exactly where a brand-new one starts:
        // no session anywhere. It used to mint `openabSessionId: randomUUID()`
        // with forceNew, but that id is not in the runtime's namespace, and
        // every path that reads the attachment before the next prompt handed it
        // to the runtime and got "Invalid sessionId" — a 500 on /agent/chat and
        // on model-config. Clearing it means the first prompt creates the
        // session. Same-provider choices seed that session; another provider
        // starts from its own choices instead of inheriting incompatible ids.
        $unset: {
          runtimeOperation: '',
          claudeCodePreviewContext: '',
          claudeCodePreview: '',
          ...(pick ? {} : { initialSessionConfig: '' }),
        },
      },
      by,
    )

    if (!result.matchedCount)
      throw new AppError(
        409,
        'runtime_move_conflict',
        'The conversation changed before the move completed. Refresh and retry.',
      )
    closeMovedSession(teamId, conversation.sessionId)
  } finally {
    // Unlock first: the release starts any queued message, which a lock refuses.
    // A failed unlock still releases; the lock expires, the claim would not.
    try {
      await agentConversations().updateOne(
        { sessionId: conversation.sessionId, teamId, 'runtimeOperation.token': token },
        { $unset: { runtimeOperation: '' } },
      )
    } finally {
      release?.()
    }
  }
  if (retry) resendFailedPrompt(conversation.sessionId, retry)
  void deliverWaitingAnswers(conversation.sessionId)

  return { runtimeId: target.id, runtimeLabel: target.label, agentRuntime: target.provider }
}

/** How long a person's move waits for the turn it stopped to end. */
const STOP_WAIT_MS = 15_000

/**
 * The session's run claim. A person's move stops the turn holding it, as Stop
 * does, and takes the claim once that turn has ended; a fallback never stops one.
 */
async function claimSession(conversation: AgentConversation, stopTurn: boolean) {
  const claim = () => claimAgentRunForSession(conversation.userId, conversation.sessionId, true)
  const release = await claim()

  if (release || !stopTurn) return release
  // Lazy so importing the move does not pull in the route graph.
  const { stopConversationTurn } = await import('@/routes/agent/run-cancel')

  await stopConversationTurn(conversation)
  const until = Date.now() + STOP_WAIT_MS
  let stopped = await claim()

  while (!stopped && Date.now() < until) {
    await sleep(250)
    stopped = await claim()
  }

  return stopped
}

/**
 * The old runtime keeps an idle session for hours so it can be resumed, and a
 * moved one never is: end it there, then remove the home it leaves on another
 * computer. Best effort, since the move is already done; the hourly reclaim
 * sweep retries a home still in use, and the runtime's idle sweep frees the rest.
 */
function closeMovedSession(teamId: string, conversationId: string) {
  void closePreviewConversationSession(teamId, conversationId)
    .then(() => reclaimSessionHome(conversationId))
    .catch(() => {})
}
