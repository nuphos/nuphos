import { randomUUID } from 'node:crypto'

import { initializeSessionBypass } from '@/lib/agent/auto-mode/store'
import { assertNotChannel } from '@/lib/agent/db/channels'
import { regionLabel } from '@/lib/agent/model-provider'
import { startTraceSpan } from '@/lib/agent/tracing'
import { resolveConversationChatRuntime } from '@/lib/claude-code-preview/agent-chat-runtime'
import { fallBackBeforeTurn } from '@/lib/claude-code-preview/runtime-fallback'
import { conversationExecutionState } from '@/lib/claude-code-preview/session-execution-state'
import { signNuphosToken } from '@/lib/identity'
import { logEvent } from '@/lib/observability'

import { shouldInitializePermissionMode } from './chat-permission-mode'
import { launchAcceptedChatTurn } from './chat-post-run'
import { awaitAdoptedPreviewRun, resolvePreviewWaitFromChat } from './chat-preview-resume'
import { admitPreviewTurn } from './chat-preview-steering'
import { handleExistingRun, resumeFromRedisOrThrow } from './chat-resume'
import {
  buildSlackBoundTurnPlan,
  claimSlackBoundTurn,
  findSlackBoundThread,
} from './chat-slack-bound'
import { attachSteeringTurn } from './chat-steering-attach'
import { acceptClientTail, validateChatBody } from './chat-validate'
import { resolveAgentCredentialAccess } from './credential-resolve'
import { agent } from './router'
import { agentRunKey, agentRuns, claimAgentRunForSession, createAgentRun } from './run-registry'
import { streamAgentRunResponse } from './run-stream'
import { admitRuntimeChat } from './runtime-chat-admission'
import { isQueued, queuedReply, queueForWaitingRuntime } from './session-queue-share-approval'
import { admitQueueableChat, queuedChatContext, queuedChatReply } from './session-queue-turn'
import {
  assertConversationSendable,
  readTeamIdCandidate,
  resolveReadableConversationForResume,
  resolveVerifiedTeamId,
  sanitizeKubeContextHeader,
} from './team-scope'
import { getFirstUserMessage } from './transcript'
import { acceptAgentRun } from './turn-start-frame'

import type { AgentChatBody, AgentRunTrace, InternalChatCtx } from './types'
import type { PendingUserMessage } from '@/lib/agent/pending-messages'

