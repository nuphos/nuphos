import { randomUUID } from 'node:crypto'

import { config } from '@/config'
import { agentConversations } from '@/lib/agent/db/shared'
import { isLocalRuntimeUrl } from '@/lib/agent/devices/local-runtime/address'
import { claimAgentRunForSession } from '@/lib/agent/run-admission'
import { AppError } from '@/lib/errors'

import { resolveLocalRuntimeEndpoint } from './local-runtime-catalog'
import { developmentRuntimeEndpoint, requireRuntimeInstance } from './runtime-catalog'
import { placementNamespace } from './runtime-controllers'
import { assertRuntimeNotDeleting, runtimeDeletions } from './runtime-portability-store'
import { runtimeProvider } from './runtime-provider'
import { findHostedRuntime, resolveTeamRuntimeEndpoints } from './runtime-registry'
import {
  findWorkspaceArchive,
  restoreRuntimeWorkspace,
  saveRuntimeWorkspace,
} from './runtime-workspace'

import type { AgentConversation } from '@/lib/agent/db/shared'

export async function moveConversationRuntime(
  conversation: AgentConversation,
  targetId: string,
  mode: 'history' | 'workspace',
  userId: string,
) {
  const teamId = conversation.teamId

  if (!teamId || conversation.userId !== userId)
    throw new AppError(403, 'conversation_read_only', 'Only the conversation owner can move it.')
  const provider = runtimeProvider(conversation.agentRuntime)
  const sourceUrl = conversation.claudeCodePreview?.runtimeUrl
  const sourceHosted = sourceUrl ? await findHostedRuntime(teamId, sourceUrl) : null

  // The attachment is shared across environments. Until it is environment-scoped,
  // a dev move must never replace a production conversation's durable placement.
  if (
    sourceHosted &&
    placementNamespace(sourceHosted.url) !== config.claudeCodeRuntimeProvisioner.namespace
  )
    throw new AppError(
      409,
      'runtime_environment_mismatch',
      'This conversation belongs to another environment. Open it there to move it to another agent. Nothing has been changed.',
    )
  const target = await requireRuntimeInstance(teamId, targetId, userId)

  if (target.status !== 'active')
    throw new AppError(409, 'runtime_unavailable', 'Choose an agent that is enabled.')
  await assertRuntimeNotDeleting(teamId, target.id)
  // Conversation history is provider-agnostic: it reaches a freshly created
  // inner session as the plain-text preamble previewHistoryPreamble builds from
  // the stored transcript, so Claude Code ↔ Codex is just another move. A
  // workspace archive is only proven to restore onto the same agent type, so
  // that mode keeps the restriction.
  if (mode === 'workspace' && target.provider !== provider)
    throw new AppError(
      400,
      'runtime_provider_mismatch',
      'A workspace can only move to another agent of the same type. Choose conversation history only.',
    )
  if (conversation.runtimeId === target.id)
    return { runtimeId: target.id, runtimeLabel: target.label, agentRuntime: target.provider, mode }
  const endpoints = await resolveTeamRuntimeEndpoints(teamId, undefined, target.provider)
  const development = developmentRuntimeEndpoint(target.provider)

  if (development) endpoints.push(development)
  if (target.kind === 'local') {
    if (mode === 'workspace')
      throw new AppError(
        409,
        'workspace_unavailable',
        'A local agent cannot receive a workspace. Choose conversation history only.',
      )
    endpoints.push(await resolveLocalRuntimeEndpoint(teamId, target.id, userId, 'transport'))
  }
  const endpoint = endpoints.find((entry) => entry.runtimeId === target.id)

  if (!endpoint)
    throw new AppError(409, 'runtime_starting', 'The destination agent is not ready yet.')
  const token = randomUUID()
  const locked = await agentConversations().updateOne(
    {
      sessionId: conversation.sessionId,
      teamId,
      userId,
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

  try {
    release = await claimAgentRunForSession(userId, conversation.sessionId, true)
    if (!release)
      throw new AppError(
        409,
        'conversation_busy',
        'Wait for the current response to finish before moving this conversation.',
      )
    if (mode === 'workspace') {
      if (!sourceUrl || isLocalRuntimeUrl(sourceUrl))
        throw new AppError(
          409,
          'workspace_unavailable',
          'No workspace is attached. Choose conversation history only.',
        )
      let archive = await findWorkspaceArchive(teamId, conversation.sessionId, sourceUrl)
      const deletingSource = await runtimeDeletions().findOne(
        { teamId, 'placements.url': sourceUrl },
        { sort: { requestedAt: -1 } },
      )

      if (archive && deletingSource && archive.createdAt < deletingSource.requestedAt)
        archive = null
      // An active source must be freshly saved; an old archive may be stale.
      const sourceLive = endpoints.some((entry) => entry.url === sourceUrl)

      if (sourceLive || !archive)
        archive = await saveRuntimeWorkspace(teamId, conversation.sessionId, provider, sourceUrl)
      await restoreRuntimeWorkspace(archive, target.provider, endpoint.url)
    }
    await assertRuntimeNotDeleting(teamId, target.id)
    const latestTarget = await requireRuntimeInstance(teamId, target.id, userId)

    if (latestTarget.status !== 'active')
      throw new AppError(
        409,
        'runtime_unavailable',
        'The destination was disabled during the move. Choose another agent and retry.',
      )
    const result = await agentConversations().updateOne(
      {
        sessionId: conversation.sessionId,
        teamId,
        userId,
        'runtimeOperation.token': token,
        'runtimeOperation.expiresAt': { $gt: new Date() },
      },
      {
        $set: {
          runtimeId: target.id,
          runtimeLabel: target.label,
          agentRuntime: target.provider,
          runtimeMigration: {
            mode,
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
        // session, and takes the destination's own defaults while doing so.
        $unset: {
          runtimeOperation: '',
          claudeCodePreviewContext: '',
          claudeCodePreview: '',
        },
      },
    )

    if (!result.matchedCount)
      throw new AppError(
        409,
        'runtime_move_conflict',
        'The conversation changed before the move completed. Refresh and retry.',
      )

    return { runtimeId: target.id, runtimeLabel: target.label, agentRuntime: target.provider, mode }
  } finally {
    release?.()
    await agentConversations().updateOne(
      { sessionId: conversation.sessionId, teamId, 'runtimeOperation.token': token },
      { $unset: { runtimeOperation: '' } },
    )
  }
}