agent.post('/chat', async (c) => {
  const userId = c.get('userId')
  const requestId = c.get('requestId') ?? randomUUID()
  const locale = c.req.header('X-Atlas-Locale') ?? 'en-US'
  const body = await c.req.json<AgentChatBody>()
  const { id } = body
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, body.teamId))

  validateChatBody(body)
  const localToolsEnabled = body.clientCapabilities?.localTools === true
  const conversationForResume = body.resume
    ? await resolveReadableConversationForResume(id, userId, teamId)
    : await fallBackBeforeTurn(await assertConversationSendable(id, userId, teamId), userId)

  assertNotChannel(conversationForResume)
  const runOwnerUserId = conversationForResume?.userId ?? userId

  if (runOwnerUserId === userId && shouldInitializePermissionMode(body, conversationForResume)) {
    await initializeSessionBypass(id, userId, body.permissionMode === 'bypass')
  }
  const readOnlyResume = body.resume === true && runOwnerUserId !== userId
  // Resolve Slack binding alongside attribution.
  const clientViewPromise = acceptClientTail(
    body,
    id,
    runOwnerUserId,
    conversationForResume,
    userId,
    c.req.header('X-Nuphos-Device-Id')?.trim() || undefined,
    c.get('cliToken'),
  )
  const slackThread =
    !body.resume && conversationForResume
      ? await findSlackBoundThread(id, conversationForResume.metadata?.source)
      : null
  const clientView = await clientViewPromise

  const kubeContext = sanitizeKubeContextHeader(c.req.header('X-Atlas-Kube-Context'))
  const requestedCredentialAccess =
    body.credentialAccess !== undefined && !readOnlyResume && runOwnerUserId === userId
      ? await resolveAgentCredentialAccess({
          teamId,
          userId,
          selection: body.credentialAccess,
          stored: conversationForResume?.credentialAccess,
          kubeContext,
        })
      : null
  const streamId = body.streamId?.trim() || randomUUID()
  const runKey = agentRunKey(runOwnerUserId, streamId)
  const existingRun = agentRuns.get(runKey)
  const resumeParams = {
    requestId,
    userId,
    runOwnerUserId,
    sessionId: id,
    teamId,
    streamId,
    body,
    readOnlyResume,
    conversation: conversationForResume,
    clientView,
    slackBound: Boolean(slackThread),
    credentialAccess: requestedCredentialAccess?.access,
    context: queuedChatContext(c, locale, body, kubeContext),
  }

  if (existingRun) {
    const attached = handleExistingRun(existingRun, resumeParams)

    if (attached) return attached
  }
  if (body.resume) return await resumeFromRedisOrThrow(resumeParams)
  const chatRuntime = await resolveConversationChatRuntime(teamId, conversationForResume, {
    userId,
    sessionId: id,
    ...(body.agentRuntime ? { runtime: body.agentRuntime } : {}),
    ...(body.runtimeId ? { runtimeId: body.runtimeId } : {}),
  }).catch((error: unknown) => queueForWaitingRuntime(error, resumeParams))

  if (isQueued(chatRuntime)) return queuedChatReply(body, queuedReply(streamId, chatRuntime))
  const runtimeProvider = chatRuntime.runtime
  const runtimeModelId = chatRuntime.runtime
  let releaseAgentRunClaim: (() => void) | null = null
  let queuedItem: PendingUserMessage | undefined

  // The runtime says whether it can take work; a new message also holds the session claim.
  const runtimeSnapshot = conversationForResume?.claudeCodePreview
    ? await conversationExecutionState(conversationForResume)
    : undefined
  const runtimeOwnsAdmission = runtimeSnapshot?.schemaVersion === 2

  if (!readOnlyResume) {
    const previewWait = await resolvePreviewWaitFromChat({
      userId,
      sessionId: id,
      streamId,
      body,
      snapshot: runtimeSnapshot,
    })

    if (previewWait) {
      const adopted = await awaitAdoptedPreviewRun(runOwnerUserId, streamId)
      const attached = adopted ? handleExistingRun(adopted, resumeParams) : null

      return attached ?? (await resumeFromRedisOrThrow(resumeParams))
    }
    const queue = await admitQueueableChat({ ...resumeParams, snapshot: runtimeSnapshot })

    if (queue?.mode === 'queued') return queuedChatReply(body, { status: 'queued', streamId })
    if (queue) [releaseAgentRunClaim, queuedItem] = [queue.release, queue.item]
    else
      await admitRuntimeChat(runtimeSnapshot, {
        attached: conversationForResume?.claudeCodePreview ? conversationForResume : undefined,
        replying: Boolean(body.resumeReason),
        read: conversationExecutionState,
      })
    if (!queue && !runtimeOwnsAdmission) {
      // Park onto this conversation's running turn, or claim the session first.
      const admission = await admitPreviewTurn(
        {
          runOwnerUserId,
          userId,
          teamId,
          sessionId: id,
          messages: clientView,
        },
        { claim: claimAgentRunForSession },
      )

      if (admission?.mode === 'attach') {
        return await attachSteeringTurn(resumeParams, admission.streamId, conversationForResume)
      }
      if (admission?.mode === 'launch') releaseAgentRunClaim = admission.releaseClaim
    }
  }

  if (!releaseAgentRunClaim && slackThread && !runtimeOwnsAdmission) {
    releaseAgentRunClaim = await claimSlackBoundTurn(runOwnerUserId, id)
  }

  try {
    const slackPlan =
      slackThread || conversationForResume
        ? await buildSlackBoundTurnPlan({
            body,
            clientView,
            sessionId: id,
            runOwnerUserId,
            teamId,
            serverHistoryOnly: !body.continueAfterInterruption || runOwnerUserId !== userId,
          })
        : null
    const messages = slackPlan?.messages ?? clientView
    const firstMessage = getFirstUserMessage(messages)
    const isPotentialNewConversation = messages.length === 1 && messages[0]?.role === 'user'

    const chatSpan = startTraceSpan({
      name: 'turn',
      type: 'task',
      metadata: {
        route: '/agent/chat',
        method: 'POST',
        requestId,
        userId,
        sessionId: id,
        teamId,
        streamId,
        locale,
        provider: runtimeProvider,
        modelId: runtimeModelId,
        region: regionLabel(),
        isNewConversation: isPotentialNewConversation,
        messageCount: messages.length,
      },
    })

    const chatCtx: InternalChatCtx = {
      requestId,
      streamId,
      userId,
      // The runtime gets its own short-lived token, never this sign-in session.
      // A CLI token is passed on as is so an agent token keeps its team limit.
      nuphosToken: c.get('cliToken') ? c.get('authToken') : signNuphosToken(userId, 8 * 60 * 60),
      locale,
      currentUrl:
        c.req.header('X-Atlas-Url') ?? c.req.header('referer') ?? c.req.header('origin') ?? null,
      localToolsEnabled,
      kubeContext,
      diagramId: c.req.header('X-Atlas-Diagram-Id')?.trim() || undefined,
      isInApp: true,
      agentOrigin: 'user',
    }

    logEvent('info', 'agent.chat.start', {
      request_id: requestId,
      user_id: userId,
      session_id: id,
      team_id: teamId,
      stream_id: streamId,
      provider: runtimeProvider,
      model_id: runtimeModelId,
      region: regionLabel(),
      locale,
      message_count: messages.length,
      is_new_conversation: isPotentialNewConversation,
      resume: Boolean(body.resume),
      continue_after_interruption: Boolean(body.continueAfterInterruption),
      local_tools_enabled: localToolsEnabled,
      client_version: c.req.header('X-Atlas-Client') ?? undefined,
    })

    const runTrace: AgentRunTrace = {
      requestId,
      userId,
      sessionId: id,
      teamId,
      streamId,
      route: '/agent/chat',
      method: 'POST',
      chatSpan,
    }
    const run = createAgentRun(runOwnerUserId, id, streamId, runTrace)

    acceptAgentRun(run, messages)
    launchAcceptedChatTurn({
      run,
      chatCtx,
      chatSpan,
      body,
      teamId,
      messages,
      firstMessage,
      locale,
      credentialAccess: requestedCredentialAccess?.access,
      credentialAccessRequested: requestedCredentialAccess !== null,
      releaseClaim: releaseAgentRunClaim,
      slack: slackThread
        ? {
            thread: slackThread,
            runOwnerUserId,
            userName: c.get('userName'),
            mirror: slackPlan?.mirror ?? null,
          }
        : null,
      chatRuntime,
      queued: queuedItem,
    })

    return streamAgentRunResponse(run, body.resumeFrom)
  } catch (err) {
    releaseAgentRunClaim?.()
    throw err
  }
})
